-- =============================================================================
-- Migración: RPCs de lectura CROSS-TENANT (super-admin) de suscripciones —
-- `public.listar_suscripciones_tenants()` y `public.
-- obtener_suscripcion_por_tenant(p_tenant_id uuid)`. Quinto paso de "cobro de
-- la suscripción a los tenants" (aprobada por Yac 2026-08-15).
-- -----------------------------------------------------------------------------
-- IMPACTO: crea 2 funciones nuevas de SOLO LECTURA (ningún INSERT/UPDATE/
-- DELETE), sin tocar ninguna tabla/columna/política existente.
-- ES DESTRUCTIVA: no.
--
-- CONTRATO — `public.listar_suscripciones_tenants()` (sin argumentos):
--   1 fila POR CADA tenant de la plataforma (LEFT JOIN desde `tenants`, mismo
--   criterio que `metricas_tenants_periodo`/`reporte_anulaciones_por_
--   tenant`: un tenant sin ninguna factura de suscripción generada todavía
--   -ej. si nadie llamó aún a `asegurar_facturas_suscripcion_todos`- aparece
--   igual, con las columnas de factura en NULL, nunca desaparece del
--   listado):
--     tenant_id, nombre, subdominio, estado_tenant (public.estado_tenant),
--     plan_nombre (NULL si el tenant no tiene plan asignado), monto_usd,
--     estado_factura (public.estado_suscripcion_factura, NULL si no hay
--     factura), fecha_vencimiento, dias_atraso, tiene_comprobante (boolean,
--     false si no hay factura o no se subió comprobante), factura_id.
--   "La factura VIGENTE" = la de mayor `periodo_inicio` para ese tenant
--   (`LEFT JOIN LATERAL ... ORDER BY periodo_inicio DESC LIMIT 1`) — el
--   ciclo más reciente ya generado, sea el actual o uno pasado si la
--   generación no se invocó recientemente.
--   `dias_atraso` = `greatest(0, hoy - fecha_vencimiento)` cuando la factura
--   existe y su estado <> 'pagado'; 0 si está pagada o si no hay factura
--   (nunca negativo, nunca NULL).
--   Orden: `nombre asc` (mismo criterio que el resto de los listados de
--   super-admin; la UI reordena/pagina aparte).
--
-- CONTRATO — `public.obtener_suscripcion_por_tenant(p_tenant_id uuid)`:
--   TODAS las facturas de ESE tenant, `periodo_inicio desc` (la más reciente
--   primero = la vigente): factura_id, periodo_inicio, periodo_fin,
--   monto_usd, estado, fecha_emision, fecha_vencimiento, comprobante_ruta,
--   referencia_pago, reportado_en, pagado_en, nota_super_admin, dias_atraso
--   (mismo cálculo que arriba) y `es_vigente` (boolean: true SOLO en la fila
--   con el `periodo_inicio` más alto, vía `max(...) over ()` — evita que
--   backend-app tenga que re-derivar "cuál es la vigente" comparando fechas
--   en TypeScript). Pensada para la tarjeta de suscripción de `/soporte/
--   tenants/[id]` (factura vigente + histórico en una sola llamada, sin
--   N+1). Tenant sin ninguna factura -> 0 filas (no es un error).
--
-- SEGURIDAD: SECURITY DEFINER con guardia interno `private.is_super_admin()`
-- — copia EXACTA del patrón de `metricas_tenants_periodo`/`kpis_plataforma_
-- periodo` (20260814130000/150000): ninguna de las tablas leídas
-- (`suscripcion_facturas`, cuya RLS solo cubre el propio tenant o
-- super-admin PERO fila por fila, no este cruce agregado con `tenants`/
-- `planes`) tiene una política que habilite este JOIN cross-tenant completo
-- para un Admin normal. `revoke` de `public`/`anon` explícito (aprendizaje
-- 2026-07-13); `grant execute` a `authenticated` (el guard interno filtra
-- por rol real).
--
-- CÓMO VALIDAR (con `supabase db query --linked`, después de aplicar):
--   - `information_schema.routines`: ambas funciones existen, `prosecdef =
--     true`; `anon` sin EXECUTE, `authenticated` con EXECUTE.
--   - Un Admin normal (no super-admin) llamando cualquiera de las 2 -> 42501.
--   - `listar_suscripciones_tenants()` devuelve 1 fila por cada tenant
--     existente, incluidos los sin factura generada (columnas de factura en
--     NULL, dias_atraso = 0, tiene_comprobante = false).
--   - `obtener_suscripcion_por_tenant(<tenant con 3 facturas>)` devuelve 3
--     filas, `periodo_inicio desc`, con `es_vigente = true` solo en la
--     primera.
--   - Correr `supabase/tests/database/20260815_suscripcion_facturas.test.sql`.
-- PLAN DE REVERSIÓN (pensado, no ejecutado automáticamente):
--   drop function if exists public.obtener_suscripcion_por_tenant(uuid);
--   drop function if exists public.listar_suscripciones_tenants();
-- =============================================================================

