-- =============================================================================
-- Migración: `configuracion_plataforma.dias_atraso_sugerir_bloqueo` — umbral
-- GLOBAL configurable (días de atraso de pago de suscripción a partir de los
-- cuales la consola de super-admin resalta a un tenant como candidato a
-- bloqueo). Tercer paso de "cobro de la suscripción a los couriers"
-- (aprobada por Yac 2026-08-15).
-- -----------------------------------------------------------------------------
-- IMPACTO: agrega 1 columna nueva a la tabla SINGLETON ya existente
-- `public.configuracion_plataforma` (20260813130000) — mismo patrón que esa
-- migración documenta explícitamente ("si en el futuro se suman más
-- parámetros globales, son columnas nuevas de esta misma fila"). No crea
-- fila nueva, no toca RLS/triggers/políticas existentes de esa tabla (siguen
-- intactos: solo super-admin lee/edita, sin INSERT/DELETE para nadie).
-- ES DESTRUCTIVA: no. `alter table add column ... not null default 15` puebla
-- la única fila existente con el default sin fallar (columna NOT NULL con
-- DEFAULT sobre una tabla con filas: Postgres la resuelve en un solo paso,
-- sin reescritura de tabla completa desde PG11+).
--
-- DISEÑO: `dias_atraso_sugerir_bloqueo integer NOT NULL DEFAULT 15 CHECK (>=
-- 0)` — default 15 (decisión de Yac). Es SOLO una sugerencia visual/de
-- ordenamiento para el super-admin (fila resaltada en `/soporte/
-- suscripciones`, contador "faltan N días para la sugerencia de bloqueo");
-- el bloqueo real sigue siendo una decisión MANUAL (bandera `tenants.estado`,
-- acción ya existente `bloquearCourier`/`cambiarEstadoTenant`) — esta
-- columna NO dispara ningún bloqueo automático ni gate de runtime (fuera de
-- alcance, brecha preexistente ya documentada en el plan de la feature).
--
-- CÓMO VALIDAR (con `supabase db query --linked`, después de aplicar):
--   - `select dias_atraso_sugerir_bloqueo from configuracion_plataforma` (como
--     super-admin) -> 15 (la única fila, poblada por el default).
--   - `update configuracion_plataforma set dias_atraso_sugerir_bloqueo = -1`
--     falla con 23514 (CHECK).
--   - Un Admin de tenant (no super-admin) sigue sin poder leer/editar esta
--     tabla (política ya existente, sin cambios).
--   - Correr `supabase/tests/database/20260815_suscripcion_facturas.test.sql`
--     (incluye una aserción puntual sobre esta columna).
-- PLAN DE REVERSIÓN (pensado, no ejecutado automáticamente):
--   alter table public.configuracion_plataforma drop column if exists dias_atraso_sugerir_bloqueo;
-- =============================================================================

alter table public.configuracion_plataforma
  add column dias_atraso_sugerir_bloqueo integer not null default 15
    check (dias_atraso_sugerir_bloqueo >= 0);

comment on column public.configuracion_plataforma.dias_atraso_sugerir_bloqueo is
  'Umbral GLOBAL (días de atraso de pago de una factura de suscripción, '
  'public.suscripcion_facturas) a partir del cual /soporte/suscripciones '
  'resalta al tenant como candidato a bloqueo. Default 15 (decisión de Yac '
  '2026-08-15). Puramente informativo/de UI: el bloqueo real sigue siendo '
  'una decisión MANUAL del super-admin (tenants.estado), esta columna no '
  'dispara ningún bloqueo automático.';
