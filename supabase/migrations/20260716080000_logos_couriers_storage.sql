-- =============================================================================
-- Migración: bucket de Storage `logos-couriers` (F3.4 de la tarea 2.1) —
-- BUCKET-ONLY, sin políticas RLS sobre storage.objects.
-- -----------------------------------------------------------------------------
-- LIMITACIÓN ESTRUCTURAL DESCUBIERTA EN EJECUCIÓN REAL (2026-07-16): la
-- versión original de esta migración incluía `create policy ... on
-- storage.objects` (INSERT admin/super-admin + SELECT pública). Al aplicarla
-- de verdad contra el proyecto Supabase hosted, `CREATE POLICY` sobre
-- `storage.objects` falló con:
--
--   42501: must be owner of relation objects
--
-- En Supabase hosted, la tabla `storage.objects` es propiedad de
-- `supabase_storage_admin`; la conexión que corre migraciones/`apply_migration`
-- /`db push` (el rol `postgres`) NO tiene membresía en ese rol de owner, y
-- `CREATE POLICY` exige ser el owner (o tener membresía en el owner) de la
-- tabla — a diferencia de políticas sobre tablas de `public.*`, que sí son
-- propiedad de `postgres`. Esto es estructural del proyecto hosted, no un
-- typo ni un permiso que se pueda otorgar con un `grant` normal: NO es
-- aplicable por SQL/migración en este entorno.
--
-- DECISIÓN DE ARQUITECTURA (orquestador, 2026-07-16, documentada acá para no
-- reabrirla en una ronda futura sin preguntar primero): esta migración queda
-- BUCKET-ONLY. CERO políticas sobre `storage.objects` para este bucket ->
-- deny-by-default real (sin ninguna política, RLS bloquea CUALQUIER
-- INSERT/UPDATE/DELETE directo de un cliente, sea `anon`, `authenticated` o
-- incluso un Admin/Super-Admin autenticado — nadie escribe directo a este
-- bucket vía Supabase Storage API/postgrest). La ÚNICA vía de escritura es la
-- server action `subirLogoCourier` (backend-app), que corre en el servidor
-- con el cliente **service-role** (bypassa RLS de Storage por diseño, nunca
-- expuesto al cliente — prohibición de CLAUDE.md/service_role en código de
-- cliente sigue intacta: el service-role vive SOLO en el servidor) y arma el
-- path `<tenant_id>/logo-<hash>.png` a partir del tenant resuelto en el
-- CONTEXTO del request autenticado, jamás de un valor que venga del cliente.
-- La validación de permiso (`config_courier:editar`, rol Admin) y la
-- resolución de tenant viven en esa server action, no en RLS de Storage.
--
-- La lectura pública (logos embebidos en emails de facturas, deben verse sin
-- sesión) sale del flag `public = true` en `storage.buckets` — Supabase sirve
-- el endpoint `/storage/v1/object/public/<bucket>/<path>` para buckets
-- públicos SIN pasar por RLS de `storage.objects` en absoluto; no hace falta
-- ninguna política de SELECT para que esa URL funcione.
--
-- Si en el futuro se necesitara escritura DIRECTA de clientes a este bucket
-- (sin pasar por la server action), habría que crear las políticas de
-- `storage.objects` por otra vía — Dashboard de Supabase (Storage > Policies)
-- o la Management API, corriendo con privilegios que sí alcanzan a
-- `supabase_storage_admin` — nunca por una migración de este repo. Esa
-- necesidad no existe hoy (F3.4 solo pide subida de logo por el Admin del
-- courier, ya cubierta por la server action).
-- -----------------------------------------------------------------------------
-- IMPACTO: crea/actualiza UNA fila en `storage.buckets` (`logos-couriers`,
--   public = true, con file_size_limit/allowed_mime_types si esas columnas
--   existen en este proyecto — chequeo defensivo contra
--   information_schema.columns, igual que en la versión original). NO crea
--   ninguna política sobre `storage.objects` (ver limitación arriba). NO toca
--   ninguna tabla de negocio (`public.*`) ni ningún otro bucket.
-- ES DESTRUCTIVA: no. No borra ni modifica ningún bucket existente. No hay
--   datos previos en `logos-couriers` (bucket nuevo).
-- CÓMO VALIDAR: verificar con el MCP (`list_buckets`/consulta directa a
--   storage.buckets) que el bucket existe, es público, y con la config de
--   tamaño/mime esperada. Verificar con `get_advisors` o una consulta a
--   pg_policies que NO existe ninguna política sobre storage.objects para
--   bucket_id = 'logos-couriers' (deny-by-default real). Correr la suite
--   pgTAP de esta tarea (supabase/tests/database/
--   20260716_logos_couriers_storage.test.sql): confirma la config del bucket
--   y que un INSERT directo de un Admin autenticado a storage.objects para
--   este bucket falla (sin política -> deny). Las pruebas de autorización de
--   la subida (permiso config_courier:editar, resolución de tenant desde
--   contexto) viven en Vitest sobre la server action `subirLogoCourier`
--   (backend-app), no en esta suite de BD.
-- PLAN DE REVERSIÓN: `delete from storage.buckets where id =
--   'logos-couriers';` (solo si no quedaron objetos subidos — si los hay,
--   borrarlos primero: `delete from storage.objects where bucket_id =
--   'logos-couriers';`, requiere privilegios de owner de storage.objects, ver
--   limitación arriba — en la práctica, correrlo vía Dashboard/Management
--   API, no vía migración). Ninguna tabla de negocio referencia este bucket
--   todavía (F3.4 es la primera pieza de BD/Storage de la tarea 2.1), así que
--   no hay FKs de aplicación que romper.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- storage.buckets: crear (o dejar en el estado esperado) 'logos-couriers'.
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('logos-couriers', 'logos-couriers', true)
on conflict (id) do update set public = excluded.public;

