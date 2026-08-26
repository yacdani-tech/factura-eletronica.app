-- =============================================================================
-- Migración: FIX de regresión crítica en `public.proteger_precio_suscripcion_
-- tenant()` (introducida en `20260815090000`, YA APLICADA — por eso esta es
-- una migración NUEVA con `create or replace function`, nunca se edita la
-- 090000 aplicada). Hallazgo de QA (2026-08-15).
-- -----------------------------------------------------------------------------
-- IMPACTO: solo el CUERPO de `public.proteger_precio_suscripcion_tenant()`
-- (`create or replace function`, misma firma, mismo trigger `trg_tenants_
-- proteger_precio_suscripcion` sobre `public.tenants`, sin tocarlo). Cero
-- cambios de esquema, triggers nuevos, políticas ni datos.
-- ES DESTRUCTIVA: no.
--
-- PROBLEMA (regresión real, confirmada por QA — reventaba CUALQUIER UPDATE de
-- `tenants` hecho por `service_role`, tocara o no `precio_suscripcion_usd`):
-- la versión de `20260815090000` evaluaba la condición de rechazo como UNA
-- sola expresión booleana:
--   `NEW.precio_suscripcion_usd is distinct from OLD.precio_suscripcion_usd
--    and not (select private.is_super_admin())
--    and current_user <> 'service_role'`
-- Postgres NO garantiza evaluación short-circuit de un `AND` cuando uno de
-- los operandos es una subconsulta (`(select ...)` se resuelve como InitPlan,
-- evaluado ANTES/independientemente de los demás operandos del `AND`, no en
-- el orden textual) — así que `private.is_super_admin()` se ejecutaba
-- SIEMPRE, incluso cuando `precio_suscripcion_usd` NO cambiaba y cuando
-- `current_user = 'service_role'`. El cliente `service_role` NO tiene
-- `USAGE` sobre el schema `private` ni `EXECUTE` sobre `is_super_admin()`
-- (confirmado por QA) — cualquier `update public.tenants` de `service_role`
-- (ej. `admin.from('tenants').update({plan_id: ...})`, usado por flujos
-- existentes YA EN PRODUCCIÓN, ninguno relacionado con esta feature) fallaba
-- con `42501: permission denied for schema private`, incluso actualizando
-- columnas que no tienen nada que ver con `precio_suscripcion_usd`. Rompió 3
-- specs E2E que estaban verdes (anulaciones, facturacion-plan-tope,
-- soporte-resumen-kpis). Repro mínima: `set local role service_role; update
-- public.tenants set nombre = nombre where id = (select id from
-- public.tenants limit 1);` -> 42501.
--
-- CAUSA RAÍZ: al escribir el guard (`20260815090000`) me aparté del
-- precedente exacto que estaba replicando, `public.proteger_email_usuario()`
-- (`20260713090200`) — ESE guard usa ÚNICAMENTE `current_user <>
-- 'service_role'`, SIN llamar a ninguna función del schema `private`. Al
-- agregar `is_super_admin()` a la MISMA expresión booleana (para distinguir
-- "super-admin real" de "cualquier otro rol"), se introdujo una dependencia
-- de `private` en un camino (`service_role` tocando otra columna) que NUNCA
-- debería necesitar tocar ese schema.
--
-- FIX: reestructurar con IFs ANIDADOS, de forma que `private.is_super_admin()`
-- NUNCA se evalúe salvo que sea ESTRICTAMENTE necesario (Postgres SÍ respeta
-- el orden secuencial de un `IF`/`ELSIF` en PL/pgSQL -- a diferencia de un
-- `AND` de una sola expresión SQL, esto NO es InitPlan, es control de flujo
-- imperativo real):
--   1. Si `precio_suscripcion_usd` NO cambió -> `return NEW` de inmediato, sin
--      evaluar nada más. Cubre el 100% de los UPDATE de `service_role` (o de
--      cualquier rol) que tocan OTRAS columnas de `tenants` -- el caso que
--      rompió los 3 E2E.
--   2. Si SÍ cambió y `current_user = 'service_role'` -> `return NEW` (permitir
--      sin tocar `private` en absoluto -- backend de confianza).
--   3. Si SÍ cambió y NO es `service_role` -> ahí SÍ se evalúa `private.
--      is_super_admin()` (el rol en este punto es `authenticated`, que SÍ
--      tiene `USAGE`/`EXECUTE` sobre `private`/`is_super_admin`, o `postgres`
--      dentro de la RPC SECURITY DEFINER, dueño de todo el schema) -- si no
--      es super-admin, `raise exception`.
--
-- RAZONAMIENTO VERIFICADO (misma pregunta que ya se había verificado en
-- 20260815090000, re-confirmada con la nueva estructura): la RPC `public.
-- actualizar_precio_suscripcion_tenant` (SECURITY DEFINER, dueña `postgres`)
-- SIGUE pasando el guard. Dentro de una función SECURITY DEFINER,
-- `current_user` pasa a ser el DUEÑO de la función (`postgres`) durante TODA
-- la ejecución, incluidos los triggers disparados por sus propias sentencias
-- DML -- así que cuando esa RPC hace `update tenants set precio_suscripcion_
-- usd = ...`, este trigger ve `current_user = 'postgres'`, NO `'service_
-- role'` -> cae a la rama 3 (evalúa `is_super_admin()`). Pero `private.
-- is_super_admin()` resuelve vía `auth.uid()`, que lee la GUC de sesión
-- `request.jwt.claims` -- una GUC que NO cambia al entrar a una función
-- SECURITY DEFINER (mismo mecanismo que `private.current_tenant_id()`/
-- `private.is_super_admin()` usan en todo el proyecto). Como la propia RPC
-- ya exigió `is_super_admin()` ANTES de llegar al UPDATE, el trigger, en la
-- rama 3, ve la MISMA sesión real (el super-admin que invocó la RPC) y
-- también da `true` -> el guard deja pasar el UPDATE de la RPC. Y `postgres`
-- SÍ tiene acceso al schema `private` (lo posee, junto con el resto del
-- esquema), así que la rama 3 nunca falla por permisos ahí -- muy distinto
-- del caso roto de `service_role`, que la rama 2 ahora evita por completo.
--
-- CÓMO VALIDAR (con `supabase db query --linked`, después de aplicar):
--   - `set local role service_role; update public.tenants set nombre = nombre
--     where id = (select id from public.tenants limit 1);` -> ya NO falla
--     (repro exacta de QA, ahora en verde).
--   - `set local role service_role; update public.tenants set
--     precio_suscripcion_usd = 0 where id = <cualquiera>;` -> SIGUE
--     permitido (rama 2, backend de confianza).
--   - Como Admin autenticado de un tenant (no super-admin): `update tenants
--     set precio_suscripcion_usd = 0 where id = <su propio tenant>` SIGUE
--     fallando con P0001 (rama 3, is_super_admin() da false) -- la protección
--     original del hallazgo de seguridad NO se debilitó.
--   - Como super-admin: el UPDATE directo y `public.
--     actualizar_precio_suscripcion_tenant(...)` SIGUEN pasando.
--   - Correr `supabase/tests/database/20260815_suscripcion_facturas.test.sql`
--     (fix del bug de sintaxis del setup -- `as c` faltante -- y nueva
--     aserción que blinda esta regresión: `service_role` actualizando una
--     columna no relacionada con `precio_suscripcion_usd` debe pasar).
-- PLAN DE REVERSIÓN (pensado, no ejecutado automáticamente): re-aplicar el
-- cuerpo de la función tal como quedó en `20260815090000` (create or replace)
-- -- NO RECOMENDADO, reintroduce la regresión confirmada por QA.
-- =============================================================================

