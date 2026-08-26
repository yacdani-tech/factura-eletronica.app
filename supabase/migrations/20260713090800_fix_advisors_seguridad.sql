-- =============================================================================
-- Migración: correcciones de los advisors de seguridad de Supabase (post 1.1)
-- -----------------------------------------------------------------------------
-- IMPACTO: dos hallazgos reales del linter de seguridad de Supabase
-- (get_advisors) tras aplicar el modelo de datos inicial al proyecto:
--
--   1. `public.siguiente_contador()` era ejecutable por `anon`. La migración
--      `20260713090200` hizo `revoke all ... from public` + `grant execute
--      ... to authenticated`, pero en Supabase existen DEFAULT PRIVILEGES que
--      otorgan EXECUTE sobre funciones nuevas a `anon`, `authenticated` y
--      `service_role` EXPLÍCITAMENTE (no vía PUBLIC) en el momento del CREATE
--      FUNCTION — así que el revoke de PUBLIC no tocó el grant directo de
--      `anon`, y la función (SECURITY DEFINER) quedó expuesta en
--      /rest/v1/rpc/ para usuarios sin sesión. No había exploit real: para
--      anon, current_tenant_id() devuelve NULL y el único p_tenant_id que
--      pasa la validación es NULL, que luego revienta contra el NOT NULL de
--      la PK de tenant_contadores — pero el contrato explícito de la función
--      es "solo authenticated", y eso debe cumplirse a nivel de grants, no
--      por accidente de un constraint.
--   2. `pg_trgm` quedó instalada en el esquema `public` (el `create
--      extension` de `20260713090000` no fijó esquema). Convención Supabase:
--      extensiones en el esquema `extensions`. Moverla es seguro con índices
--      gin_trgm_ops ya creados (las referencias del catálogo son por OID, no
--      por nombre) y el search_path por defecto de los roles de Supabase ya
--      incluye `extensions`.
--
-- ES DESTRUCTIVA: no (solo grants y reubicación de extensión).
-- CÓMO VALIDAR: re-correr get_advisors (security): deben desaparecer
--   `anon_security_definer_function_executable` y `extension_in_public`.
--   Verificar que los índices trgm siguen funcionando:
--     explain select 1 from public.subclientes where nombre like '%x%';
-- PLAN DE REVERSIÓN (revierte LO QUE ESTA MIGRACIÓN CAMBIÓ — el grant de
-- anon y el esquema de pg_trgm; no pretende reconstruir ningún otro
-- privilegio que Supabase gestione por fuera de estas migraciones):
--   grant execute on function public.siguiente_contador(uuid, text) to anon;
--     -- (anon tenía EXECUTE por grant directo de los default privileges de
--     --  Supabase; authenticated y service_role NO se tocan aquí en ninguna
--     --  dirección: tenían EXECUTE antes y lo conservan después — esta
--     --  migración solo quita el de anon).
--   alter extension pg_trgm set schema public;
--
-- ESTADO ESPERADO DE PERMISOS de public.siguiente_contador(uuid, text)
-- DESPUÉS de esta migración (verificado contra el proyecto real con
-- has_function_privilege el 2026-07-13):
--   - PUBLIC:        sin EXECUTE (revocado desde `20260713090200`).
--   - anon:          sin EXECUTE (revocado AQUÍ; su grant venía de los
--                    default privileges de Supabase, no de PUBLIC).
--   - authenticated: EXECUTE (contrato de la función: la app la llama con
--                    sesión; la propia función valida tenant/super-admin).
--   - service_role:  EXECUTE (default privileges de Supabase; se conserva a
--                    propósito — backend de confianza, bypassa RLS igual).
--
-- NOTA DE ENMIENDA (2026-07-13, misma jornada, ronda de QA): la guardia
-- idempotente del punto (2) se agregó DESPUÉS de aplicar esta migración al
-- proyecto remoto. Editarla es seguro como excepción puntual a "nunca editar
-- una migración aplicada" porque (a) el único entorno que la aplicó es el
-- proyecto remoto, donde ya no se re-ejecuta (versión registrada en el
-- historial) y el estado final es idéntico al que produce esta versión, y
-- (b) el problema que corrige —fallar en un entorno fresco/parcialmente
-- provisionado donde pg_trgm YA esté en `extensions`— solo puede corregirse
-- en ESTE archivo (una migración posterior nunca llegaría a ejecutarse si
-- esta falla antes).
-- =============================================================================

-- (1) El grant directo a anon vino de los default privileges de Supabase; el
-- revoke debe nombrar a anon explícitamente (revocar de PUBLIC no lo cubre).
-- REVOKE es idempotente por definición (revocar un privilegio ausente es un
-- no-op silencioso), no necesita guardia.
revoke execute on function public.siguiente_contador(uuid, text) from anon;

-- (2) Supabase ya trae el esquema `extensions`; el IF NOT EXISTS es solo por
-- portabilidad (ej. un Postgres local pelado en CI).
create schema if not exists extensions;

-- Guardia idempotente: `alter extension ... set schema X` FALLA si la
-- extensión ya está en X (no es un no-op), así que solo se mueve si todavía
-- está en otro esquema. Cubre: (a) re-ejecución del archivo, (b) entornos
-- donde pg_trgm ya viene instalada en `extensions` (ej. stack local de
-- Supabase o un proyecto provisionado distinto del remoto donde nació esta
-- migración). Si pg_trgm no existiera (imposible tras `20260713090000`, que
-- la crea), el EXISTS da false y no se hace nada.
--
-- SIN captura de excepciones A PROPÓSITO (decisión de ronda de QA, no un
-- olvido): si el `alter extension` fallara por algo NO contemplado por la
-- guardia (ej. permisos insuficientes del rol que corre la migración), lo
-- correcto es que la migración aborte visible y completa — un
-- `exception when others` dejaría el advisor `extension_in_public` a
-- medio corregir EN SILENCIO, que es exactamente la clase de deriva que
-- este archivo existe para eliminar. Requisito de entorno: las migraciones
-- corren como el rol administrador del runner (postgres/supabase_admin en
-- `supabase db reset`/`db push`; el rol de servicio del MCP en
-- apply_migration), que es dueño de la extensión y puede moverla — no hay
-- entorno soportado donde el fallo por permisos sea esperable.
--
-- ESTADO DEL CATÁLOGO REMOTO (para evitar re-aplicaciones manuales
-- confusas): en el proyecto Supabase del MVP esta migración YA está
-- aplicada y verificada (2026-07-13: pg_trgm en `extensions`, anon sin
-- EXECUTE, authenticated/service_role con EXECUTE, versión 20260713090800
-- registrada en el historial). Re-ejecutar este cuerpo completo contra esa
-- BD ya provisionada se probó explícitamente y es un no-op sin error.
do $$
begin
  if exists (
    select 1
    from pg_extension e
    join pg_namespace n on n.oid = e.extnamespace
    where e.extname = 'pg_trgm'
      and n.nspname <> 'extensions'
  ) then
    alter extension pg_trgm set schema extensions;
  end if;
end;
$$;
