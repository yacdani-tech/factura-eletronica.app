-- =============================================================================
-- Migración: cierra el GAP DE SEGURIDAD PREEXISTENTE de la RLS de fila de
-- `public.tenants` — un Admin del PROPIO tenant podía, vía un PATCH directo a
-- PostgREST, cambiar `estado` (auto-desbloquearse) o `plan_id` (auto-subirse
-- de plan/tope) porque `tenants_editar_propio_o_super_admin`/`tenants_editar_
-- propio_admin` son políticas a nivel de FILA, no de COLUMNA. Decisión de Yac
-- 2026-08-15 (tras el hallazgo señalado al implementar el guard de
-- `precio_suscripcion_usd`, 20260815090000/097000). Extiende ese guard a las
-- 3 columnas de plataforma.
-- -----------------------------------------------------------------------------
-- IMPACTO: reemplaza la función/trigger de guard de `20260815097000` (que solo
-- cubría `precio_suscripcion_usd`) por una versión que cubre `estado`,
-- `plan_id` Y `precio_suscripcion_usd`. Renombra la función/trigger a un
-- nombre genérico (`proteger_columnas_sensibles_tenant` / `trg_tenants_
-- proteger_columnas_sensibles`) y ELIMINA la vieja `proteger_precio_
-- suscripcion_tenant` + su trigger. Cero cambios de esquema/datos.
-- ES DESTRUCTIVA: no (drop de una función/trigger que se reemplaza en el mismo
-- archivo por su sucesora).
--
-- MISMA ESTRUCTURA DE IFs ANIDADOS QUE 20260815097000 (para no reintroducir la
-- regresión de service_role que QA atrapó — Postgres no hace short-circuit de
-- un AND con subconsulta, y service_role NO tiene USAGE sobre el schema
-- `private`):
--   1. Si NINGUNA de las 3 columnas sensibles cambió -> `return NEW` de
--      inmediato, sin evaluar `private.is_super_admin()`. Cubre el 100% de los
--      UPDATE (de service_role o de cualquier rol) que tocan OTRAS columnas de
--      `tenants` (logo, plantilla, whatsapp, tipo_cambio, datos_pago, etc.).
--   2. Si alguna cambió y `current_user = 'service_role'` -> `return NEW`
--      (backend de confianza — nunca alcanzable desde el cliente; usado por
--      flujos server-side y por el setup de los E2E que fija plan_id).
--   3. Si alguna cambió y NO es service_role -> recién ahí se evalúa
--      `private.is_super_admin()` (el rol acá es `authenticated`, con acceso a
--      `private`, o `postgres` dentro de una RPC SECURITY DEFINER). Si no es
--      super-admin -> `raise exception` (P0001).
--
-- QUÉ SIGUE FUNCIONANDO (verificado): los cambios legítimos de estado/plan los
-- hace SIEMPRE el super-admin — `bloquearCourier`/`desbloquearCourier`/
-- `asignarPlan` (apps/web/lib/couriers/acciones.ts) corren con el cliente de
-- SESIÓN del super-admin (rol `authenticated`, `is_super_admin()` = true ->
-- rama 3, permitido). `crearCourier` fija `plan_id` en un INSERT (este trigger
-- es BEFORE UPDATE, no dispara en INSERT). Ningún flujo de un Admin de tenant
-- común toca estado/plan_id/precio de su propia fila (solo config: logo,
-- plantilla, whatsapp, etc. — rama 1, ni se evalúa el guard).
--
-- NOTA: `estado`/`plan_id` NO tienen (a diferencia de `precio_suscripcion_usd`)
-- una RPC dedicada de mutación tipo `actualizar_precio_suscripcion_tenant` —
-- se cambian por UPDATE directo del cliente de sesión del super-admin, que la
-- rama 3 permite. No hace falta una RPC nueva.
--
-- CÓMO VALIDAR (después de aplicar):
--   - Admin autenticado de un tenant (no super-admin) intentando `update
--     tenants set estado='activo'` / `set plan_id=<otro>` / `set
--     precio_suscripcion_usd=0` sobre su PROPIA fila -> P0001 (rechazado por el
--     trigger, aunque la RLS de fila lo dejaría pasar). El mismo Admin
--     cambiando una columna NO sensible (whatsapp_soporte) -> pasa.
--   - `set local role service_role; update tenants set estado=... / plan_id=...
--     / nombre=...` -> pasa (rama 2 / rama 1).
--   - Super-admin (sesión) cambiando estado/plan_id -> pasa (rama 3).
-- PLAN DE REVERSIÓN (pensado, no ejecutado):
--   drop trigger if exists trg_tenants_proteger_columnas_sensibles on public.tenants;
--   drop function if exists public.proteger_columnas_sensibles_tenant();
--   -- y re-crear proteger_precio_suscripcion_tenant + su trigger de 20260815097000
--   -- (NO recomendado: reabre el gap de estado/plan_id).
-- =============================================================================

create or replace function public.proteger_columnas_sensibles_tenant()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if NEW.estado is distinct from OLD.estado
     or NEW.plan_id is distinct from OLD.plan_id
     or NEW.precio_suscripcion_usd is distinct from OLD.precio_suscripcion_usd then
    if current_user = 'service_role' then
      -- Backend de confianza: permitir SIN tocar el schema private
      -- (service_role no tiene USAGE/EXECUTE ahí).
      return NEW;
    end if;

    if not (select private.is_super_admin()) then
      raise exception
        'Los campos de plataforma del tenant % (estado, plan, precio de suscripción) solo los cambia la plataforma (super-admin); no se pueden editar desde el propio tenant.',
        OLD.id;
    end if;
  end if;

  return NEW;
end;
$fn$;

comment on function public.proteger_columnas_sensibles_tenant() is
  'Trigger BEFORE UPDATE (defensa en profundidad sobre la RLS de FILA de '
  'tenants, patrón proteger_email_usuario): rechaza cambios de estado / '
  'plan_id / precio_suscripcion_usd salvo service_role (backend de confianza) '
  'o super-admin (private.is_super_admin()). IFs anidados: (1) ninguna columna '
  'sensible cambió -> return NEW sin tocar private; (2) cambió y '
  'current_user=service_role -> permitir; (3) cambió y no service_role -> '
  'exige is_super_admin(). Supersede proteger_precio_suscripcion_tenant '
  '(20260815097000), que solo cubría precio. Cierra el gap preexistente por el '
  'que un Admin de tenant podía auto-desbloquearse (estado) o auto-cambiarse '
  'de plan (plan_id) vía PATCH directo a PostgREST.';

drop trigger if exists trg_tenants_proteger_precio_suscripcion on public.tenants;

create trigger trg_tenants_proteger_columnas_sensibles
  before update on public.tenants
  for each row
  execute function public.proteger_columnas_sensibles_tenant();

drop function if exists public.proteger_precio_suscripcion_tenant();