create or replace function public.proteger_precio_suscripcion_tenant()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if NEW.precio_suscripcion_usd is distinct from OLD.precio_suscripcion_usd then
    if current_user = 'service_role' then
      -- Backend de confianza: permitir SIN tocar el schema private en
      -- absoluto (service_role no tiene USAGE/EXECUTE ahí -- ver CAUSA RAÍZ
      -- del header de esta migración).
      return NEW;
    end if;

    if not (select private.is_super_admin()) then
      raise exception
        'El precio de suscripción del tenant % solo lo ajusta la plataforma (super-admin), vía public.actualizar_precio_suscripcion_tenant.',
        OLD.id;
    end if;
  end if;

  return NEW;
end;
$fn$;

comment on function public.proteger_precio_suscripcion_tenant() is
  'Trigger BEFORE UPDATE (defensa en profundidad, mismo patrón que '
  'proteger_email_usuario, 20260713090200): rechaza cambios de tenants.'
  'precio_suscripcion_usd salvo cuando el rol activo es service_role '
  '(backend de confianza) o la sesión es super-admin (private.'
  'is_super_admin()). Estructura con IFs ANIDADOS (fix de 20260815097000, '
  'reemplaza la versión original de 20260815090000 que evaluaba todo en una '
  'sola expresión AND con subconsulta -- Postgres no garantiza short-circuit '
  'ahí, así que is_super_admin() se ejecutaba SIEMPRE, incluso para '
  'service_role, que no tiene acceso al schema private -> 42501 en '
  'CUALQUIER UPDATE de tenants hecho por service_role, tocara o no esta '
  'columna; regresión confirmada por QA, ver header de 20260815097000). Con '
  'el IF anidado: (1) columna sin cambios -> return NEW inmediato, sin tocar '
  'private; (2) columna cambia y current_user=service_role -> permitir sin '
  'tocar private; (3) columna cambia y NO es service_role -> recién ahí se '
  'evalúa is_super_admin() (rechaza si no lo es). private.is_super_admin() '
  'resuelve vía auth.uid()/GUC de sesión -- NO cambia al entrar a una '
  'función SECURITY DEFINER, por eso public.actualizar_precio_suscripcion_'
  'tenant sigue pasando la rama 3 aunque corra con current_user=postgres.';
