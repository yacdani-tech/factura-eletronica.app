-- =============================================================================
-- Migración: RPCs de mutación del workflow de pago de suscripción —
-- `reportar_pago_suscripcion` (tenant), `marcar_pago_suscripcion` /
-- `revertir_pago_suscripcion` / `actualizar_precio_suscripcion_tenant`
-- (super-admin). Sexto y último paso de BD de "cobro de la suscripción a los
-- tenants" (aprobada por Yac 2026-08-15).
-- -----------------------------------------------------------------------------
-- IMPACTO: crea 4 funciones nuevas (`SECURITY DEFINER`). 3 de ellas
-- (`reportar_pago_suscripcion`/`marcar_pago_suscripcion`/`revertir_pago_
-- suscripcion`) son la ÚNICA vía de UPDATE sobre `public.suscripcion_
-- facturas` (que no tiene política de UPDATE para ningún rol, 20260815091000
-- DECISIÓN 2) y solo tocan columnas de WORKFLOW (permitidas por `trg_
-- suscripcion_facturas_proteger_inmutabilidad`, nunca `monto_usd`/período/
-- fechas — regla dura #6). `actualizar_precio_suscripcion_tenant` es la vía
-- recomendada (contrato de capa app, ver 20260815090000) para tocar `tenants.
-- precio_suscripcion_usd`.
-- ES DESTRUCTIVA: no. Puramente aditiva (4 funciones nuevas).
--
-- DISEÑO COMÚN A LAS 3 QUE TOCAN `suscripcion_facturas`: `select ... for
-- update` primero (lockea la fila y resuelve existencia/estado/tenant en un
-- solo viaje), UPDATE explícito de SOLO las columnas de workflow que le
-- corresponden a esa transición, y `get diagnostics ... row_count` tras el
-- UPDATE para verificar que se afectó EXACTAMENTE 1 fila (aprendizaje de
-- arquitecto-db 2026-07-14: un UPDATE de negocio no debe fallar en silencio
-- si termina afectando 0 filas por una condición de carrera o un filtro que
-- no matchea).
--
-- CONTRATO — `public.reportar_pago_suscripcion(p_factura_id uuid,
-- p_comprobante_ruta text, p_referencia text)`:
--   - Requiere tenant de sesión (`private.current_tenant_id()`); si la
--     factura no existe o pertenece a OTRO tenant, 42501 sin distinguir
--     ambos casos en el mensaje (regla dura #1: nunca filtrar existencia
--     cross-tenant, ni siquiera vía el texto del error).
--   - Rechaza si `estado = 'pagado'` (mensaje claro, no 42501 — es una regla
--     de negocio, no de autorización). Permite reportar/re-reportar sobre
--     'pendiente' o 'reportado' (el tenant puede corregir un comprobante
--     subido por error antes de que el super-admin lo revise).
--   - `p_comprobante_ruta` obligatorio y no vacío (la subida real del
--     archivo al bucket `comprobantes-suscripcion`, 20260815093000, la hace
--     la server action de backend-app con service-role ANTES de llamar a
--     esta RPC; acá solo se persiste el path).
--   - Efecto: `estado='reportado'`, `comprobante_ruta`, `referencia_pago`,
--     `reportado_por = auth.uid()` (NUNCA del payload — regla dura #13),
--     `reportado_en = now()`.
--
-- CONTRATO — `public.marcar_pago_suscripcion(p_factura_id uuid, p_nota text
-- default null)` (super-admin): `estado='pagado'`, `pagado_en = now()`,
-- `marcado_pagado_por = auth.uid()`, `nota_super_admin = coalesce(p_nota,
-- nota_super_admin)` (una nota nueva reemplaza a la anterior; sin nota nueva,
-- conserva la que hubiera). Sin restricción de estado previo (idempotente:
-- re-marcar una ya pagada solo actualiza el timestamp/nota).
--
-- CONTRATO — `public.revertir_pago_suscripcion(p_factura_id uuid)`
-- (super-admin): corrige un error de marcado. Exige `estado = 'pagado'` (si
-- no, mensaje claro). Efecto: `estado='pendiente'`, limpia `pagado_en`/
-- `marcado_pagado_por`; CONSERVA `comprobante_ruta`/`referencia_pago`/
-- `reportado_en`/`reportado_por` (el historial de que el tenant SÍ reportó
-- un pago en su momento no se borra, solo se deshace la confirmación).
--
-- CONTRATO — `public.actualizar_precio_suscripcion_tenant(p_tenant_id uuid,
-- p_precio numeric)` (super-admin): `update tenants set precio_suscripcion_
-- usd = p_precio`. `p_precio` puede ser NULL ("volver a usar el precio del
-- plan"); si no es NULL, exige `>= 0`. NO afecta ninguna factura ya generada
-- (monto_usd es un snapshot congelado, regla dura #6) — solo la PRÓXIMA
-- factura que se genere usará el nuevo precio.
--
-- SEGURIDAD: SECURITY DEFINER (necesario para `reportar_pago_suscripcion`,
-- que sin esto no podría hacer NINGÚN UPDATE contra una tabla sin política
-- de UPDATE) con guardias internos explícitos: `reportar_pago_suscripcion`
-- valida tenant propio; las otras 3 exigen `private.is_super_admin()`
-- (42501). `revoke` de `public`/`anon` explícito (aprendizaje 2026-07-13);
-- `grant execute` a `authenticated` en las 4.
--
-- CÓMO VALIDAR (con `supabase db query --linked`, después de aplicar):
--   - `information_schema.routines`: las 4 funciones existen, `prosecdef =
--     true`; `anon` sin EXECUTE, `authenticated` con EXECUTE.
--   - `reportar_pago_suscripcion` por el DUEÑO de la factura -> pasa a
--     'reportado'; por OTRO tenant -> 42501; sobre una 'pagado' -> error de
--     negocio (no 42501).
--   - `marcar_pago_suscripcion`/`revertir_pago_suscripcion`/`actualizar_
--     precio_suscripcion_tenant` por un Admin normal (no super-admin) ->
--     42501 en las 3.
--   - `revertir_pago_suscripcion` sobre una factura 'pendiente'/'reportado'
--     (no pagada) -> error de negocio.
--   - Cambiar el precio del plan/override DESPUÉS de generada una factura no
--     altera su `monto_usd` (protegido por
--     trg_suscripcion_facturas_proteger_inmutabilidad, 20260815091000).
--   - Correr `supabase/tests/database/20260815_suscripcion_facturas.test.sql`.
-- PLAN DE REVERSIÓN (pensado, no ejecutado automáticamente):
--   drop function if exists public.actualizar_precio_suscripcion_tenant(uuid, numeric);
--   drop function if exists public.revertir_pago_suscripcion(uuid);
--   drop function if exists public.marcar_pago_suscripcion(uuid, text);
--   drop function if exists public.reportar_pago_suscripcion(uuid, text, text);
-- =============================================================================

create or replace function public.reportar_pago_suscripcion(
  p_factura_id uuid,
  p_comprobante_ruta text,
  p_referencia text
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_tenant_sesion  uuid;
  v_tenant_factura uuid;
  v_estado         public.estado_suscripcion_factura;
  v_filas          integer;
begin
  v_tenant_sesion := (select private.current_tenant_id());
  if v_tenant_sesion is null then
    raise exception 'Debe iniciar sesión con un tenant válido para reportar un pago.';
  end if;

  if p_comprobante_ruta is null or btrim(p_comprobante_ruta) = '' then
    raise exception 'Debe indicar la ruta del comprobante subido.';
  end if;

  select sf.tenant_id, sf.estado
    into v_tenant_factura, v_estado
    from public.suscripcion_facturas sf
   where sf.id = p_factura_id
   for update;

  -- No distinguir "no existe" de "es de otro tenant" en el mensaje (regla
  -- dura #1: nunca filtrar información cross-tenant).
  if not found or v_tenant_factura <> v_tenant_sesion then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  if v_estado = 'pagado'::public.estado_suscripcion_factura then
    raise exception
      'La factura % ya está pagada; no se puede reportar un pago sobre una factura pagada.',
      p_factura_id;
  end if;

  update public.suscripcion_facturas
     set estado = 'reportado'::public.estado_suscripcion_factura,
         comprobante_ruta = p_comprobante_ruta,
         referencia_pago = p_referencia,
         reportado_por = (select auth.uid()),
         reportado_en = now()
   where id = p_factura_id
     and tenant_id = v_tenant_sesion;

  get diagnostics v_filas = row_count;
  if v_filas <> 1 then
    raise exception
      'reportar_pago_suscripcion: no se pudo actualizar la factura % (filas afectadas = %).',
      p_factura_id, v_filas;
  end if;
end;
$fn$;

comment on function public.reportar_pago_suscripcion(uuid, text, text) is
  'El tenant de sesión reporta el pago de UNA de sus facturas de '
  'suscripción: estado -> reportado, guarda comprobante_ruta/referencia_pago '
  'y reportado_por=auth.uid()/reportado_en=now(). Rechaza si la factura es '
  'de otro tenant (42501, sin distinguir "no existe" de "es de otro tenant") '
  'o si ya está pagada (error de negocio). La subida real del archivo al '
  'bucket comprobantes-suscripcion (20260815093000) la hace la server action '
  'con service-role ANTES de invocar esta RPC.';

revoke all on function public.reportar_pago_suscripcion(uuid, text, text) from public;
revoke execute on function public.reportar_pago_suscripcion(uuid, text, text) from anon;
grant execute on function public.reportar_pago_suscripcion(uuid, text, text) to authenticated;

create or replace function public.marcar_pago_suscripcion(
  p_factura_id uuid,
  p_nota text default null
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

  update public.suscripcion_facturas
     set estado = 'pagado'::public.estado_suscripcion_factura,
         pagado_en = now(),
         marcado_pagado_por = (select auth.uid()),
         nota_super_admin = coalesce(p_nota, nota_super_admin)
   where id = p_factura_id;

  get diagnostics v_filas = row_count;
  if v_filas <> 1 then
    raise exception 'marcar_pago_suscripcion: no se encontró la factura %.', p_factura_id;
  end if;
end;
$fn$;

comment on function public.marcar_pago_suscripcion(uuid, text) is
  'Super-admin: confirma el pago de una factura de suscripción: estado -> '
  'pagado, pagado_en=now(), marcado_pagado_por=auth.uid(), nota_super_admin '
  '= coalesce(p_nota, la que hubiera). Idempotente (re-marcar una ya pagada '
  'solo actualiza timestamp/nota/actor). SECURITY DEFINER con guardia '
  'interno private.is_super_admin().';

revoke all on function public.marcar_pago_suscripcion(uuid, text) from public;
revoke execute on function public.marcar_pago_suscripcion(uuid, text) from anon;
grant execute on function public.marcar_pago_suscripcion(uuid, text) to authenticated;

create or replace function public.revertir_pago_suscripcion(p_factura_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_estado public.estado_suscripcion_factura;
  v_filas  integer;
begin
  if not (select private.is_super_admin()) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  select sf.estado into v_estado
    from public.suscripcion_facturas sf
   where sf.id = p_factura_id
   for update;

  if not found then
    raise exception 'revertir_pago_suscripcion: no se encontró la factura %.', p_factura_id;
  end if;

  if v_estado <> 'pagado'::public.estado_suscripcion_factura then
    raise exception
      'La factura % no está pagada; no hay ningún pago que revertir.',
      p_factura_id;
  end if;

  update public.suscripcion_facturas
     set estado = 'pendiente'::public.estado_suscripcion_factura,
         pagado_en = null,
         marcado_pagado_por = null
   where id = p_factura_id;

  get diagnostics v_filas = row_count;
  if v_filas <> 1 then
    raise exception
      'revertir_pago_suscripcion: no se pudo revertir la factura % (filas afectadas = %).',
      p_factura_id, v_filas;
  end if;
end;
$fn$;

comment on function public.revertir_pago_suscripcion(uuid) is
  'Super-admin: corrige un marcado de pago erróneo. Exige estado=pagado (si '
  'no, error de negocio). Efecto: estado -> pendiente, limpia pagado_en/ '
  'marcado_pagado_por; CONSERVA comprobante_ruta/referencia_pago/'
  'reportado_en/reportado_por (el historial de que el tenant reportó un '
  'pago no se borra, solo se deshace la confirmación del super-admin). '
  'SECURITY DEFINER con guardia interno private.is_super_admin().';

revoke all on function public.revertir_pago_suscripcion(uuid) from public;
revoke execute on function public.revertir_pago_suscripcion(uuid) from anon;
grant execute on function public.revertir_pago_suscripcion(uuid) to authenticated;

create or replace function public.actualizar_precio_suscripcion_tenant(
  p_tenant_id uuid,
  p_precio numeric
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

  if p_precio is not null and p_precio < 0 then
    raise exception 'El precio de suscripción no puede ser negativo.';
  end if;

  update public.tenants
     set precio_suscripcion_usd = p_precio
   where id = p_tenant_id;

  get diagnostics v_filas = row_count;
  if v_filas <> 1 then
    raise exception 'actualizar_precio_suscripcion_tenant: no se encontró el tenant %.', p_tenant_id;
  end if;
end;
$fn$;

comment on function public.actualizar_precio_suscripcion_tenant(uuid, numeric) is
  'Super-admin: fija (o limpia, con p_precio NULL) el override de precio de '
  'suscripción de UN tenant (tenants.precio_suscripcion_usd). NUNCA reescribe '
  'una factura ya generada (monto_usd es un snapshot congelado, regla dura '
  '#6) -- solo afecta a la PRÓXIMA factura que se genere. Vía RECOMENDADA de '
  'capa app para tocar esta columna: precio_suscripcion_usd SÍ tiene un guard '
  'column-level nuevo (trg_tenants_proteger_precio_suscripcion, 20260815090000) '
  'que rechaza cambios salvo super-admin/service_role — esta RPC corre como '
  'super-admin y lo pasa. (El gap PREEXISTENTE de la RLS de fila de tenants, '
  'que permite a un Admin propio cambiar estado/plan_id por PATCH directo, '
  'sigue SIN guard y queda fuera de alcance de esta feature.) SECURITY DEFINER '
  'con guardia interno private.is_super_admin().';

revoke all on function public.actualizar_precio_suscripcion_tenant(uuid, numeric) from public;
revoke execute on function public.actualizar_precio_suscripcion_tenant(uuid, numeric) from anon;
grant execute on function public.actualizar_precio_suscripcion_tenant(uuid, numeric) to authenticated;