create or replace function public.listar_suscripciones_tenants()
returns table (
  tenant_id          uuid,
  nombre             text,
  subdominio         text,
  estado_tenant      public.estado_tenant,
  plan_nombre        text,
  monto_usd          numeric,
  estado_factura     public.estado_suscripcion_factura,
  fecha_vencimiento  date,
  dias_atraso        integer,
  tiene_comprobante  boolean,
  factura_id         uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_hoy date;
begin
  -- Guardia: única puerta de entrada (mismo patrón que metricas_tenants_
  -- periodo/kpis_plataforma_periodo) -- ninguna política de suscripcion_
  -- facturas cubre este cruce cross-tenant con tenants/planes.
  if not (select private.is_super_admin()) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  v_hoy := private.hoy_en_costa_rica();

  return query
  select
    t.id as tenant_id,
    t.nombre as nombre,
    t.subdominio as subdominio,
    t.estado as estado_tenant,
    pl.nombre as plan_nombre,
    vf.monto_usd as monto_usd,
    vf.estado as estado_factura,
    vf.fecha_vencimiento as fecha_vencimiento,
    case
      when vf.id is null or vf.estado = 'pagado'::public.estado_suscripcion_factura then 0
      else greatest(0, (v_hoy - vf.fecha_vencimiento))
    end as dias_atraso,
    (vf.comprobante_ruta is not null) as tiene_comprobante,
    vf.id as factura_id
  from public.tenants t
  left join public.planes pl on pl.id = t.plan_id
  left join lateral (
    select sf.*
    from public.suscripcion_facturas sf
    where sf.tenant_id = t.id
    order by sf.periodo_inicio desc
    limit 1
  ) vf on true
  order by t.nombre asc;
end;
$fn$;

comment on function public.listar_suscripciones_tenants() is
  'Super-admin: 1 fila POR CADA tenant (LEFT JOIN) con su factura de '
  'suscripción VIGENTE (mayor periodo_inicio ya generado). dias_atraso = '
  'greatest(0, hoy - fecha_vencimiento) cuando hay factura y estado <> '
  'pagado; 0 si está pagada o si el tenant aún no tiene ninguna factura '
  'generada. Pensada para /soporte/suscripciones, típicamente llamada '
  'DESPUÉS de public.asegurar_facturas_suscripcion_todos() (20260815094000). '
  'SECURITY DEFINER con guardia interno private.is_super_admin().';

revoke all on function public.listar_suscripciones_tenants() from public;
revoke execute on function public.listar_suscripciones_tenants() from anon;
grant execute on function public.listar_suscripciones_tenants() to authenticated;

create or replace function public.obtener_suscripcion_por_tenant(p_tenant_id uuid)
returns table (
  factura_id         uuid,
  periodo_inicio     date,
  periodo_fin        date,
  monto_usd          numeric,
  estado             public.estado_suscripcion_factura,
  fecha_emision      date,
  fecha_vencimiento  date,
  comprobante_ruta   text,
  referencia_pago    text,
  reportado_en       timestamptz,
  pagado_en          timestamptz,
  nota_super_admin   text,
  dias_atraso        integer,
  es_vigente         boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_hoy date;
begin
  if not (select private.is_super_admin()) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  v_hoy := private.hoy_en_costa_rica();

  return query
  select
    sf.id as factura_id,
    sf.periodo_inicio,
    sf.periodo_fin,
    sf.monto_usd,
    sf.estado,
    sf.fecha_emision,
    sf.fecha_vencimiento,
    sf.comprobante_ruta,
    sf.referencia_pago,
    sf.reportado_en,
    sf.pagado_en,
    sf.nota_super_admin,
    case
      when sf.estado = 'pagado'::public.estado_suscripcion_factura then 0
      else greatest(0, (v_hoy - sf.fecha_vencimiento))
    end as dias_atraso,
    (sf.periodo_inicio = max(sf.periodo_inicio) over ()) as es_vigente
  from public.suscripcion_facturas sf
  where sf.tenant_id = p_tenant_id
  order by sf.periodo_inicio desc;
end;
$fn$;

comment on function public.obtener_suscripcion_por_tenant(uuid) is
  'Super-admin: TODAS las facturas de suscripción de un tenant, periodo_'
  'inicio desc, con dias_atraso derivado (mismo criterio que '
  'listar_suscripciones_tenants) y es_vigente=true SOLO en la fila con el '
  'periodo_inicio más alto (max(...) over ()). Tenant sin ninguna factura -> '
  '0 filas (no es un error). Pensada para la tarjeta de suscripción de '
  '/soporte/tenants/[id]. SECURITY DEFINER con guardia interno '
  'private.is_super_admin().';

revoke all on function public.obtener_suscripcion_por_tenant(uuid) from public;
revoke execute on function public.obtener_suscripcion_por_tenant(uuid) from anon;
grant execute on function public.obtener_suscripcion_por_tenant(uuid) to authenticated;
