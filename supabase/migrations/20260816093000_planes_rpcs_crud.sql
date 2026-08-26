-- =============================================================================
-- Migración: RPCs CRUD del catálogo de planes (super-admin) —
-- `public.crear_plan` / `public.editar_plan` / `public.pausar_plan`. Cuarto
-- paso de "catálogo de planes editable + propagación manual por tenant".
-- -----------------------------------------------------------------------------
-- IMPACTO: crea 3 funciones nuevas (`SECURITY DEFINER`). `planes` YA tiene
-- políticas RLS de INSERT/UPDATE reservadas a super-admin
-- (`planes_insertar_super_admin`/`planes_actualizar_super_admin`,
-- `20260713090100`) — estas RPC NO son la única vía posible de escritura (a
-- diferencia de `suscripcion_facturas`, que no tiene política de UPDATE para
-- ningún rol), son la vía RECOMENDADA de capa app: validan a mano el guardia
-- de negocio (`get diagnostics` para plan inexistente, mensajes claros en vez
-- de que la capa app dependa de leer el código de error de una RLS
-- silenciosa) y dejan que las restricciones de forma (unicidad de `codigo`,
-- CHECK de tope/precio >= 0) las siga resolviendo la BD de forma nativa
-- (23505/23514), tal como ya hacen los formularios existentes del proyecto
-- para otros catálogos.
-- ES DESTRUCTIVA: no. Puramente aditiva (3 funciones nuevas), sin tocar
-- tablas/columnas/RLS existentes.
--
-- CONTRATO — `public.crear_plan(p_codigo text, p_nombre text,
-- p_tope_documentos_mes integer, p_precio_mensual_usd numeric, p_descripcion
-- text)` returns uuid:
--   - Exige `private.is_super_admin()` (si no, 42501).
--   - `p_codigo`/`p_nombre` obligatorios (no NULL, no vacíos tras btrim) —
--     error de negocio explícito, no deja que llegue un 23502 genérico de
--     NOT NULL.
--   - INSERT con `activo = true` (default de la tabla). `p_tope_documentos_
--     mes`/`p_precio_mensual_usd`/`p_descripcion` pueden ser NULL (mismos
--     CHECK ya existentes en la tabla: tope > 0 o NULL, precio >= 0 o NULL —
--     se dejan propagar como 23514 si se violan, sin duplicar la validación
--     acá).
--   - `codigo` duplicado -> 23505 nativo (constraint UNIQUE ya existente en
--     `planes.codigo`); la capa app lo mapea a un mensaje de negocio.
--   - Retorna el `id` del plan nuevo.
--
-- CONTRATO — `public.editar_plan(p_id uuid, p_nombre text,
-- p_tope_documentos_mes integer, p_precio_mensual_usd numeric, p_descripcion
-- text)` returns void:
--   - Exige `private.is_super_admin()` (42501 si no).
--   - UPDATE de `nombre`/`tope_documentos_mes`/`precio_mensual_usd`/
--     `descripcion` ÚNICAMENTE — NUNCA toca `codigo` ni `activo` (el código
--     es la identidad estable del plan, "pausar" tiene su propia RPC
--     dedicada con su propio contrato/nombre de acción, no se mezclan en un
--     UPDATE genérico).
--   - `get diagnostics` tras el UPDATE: si `row_count <> 1`, `raise
--     exception` (plan inexistente) — mismo criterio que `marcar_pago_
--     suscripcion`/`editar_plan` del resto del proyecto (aprendizaje
--     2026-07-14: un UPDATE de negocio no debe fallar en silencio si afecta 0
--     filas).
--   - `trg_planes_actualizado_en` (20260816092000) corre solo, sin que esta
--     función tenga que tocar `actualizado_en`.
--
-- CONTRATO — `public.pausar_plan(p_id uuid, p_activo boolean)` returns void:
--   - Exige `private.is_super_admin()` (42501 si no).
--   - UPDATE de `activo` ÚNICAMENTE. `get diagnostics` -> 0 filas -> raise
--     (plan inexistente). Idempotente (pausar un plan ya pausado, o
--     reactivar uno ya activo, no lanza error).
--   - Un plan `activo = false` sigue siendo válido como FUENTE de
--     `public.propagar_plan_a_tenants` (20260816094000) y sigue apareciendo
--     para los tenants que YA lo tienen asignado (`tenants.plan_id` no se
--     toca al pausar) — "pausado" significa "no ofrecer para tenants
--     nuevos", no "invisible"; el filtro de "solo activos" en altas nuevas es
--     responsabilidad de la capa app, no de esta RPC.
--
-- SEGURIDAD: SECURITY DEFINER (necesario porque la RLS de `planes` ya exige
-- super-admin para INSERT/UPDATE, así que técnicamente un cliente
-- `authenticated` super-admin podría hacerlo directo por PostgREST también —
-- estas RPC existen por MENSAJES DE NEGOCIO consistentes y para no duplicar
-- en la capa app la lógica de "¿fue 1 fila?", no porque la RLS sea
-- insuficiente) con guardia interno `private.is_super_admin()` explícito en
-- las 3, mismo patrón que `20260815096000`. `revoke` de `public`/`anon`
-- explícito (aprendizaje 2026-07-13); `grant execute` a `authenticated`.
--
-- CÓMO VALIDAR (con `supabase db query --linked`, después de aplicar):
--   - `information_schema.routines`: las 3 funciones existen, `prosecdef =
--     true`; `anon` sin EXECUTE, `authenticated` con EXECUTE.
--   - `crear_plan`/`editar_plan`/`pausar_plan` por un Admin normal (no
--     super-admin) -> 42501 en las 3.
--   - `crear_plan` con `codigo` ya usado -> 23505.
--   - `crear_plan` con `p_codigo`/`p_nombre` vacío o NULL -> error de negocio
--     explícito (no 23502 crudo).
--   - `editar_plan` sobre un plan existente: `codigo`/`activo` quedan
--     intactos; `actualizado_en` avanza.
--   - `editar_plan`/`pausar_plan` sobre un `p_id` inexistente -> error de
--     negocio explícito ("no se encontró el plan").
--   - Correr
--     `supabase/tests/database/20260816_planes_editables_y_propagacion.test.sql`.
-- PLAN DE REVERSIÓN (pensado, no ejecutado automáticamente):
--   drop function if exists public.pausar_plan(uuid, boolean);
--   drop function if exists public.editar_plan(uuid, text, integer, numeric, text);
--   drop function if exists public.crear_plan(text, text, integer, numeric, text);
-- =============================================================================

