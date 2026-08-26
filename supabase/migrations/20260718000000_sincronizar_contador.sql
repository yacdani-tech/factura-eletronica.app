-- =============================================================================
-- Migración: sincronizar_contador() — bump del contador de tenant a un mínimo
-- (tarea "preservar número de casillero manual", Fase 1 — BD)
-- -----------------------------------------------------------------------------
-- IMPACTO: agrega UNA función nueva, `public.sincronizar_contador(uuid, text,
--   bigint)`. NO toca `public.siguiente_contador()` ni ninguna otra función ya
--   aplicada (esas migraciones no se editan). NO toca el esquema de
--   `public.tenant_contadores` (20260713090800): misma tabla, mismo
--   deny-by-default (RLS + FORCE + sin grants directos a authenticated/anon),
--   esta función es la ÚNICA vía adicional de escritura, junto a
--   siguiente_contador().
--
-- PARA QUÉ ES: cuando se insertan plataforma MANUALES altos (ej. importar
--   clientes existentes con plataforma 100, 101, ... antes de que el sistema
--   empiece a asignarlos automáticamente), el contador `(tenant_id,
--   'casillero')` en `tenant_contadores` puede seguir en un valor bajo (o en
--   0 si nunca se usó `siguiente_contador()` para ese tenant). Sin esto, la
--   PRÓXIMA alta automática de casillero pediría `siguiente_contador()` y
--   devolvería un valor bajo que YA está ocupado por un casillero manual,
--   violando `subclientes_tenant_casillero_unique`. `sincronizar_contador()`
--   sube el contador al mínimo indicado (ej. 100) para que la siguiente alta
--   automática continúe en 101 en vez de colisionar.
--
-- POR QUÉ GREATEST (nunca baja el contador): el contrato de
--   `siguiente_contador()` es que cada valor que devuelve se usa UNA sola vez
--   y nunca se reutiliza ni se rellenan huecos (gaps) — igual que una
--   sequence de Postgres. Si `sincronizar_contador()` pudiera BAJAR el
--   contador, una llamada con un `p_valor_minimo` menor al valor actual
--   pisaría esa garantía y la siguiente alta automática podría volver a
--   colisionar contra un número ya usado (manual o automático). GREATEST
--   hace que la función sea un piso, nunca un techo ni un reset: es
--   monótonamente creciente, atómica (el lock de fila lo da el propio
--   `on conflict ... do update`, igual que en `siguiente_contador()`) e
--   idempotente (llamarla dos veces con el mismo valor no cambia el
--   resultado ni genera un incremento espurio, a diferencia de
--   `siguiente_contador()`, que SIEMPRE incrementa).
--
-- GUARD DE AUTORIZACIÓN: copiado TEXTUAL del guard vigente de
--   `siguiente_contador()` (20260717220000) — dueño-del-tenant vía
--   `private.current_tenant_id()`, o `private.is_super_admin()`, o caller
--   `service_role` (backend de confianza; la usa el flujo de carga
--   masiva/registro de plataforma manuales, que corre sin sesión de usuario
--   igual que el registro público de subclientes de 20260717220000). Mismo
--   mecanismo de detección de service_role (`auth.role()`, GUC de sesión, no
--   `current_user`/`session_user` — ver razonamiento completo en el
--   comentario de 20260717220000, no se repite acá para no duplicar).
--
-- GRANTS: ESPEJO EXACTO de `siguiente_contador()` — revoke de public/anon,
--   grant execute a authenticated; service_role conserva EXECUTE por default
--   privileges de Supabase (no se toca, igual que en 20260713090800/
--   20260717220000).
--
-- ES DESTRUCTIVA: no. Función nueva, no reemplaza ni altera ninguna función
--   ni tabla existente.
-- CÓMO VALIDAR (después de aplicar):
--   - pg_get_functiondef('public.sincronizar_contador(uuid, text,
--     bigint)'::regprocedure) muestra el cuerpo esperado (guard + insert/on
--     conflict con GREATEST).
--   - has_function_privilege(...) para anon = false, authenticated = true,
--     service_role = true.
--   - Correr supabase/tests/database/20260718_sincronizar_contador.test.sql
--     (pgTAP): (a) authenticated del tenant A NO puede sincronizar contadores
--     del tenant B; (b) super-admin sí; (c) service_role sí; (d) bump sube
--     (5 -> pide 100 -> devuelve 100, siguiente_contador() da 101); (e) no
--     baja (100 -> pide 50 -> sigue 100); (f) idempotencia (100 -> 100 ->
--     100, dos llamadas).
-- PLAN DE REVERSIÓN (pensado, no ejecutado automáticamente):
--   `drop function if exists public.sincronizar_contador(uuid, text,
--   bigint);` — no hay backfill ni dato derivado que limpiar, es una función
--   pura sin estado propio (el estado que toca, `tenant_contadores.valor`,
--   sigue siendo válido para `siguiente_contador()` aunque se revierta esta
--   función: un valor "adelantado" de más no rompe nada, solo salta números,
--   que es exactamente el comportamiento aceptado de una sequence).
-- =============================================================================

create or replace function public.sincronizar_contador(
  p_tenant_id uuid,
  p_contador text,
  p_valor_minimo bigint
)
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
  values (p_tenant_id, p_contador, greatest(p_valor_minimo, 0))
  on conflict (tenant_id, contador)
  do update set valor = greatest(public.tenant_contadores.valor, excluded.valor)
  returning valor into v_valor;

  return v_valor;
end;
$fn$;

comment on function public.sincronizar_contador(uuid, text, bigint) is
  'Sube (bump) el contador atómico (tenant_id, contador) de tenant_contadores '
  'a por lo menos p_valor_minimo, sin nunca bajarlo (GREATEST). Uso: tras '
  'insertar plataforma manuales altos (ej. importar clientes con plataforma '
  '100, 101, ...), sincroniza el contador ''casillero'' del tenant para que '
  'las altas automáticas futuras (siguiente_contador()) continúen por encima '
  'y no colisionen contra subclientes_tenant_casillero_unique. Nunca rellena '
  'huecos ni reutiliza números — mismo contrato de secuencia que '
  'siguiente_contador(). Valida que el llamador pertenezca al tenant '
  'solicitado, salvo que sea Super-Admin o el caller service_role (backend de '
  'confianza, igual que siguiente_contador() — 20260717220000).';

-- Grants: ESPEJO EXACTO de public.siguiente_contador(uuid, text)
-- (20260713090800/20260717220000) — revoke de public/anon, execute para
-- authenticated; service_role conserva EXECUTE por default privileges de
-- Supabase (no se toca acá, ninguna migración de este proyecto revoca
-- EXECUTE a service_role sobre funciones de negocio de confianza).
revoke all on function public.sincronizar_contador(uuid, text, bigint) from public;
revoke execute on function public.sincronizar_contador(uuid, text, bigint) from anon;
grant execute on function public.sincronizar_contador(uuid, text, bigint) to authenticated;
