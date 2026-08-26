-- =============================================================================
-- Migración: bucket de Storage `comprobantes-suscripcion` (feature "cobro de
-- la suscripción a los tenants", capa de persistencia del comprobante de
-- pago). BUCKET-ONLY, PRIVADO, sin políticas RLS sobre storage.objects.
-- Espejo EXACTO del patrón de `documentos` (20260803130000) y `logos-tenants`
-- (20260716080000).
-- -----------------------------------------------------------------------------
-- LIMITACIÓN ESTRUCTURAL (no re-descubierta acá, solo re-aplicada — ver
-- aprendizaje de arquitecto-db 2026-07-16): en Supabase hosted,
-- `storage.objects` es propiedad de `supabase_storage_admin`; el rol
-- `postgres` que corre migraciones NO puede `CREATE POLICY` sobre ella
-- (42501 "must be owner of relation objects"). Esta migración es BUCKET-ONLY
-- desde el diseño: CERO políticas sobre `storage.objects` para `bucket_id =
-- 'comprobantes-suscripcion'`.
--
-- DECISIÓN DE ARQUITECTURA (mismo criterio que `documentos`):
--   - Bucket PRIVADO (`public = false`): cada objeto es un comprobante de
--     pago (imagen/PDF) de un tenant específico, PII financiera.
--   - La ÚNICA vía de ESCRITURA es una server action de backend-app con el
--     cliente **service-role** (bypassa RLS de Storage por diseño, nunca
--     expuesto al cliente — la prohibición de CLAUDE.md sobre service_role
--     en código de cliente sigue intacta: vive solo en el servidor). Esa
--     server action sube los bytes del comprobante YA VALIDADOS (magic
--     bytes: imagen o PDF, tope de tamaño) al path determinístico
--     `<tenant_id>/<factura_id>-<hash>.<ext>` (ver CONTRATO DE PATH). Luego
--     invoca la RPC `public.reportar_pago_suscripcion` (20260815096000) para
--     persistir SOLO el path relativo en `suscripcion_facturas.
--     comprobante_ruta` — nunca un signed URL (expira; se firma on-demand al
--     leer).
--   - La ÚNICA vía de LECTURA es una **signed URL** generada server-side
--     (`storage.createSignedUrl`, cliente service-role) al momento de que el
--     super-admin quiera VER el comprobante — mismo patrón que
--     `crearSignedUrlPdf` (`apps/web/lib/documentos/storage.ts`). Nunca una
--     URL pública ni una política de SELECT sobre storage.objects.
--
-- CONTRATO DE PATH (para backend-app): `<tenant_id>/<factura_id>-<hash>.
-- <ext>` — el sufijo hash (contenido/aleatorio) evita colisión si un tenant
-- reporta más de un comprobante para la misma factura (ej. corrige un
-- archivo subido por error antes de que el super-admin lo revise);
-- `comprobante_ruta` guarda siempre el path COMPLETO más reciente, la RPC
-- simplemente lo sobrescribe (columna de workflow, mutable — ver
-- 20260815091000, DECISIÓN 3). extensiones esperadas: png/jpg/jpeg/webp/pdf,
-- según el mime real detectado por magic bytes (regla de manejo de archivos
-- de CLAUDE.md: "Tolerante al recibir, específico al fallar" — detectar tipo
-- por CONTENIDO, no por la extensión declarada del archivo subido).
--
-- IMPACTO: crea/actualiza UNA fila en `storage.buckets`
--   (`comprobantes-suscripcion`, public = false, con file_size_limit/
--   allowed_mime_types si esas columnas existen en este proyecto — chequeo
--   defensivo, igual que `documentos`). NO crea ninguna política sobre
--   `storage.objects`. NO toca ninguna tabla de negocio ni ningún otro
--   bucket.
-- ES DESTRUCTIVA: no. Bucket nuevo, sin objetos previos.
-- CÓMO VALIDAR: bucket existe, `public = false`, config de tamaño/mime
--   esperada (10MB, image/png|jpeg|webp + application/pdf). NINGUNA política
--   sobre storage.objects para bucket_id = 'comprobantes-suscripcion'. Un
--   INSERT directo de un Admin/Super-Admin autenticado a storage.objects para
--   este bucket falla (42501, deny-by-default). Correr
--   `supabase/tests/database/20260815_suscripcion_facturas.test.sql`.
-- PLAN DE REVERSIÓN: `delete from storage.buckets where id =
--   'comprobantes-suscripcion';` (solo si no quedaron objetos subidos — si
--   los hay, borrarlos primero vía Dashboard/Management API, requiere
--   privilegios de owner de storage.objects). Ninguna tabla de negocio tiene
--   FK hacia este bucket (`suscripcion_facturas.comprobante_ruta` es un
--   `text` con el path, no una FK real).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- storage.buckets: crear (o dejar en el estado esperado) 'comprobantes-suscripcion'.
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('comprobantes-suscripcion', 'comprobantes-suscripcion', false)
on conflict (id) do update set public = excluded.public;

-- Límite de tamaño / mime types permitidos: solo si las columnas existen en
-- este proyecto (estilo defensivo, mismo que 20260803130000/20260716080000).
-- EXECUTE dinámico porque una referencia ESTÁTICA a una columna inexistente
-- rompería el parseo de esta migración entera, no solo el UPDATE puntual.
do $fn$
declare
  v_tiene_file_size_limit    boolean;
  v_tiene_allowed_mime_types boolean;
begin
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'storage' and table_name = 'buckets' and column_name = 'file_size_limit'
  ) into v_tiene_file_size_limit;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'storage' and table_name = 'buckets' and column_name = 'allowed_mime_types'
  ) into v_tiene_allowed_mime_types;

  if v_tiene_file_size_limit then
    execute 'update storage.buckets set file_size_limit = $1 where id = $2'
      using 10 * 1024 * 1024, 'comprobantes-suscripcion';
  else
    raise notice 'storage.buckets.file_size_limit no existe en este proyecto — omitido (bucket comprobantes-suscripcion creado sin límite de tamaño a nivel de columna)';
  end if;

  if v_tiene_allowed_mime_types then
    execute 'update storage.buckets set allowed_mime_types = $1 where id = $2'
      using array['image/png', 'image/jpeg', 'image/webp', 'application/pdf']::text[], 'comprobantes-suscripcion';
  else
    raise notice 'storage.buckets.allowed_mime_types no existe en este proyecto — omitido (bucket comprobantes-suscripcion creado sin restricción de mime type a nivel de columna)';
  end if;
end
$fn$;

-- -----------------------------------------------------------------------------
-- storage.objects: A PROPÓSITO, sin políticas para este bucket (ver
-- limitación estructural y decisión de arquitectura al inicio de este
-- archivo).
-- -----------------------------------------------------------------------------
