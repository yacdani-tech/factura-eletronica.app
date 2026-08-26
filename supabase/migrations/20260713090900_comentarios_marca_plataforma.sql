-- =============================================================================
-- Migración: comentarios del catálogo con la marca correcta de la plataforma
-- (Plataforma.app)
-- -----------------------------------------------------------------------------
-- IMPACTO: solo COMMENT ON (metadatos del catálogo, visibles en el Table
-- Editor del dashboard de Supabase y en list_tables del MCP). Cero cambio de
-- esquema, datos, permisos o comportamiento. Decisión de Yac (2026-07-13):
-- el nombre de la empresa operadora que aparecía en los comentarios era
-- incorrecto — la empresa/plataforma se llama Plataforma.app y ninguna otra
-- marca debe aparecer en el proyecto.
--
-- Los mismos textos se corrigieron también EN SITIO en las migraciones que
-- los crearon (`20260713090000`, `20260713090200`) — edición de comentarios
-- SQL únicamente, sin tocar una sola sentencia DDL, para que la marca vieja
-- tampoco quede en el repo (pedido explícito: "quitar toda referencia donde
-- esté"). Un entorno fresco (db reset) crea los comentarios ya corregidos y
-- esta migración los re-aplica idéntico (COMMENT ON es idempotente por
-- naturaleza: siempre pisa el valor completo); el proyecto remoto —que ya
-- había aplicado los textos viejos— converge al mismo estado con esta
-- migración. Ambos caminos terminan byte a byte iguales.
-- ES DESTRUCTIVA: no.
-- CÓMO VALIDAR:
--   select obj_description('public.super_admins'::regclass);
--   select d.description from pg_proc p
--     join pg_namespace n on n.oid = p.pronamespace
--     left join pg_description d on d.objoid = p.oid
--    where n.nspname = 'private' and p.proname = 'is_super_admin';
--   -- ambos deben decir 'Plataforma.app' (ninguna otra marca).
-- PLAN DE REVERSIÓN: re-emitir los COMMENT ON con el texto anterior (está en
-- el historial de git de las migraciones originales).
-- =============================================================================

comment on table public.super_admins is
  'Rol de plataforma de Plataforma.app (mínimo en el MVP). Quién administra esta tabla '
  '(alta del primer super-admin) es un procedimiento operativo fuera de la '
  'app, no expuesto por RLS a usuarios comunes.';

comment on function private.is_super_admin() is
  'true si auth.uid() está registrado en super_admins (rol de plataforma de Plataforma.app).';