create or replace function public.crear_plan(
  p_codigo text,
  p_nombre text,
  p_tope_documentos_mes integer,
  p_precio_mensual_usd numeric,
  p_descripcion text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_id uuid;
begin
  if not (select private.is_super_admin()) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  if p_codigo is null or btrim(p_codigo) = '' then
    raise exception 'El plan necesita un código.';
  end if;

  if p_nombre is null or btrim(p_nombre) = '' then
    raise exception 'El plan necesita un nombre.';
  end if;

  insert into public.planes (codigo, nombre, tope_documentos_mes, precio_mensual_usd, descripcion)
  values (btrim(p_codigo), btrim(p_nombre), p_tope_documentos_mes, p_precio_mensual_usd, p_descripcion)
  returning id into v_id;

  return v_id;
end;
$fn$;

comment on function public.crear_plan(text, text, integer, numeric, text) is
  'Super-admin: crea un plan nuevo en el catálogo (activo=true por default de '
  'la tabla). codigo/nombre obligatorios (error de negocio explícito si '
  'vienen vacíos/NULL); codigo duplicado -> 23505 nativo (constraint UNIQUE de '
  'planes.codigo). tope_documentos_mes/precio_mensual_usd/descripcion '
  'opcionales (CHECK ya existentes en la tabla: tope > 0 o NULL, precio >= 0 '
  'o NULL). Devuelve el id del plan nuevo. SECURITY DEFINER con guardia '
  'interno private.is_super_admin().';

revoke all on function public.crear_plan(text, text, integer, numeric, text) from public;
revoke execute on function public.crear_plan(text, text, integer, numeric, text) from anon;
grant execute on function public.crear_plan(text, text, integer, numeric, text) to authenticated;

create or replace function public.editar_plan(
  p_id uuid,
  p_nombre text,
  p_tope_documentos_mes integer,
  p_precio_mensual_usd numeric,
  p_descripcion text
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_filas integer;
begin
  if not (select private.is_super_admin()) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  if p_nombre is null or btrim(p_nombre) = '' then
    raise exception 'El plan necesita un nombre.';
  end if;

  update public.planes
     set nombre = btrim(p_nombre),
         tope_documentos_mes = p_tope_documentos_mes,
         precio_mensual_usd = p_precio_mensual_usd,
         descripcion = p_descripcion
   where id = p_id;

  get diagnostics v_filas = row_count;
  if v_filas <> 1 then
    raise exception 'editar_plan: no se encontró el plan %.', p_id;
  end if;
end;
$fn$;

comment on function public.editar_plan(uuid, text, integer, numeric, text) is
  'Super-admin: edita nombre/tope_documentos_mes/precio_mensual_usd/'
  'descripcion de UN plan existente. NUNCA toca codigo ni activo (pausar_plan '
  'es la vía dedicada para activo). actualizado_en avanza solo (trg_planes_'
  'actualizado_en, 20260816092000). Plan inexistente -> error de negocio '
  'explícito (get diagnostics row_count <> 1). SECURITY DEFINER con guardia '
  'interno private.is_super_admin(). Editar el catálogo NO afecta a ningún '
  'tenant hasta que el super-admin propague explícitamente (public.propagar_'
  'plan_a_tenants, 20260816094000).';

revoke all on function public.editar_plan(uuid, text, integer, numeric, text) from public;
revoke execute on function public.editar_plan(uuid, text, integer, numeric, text) from anon;
grant execute on function public.editar_plan(uuid, text, integer, numeric, text) to authenticated;

create or replace function public.pausar_plan(
  p_id uuid,
  p_activo boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_filas integer;
begin
  if not (select private.is_super_admin()) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  if p_activo is null then
    raise exception 'pausar_plan requiere indicar el estado activo (true/false).';
  end if;

  update public.planes
     set activo = p_activo
   where id = p_id;

  get diagnostics v_filas = row_count;
  if v_filas <> 1 then
    raise exception 'pausar_plan: no se encontró el plan %.', p_id;
  end if;
end;
$fn$;

comment on function public.pausar_plan(uuid, boolean) is
  'Super-admin: activa/pausa UN plan (activo=p_activo). Idempotente. NO '
  'desasigna el plan de los tenants que ya lo tienen (tenants.plan_id no se '
  'toca) -- "pausado" significa no ofrecerlo para altas nuevas, filtro que '
  'resuelve la capa app. Plan inexistente -> error de negocio explícito. '
  'SECURITY DEFINER con guardia interno private.is_super_admin().';

revoke all on function public.pausar_plan(uuid, boolean) from public;
revoke execute on function public.pausar_plan(uuid, boolean) from anon;
grant execute on function public.pausar_plan(uuid, boolean) to authenticated;
