-- =============================================================================
-- Migración: siguiente_contador() contempla el caller service_role
-- (bug de producción, tarea 2.3 — encontrado probando el flujo REAL del
-- registro público de subclientes contra Supabase; los tests con mocks del
-- cliente Supabase no lo atrapaban).
-- -----------------------------------------------------------------------------
-- IMPACTO: reemplaza (create or replace, MISMA firma) el cuerpo de
-- public.siguiente_contador(uuid, text) — creada en 20260713090200 —
-- agregando UNA condición más al guard existente. CERO cambios de esquema,
-- CERO cambios de grants (siguen: revoke de public/anon, execute para
-- authenticated y service_role — ver 20260713090200/20260713090800). No toca
-- ninguna otra tabla ni función.
--
-- DIAGNÓSTICO: `lib/registro-publico/acciones.ts` (endpoint público SIN
-- sesión de usuario, SUB-4/5) llama esta RPC con el cliente **service_role**
-- a propósito — es la única forma de asignar código de subcliente/número de
-- casillero ANTES de que exista ninguna sesión autenticada. Con el guard
-- original:
--   if p_tenant_id is distinct from (select private.current_tenant_id())
--      and not (select private.is_super_admin()) then
--     raise exception 'No autorizado para el tenant %', p_tenant_id;
--   end if;
-- un caller service_role no tiene JWT con claim `sub` -> auth.uid() es NULL
-- -> current_tenant_id() es NULL (sin membresía) e is_super_admin() es false
-- (sin fila en super_admins) -> el guard SIEMPRE da true para cualquier
-- p_tenant_id real -> la RPC rechaza SIEMPRE a service_role con 'No
-- autorizado', y el registro público nunca completa el alta del subcliente.
--
-- Esto contradice el diseño ya documentado en 20260713090200/20260713090800:
-- service_role CONSERVA EXECUTE sobre esta función a propósito ("backend de
-- confianza, bypassa RLS igual") — el guard interno debía reflejar esa misma
-- decisión y no lo hacía: bloqueaba al backend de confianza en vez de
-- bloquear solo a un usuario autenticado normal pidiendo el contador de OTRO
-- tenant (el propósito real del guard).
--
-- FIX: se agrega una tercera condición ANDed — `(select auth.role()) is
-- distinct from 'service_role'` — que hace que el guard NO dispare cuando el
-- caller es service_role, sin importar qué p_tenant_id pida. Mecanismo de
-- detección elegido y por qué es seguro (verificado contra el proyecto real
-- con `select pg_get_functiondef('auth.role()'::regprocedure)`):
--   auth.role() = coalesce(
--     nullif(current_setting('request.jwt.claim.role', true), ''),
--     (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
--   )
-- Es decir: LEE UNA GUC de sesión (`request.jwt.claim.role` /
-- `request.jwt.claims`), no el rol de Postgres activo. Esto importa porque
-- siguiente_contador() es SECURITY DEFINER: dentro de una función SECURITY
-- DEFINER, `current_user`/`session_user` NO reflejan de forma confiable el
-- rol del LLAMADOR (current_user pasa a ser el dueño de la función mientras
-- se ejecuta) — por eso NO se usó `current_user = 'service_role'` (el patrón
-- de proteger_email_usuario(), que es SECURITY INVOKER y por eso sí puede
-- usarlo). Las GUCs de sesión, en cambio, NO cambian al entrar a una función
-- SECURITY DEFINER — es el MISMO mecanismo que ya usan (con éxito, probado)
-- private.current_tenant_id()/private.is_super_admin() vía auth.uid(), que
-- también son SECURITY DEFINER y ya leen esas mismas GUCs correctamente hoy.
-- PostgREST/Supabase, al recibir la llave service_role, autentica la sesión
-- con el claim `role: service_role` en el JWT — auth.role() lo ve
-- directamente, sin depender de que exista (ni de qué diga) el claim `sub`.
--
-- El resto de la función (insert/on conflict/return) queda IDÉNTICO.
--
-- ES DESTRUCTIVA: no.
-- CÓMO VALIDAR (con el MCP/CLI, después de aplicar):
--   - pg_get_functiondef('public.siguiente_contador(uuid, text)'::regprocedure)
--     muestra la nueva condición en el guard.
--   - has_function_privilege(...) sigue igual para anon (sin EXECUTE),
--     authenticated y service_role (con EXECUTE) — sin cambios de grants.
--   - Correr supabase/tests/database/20260717_siguiente_contador_service_role.test.sql
--     (pgTAP): (a) authenticated del tenant A sigue SIN poder pedir
--     contadores del tenant B (P0001, regresión del guard original); (b) un
--     Super-Admin SÍ puede pedir contadores de cualquier tenant (sin cambios,
--     ya funcionaba); (c) el caller service_role SÍ puede pedir contadores de
--     CUALQUIER tenant (el caso nuevo del fix).
--   - Re-correr supabase/tests/database/20260713_rls_aislamiento_multitenant.test.sql
--     completa para confirmar CERO regresión (los tests (a)/(b)/(c) de
--     siguiente_contador ahí ya cubiertos siguen con el mismo resultado).
-- PLAN DE REVERSIÓN (pensado, no ejecutado automáticamente): re-crear la
-- función con el guard de 20260713090200 (sin la condición de auth.role()).
-- =============================================================================

create or replace function public.siguiente_contador(p_tenant_id uuid, p_contador text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_valor bigint;
begin
  if p_tenant_id is distinct from (select private.current_tenant_id())
     and not (select private.is_super_admin())
     and (select auth.role()) is distinct from 'service_role' then
    raise exception 'No autorizado para el tenant %', p_tenant_id;
  end if;

  insert into public.tenant_contadores (tenant_id, contador, valor)
  values (p_tenant_id, p_contador, 1)
  on conflict (tenant_id, contador)
  do update set valor = public.tenant_contadores.valor + 1
  returning valor into v_valor;

  return v_valor;
end;
$fn$;

comment on function public.siguiente_contador(uuid, text) is
  'Devuelve el siguiente número atómico de la secuencia (tenant_id, contador). '
  'Uso: código de subcliente, número de casillero, numeración interna de '
  'documentos. Valida que el llamador pertenezca al tenant solicitado, salvo '
  'que sea Super-Admin o el caller service_role (backend de confianza, '
  'llamado SIEMPRE sin sesión de usuario desde flujos públicos como el '
  'registro de subclientes — 20260717220000).';

-- Grants: SIN CAMBIOS respecto de 20260713090200/20260713090800 (create or
-- replace conserva los privilegios ya otorgados/revocados). Se dejan estas
-- líneas explícitas de todos modos, idempotentes, para que el estado final
-- de privilegios quede documentado en el MISMO archivo que cambia el guard
-- que depende de ellos (auditable sin tener que ir a buscar la migración
-- original).
revoke all on function public.siguiente_contador(uuid, text) from public;
revoke execute on function public.siguiente_contador(uuid, text) from anon;
grant execute on function public.siguiente_contador(uuid, text) to authenticated;