-- Límite de tamaño / mime types permitidos: solo si las columnas existen en
-- este proyecto (estilo defensivo — ver IMPACTO arriba). EXECUTE dinámico
-- porque una referencia ESTÁTICA a una columna inexistente rompería el
-- CREATE/parseo de esta migración entera, no solo el UPDATE puntual.
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
      using 2 * 1024 * 1024, 'logos-couriers';
  else
    raise notice 'storage.buckets.file_size_limit no existe en este proyecto — omitido (bucket logos-couriers creado sin límite de tamaño a nivel de columna)';
  end if;

  if v_tiene_allowed_mime_types then
    execute 'update storage.buckets set allowed_mime_types = $1 where id = $2'
      using array['image/png', 'image/jpeg', 'image/webp']::text[], 'logos-couriers';
  else
    raise notice 'storage.buckets.allowed_mime_types no existe en este proyecto — omitido (bucket logos-couriers creado sin restricción de mime type a nivel de columna)';
  end if;
end
$fn$;

-- -----------------------------------------------------------------------------
-- storage.objects: A PROPÓSITO, sin políticas para este bucket.
-- -----------------------------------------------------------------------------
-- RLS ya viene habilitada por Supabase en storage.objects para todo proyecto
-- (tabla del sistema, compartida entre todos los buckets, propiedad de
-- supabase_storage_admin — ver limitación de ownership arriba). Sin NINGUNA
-- política para bucket_id = 'logos-couriers', el resultado es deny-by-default
-- real: ningún cliente (anon, authenticated, ni siquiera un Admin/Super-Admin
-- autenticado) puede INSERT/UPDATE/DELETE directo contra este bucket vía la
-- Storage API. La única escritura permitida es la server action
-- `subirLogoCourier`, que usa el cliente service-role (bypassa RLS por
-- diseño, solo en servidor) — ver el bloque de decisión de arquitectura al
-- inicio de este archivo.
