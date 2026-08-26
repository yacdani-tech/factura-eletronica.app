-- =============================================================================
-- Migración: `planes.actualizado_en` — fecha/hora de la última edición del
-- catálogo (BEFORE UPDATE, derivada server-side). Tercer paso de "catálogo de
-- planes editable + propagación manual por tenant".
-- -----------------------------------------------------------------------------
-- IMPACTO: `alter table public.planes add column actualizado_en timestamptz
-- not null default now()` + 1 función + 1 trigger BEFORE UPDATE nuevos sobre
-- `public.planes` (mismo patrón que `public.actualizar_actualizado_en()` /
-- `trg_tenants_actualizado_en`, 20260713090000/20260713090200: la columna se
-- pisa SIEMPRE con `now()` en cada UPDATE, nunca se respeta un valor que
-- llegue en el payload). Sin cambios de RLS: `planes` ya tiene
-- `planes_actualizar_super_admin` (20260713090100), que cubre la fila
-- completa incluida la columna nueva (RLS es por fila, no por columna).
-- ES DESTRUCTIVA: no. Columna aditiva `not null default now()` (todas las
-- filas existentes de `planes` quedan con `actualizado_en = now()` al momento
-- de aplicar esta migración — es lo esperado y honesto para una columna que
-- significa "última edición": ninguna fila existente tenía una edición previa
-- rastreada, así que "ahora" es tan válido como cualquier otro valor; no es
-- el mismo caso que `tipo_cambio_actualizado_en`, que si se hubiera puesto en
-- `now()` habría mentido sobre CUÁNDO pasó algo que sí había pasado antes).
--
-- SOBRE LA AUDITORÍA GENÉRICA (`public.registrar_auditoria()`) — DECISIÓN
-- PENDIENTE, NO IMPLEMENTADA ACÁ, VER NOTA AL EQUIPO ABAJO: esta migración
-- deliberadamente NO adjunta `trg_planes_auditoria` como se haría en una
-- tabla de negocio con tenant. `public.planes` es un catálogo GLOBAL, SIN
-- columna `tenant_id` (mismo diseño que `monedas`/`categorias_producto`/
-- `atributos_producto`/`reglas_categoria_atributo`, `20260713090100`/
-- `20260714185748`) — y `public.auditoria.tenant_id` es `uuid NOT NULL
-- references tenants(id)` (`20260713091000`). `registrar_auditoria()`
-- resuelve `v_tenant_id` de `NEW.tenant_id` (o de la columna que se le pase
-- como argumento vía TG_ARGV, ver `20260716060000` para el caso de
-- `tenants`/`usuarios_tenants`) — para `planes` NO HAY una columna que
-- represente honestamente "el tenant de esta fila", porque un plan no
-- pertenece a ningún tenant: es la PLANTILLA de la que varios tenants copian.
-- Intentar reusar `id` (como hace `tenants` con `registrar_auditoria('id')`,
-- donde la propia fila ES el tenant) sería FALSO acá: el `id` de un plan no
-- es un `tenant_id` real, y el `FOREIGN KEY tenant_id -> tenants(id)` de
-- `auditoria` lo rechazaría en tiempo de ejecución (o, peor, si por
-- coincidencia existiera un tenant con ese mismo uuid, contaminaría su
-- bitácora con cambios que no le pertenecen). Este es EXACTAMENTE el
-- conflicto ya documentado en `20260714185748` (punto "Sin tenant_id por
-- diseño explícito de CAT-9, y registrar_auditoria() depende de tenant_id"),
-- resuelto en ese momento excluyendo esas 3 tablas del trigger genérico — acá
-- se aplica el MISMO precedente por la MISMA razón estructural.
--
-- NOTA AL EQUIPO / A YAC: para que `planes` tenga auditoría real habría que
-- decidir entre (A) dejarlo fuera del trigger genérico (lo que hace esta
-- migración; consistente con el resto de catálogos globales — costo cero,
-- pero SIN pista de auditoría de "quién cambió qué precio/tope y cuándo" más
-- allá de `actualizado_en`, que no guarda actor ni diff); (B) volver
-- `auditoria.tenant_id` NULLABLE + agregar una política de SELECT para
-- super-admin (hoy `auditoria` solo tiene `auditoria_ver_mismo_tenant`,
-- ningún rol puede leer un evento con `tenant_id IS NULL`) — cambio al
-- CONTRATO de una tabla compartida por TODO el proyecto, con ramificaciones
-- para cualquier catálogo global futuro, no solo `planes`; o (C) una tabla de
-- historial DEDICADA y más chica (ej. `planes_historial`, sin la constraint
-- de tenant) solo para cambios de plan. Es una decisión de alcance de
-- auditoría (afecta una regla dura del proyecto) — se deja sin resolver a
-- propósito en esta migración en vez de decidir unilateralmente; `planes`
-- queda, por ahora, con `actualizado_en` (esta migración) como única traza de
-- "cuándo" (sin actor ni diff), igual que el resto de catálogos globales.
--
-- CÓMO VALIDAR:
--   - `information_schema.columns`: `planes.actualizado_en` existe,
--     `timestamptz`, `not null`, default `now()`.
--   - `pg_trigger`: `trg_planes_actualizado_en` existe (BEFORE UPDATE) sobre
--     `public.planes`.
--   - UPDATE de cualquier columna de un plan -> `actualizado_en` avanza a
--     `now()` (aprox), sin importar qué valor haya llegado en el payload para
--     esa columna.
--   - `pg_trigger` de `planes` NO incluye ningún trigger de auditoría
--     (`trg_planes_auditoria` no existe) — confirma la decisión pendiente de
--     arriba.
--   - Correr
--     `supabase/tests/database/20260816_planes_editables_y_propagacion.test.sql`.
-- PLAN DE REVERSIÓN (pensado, no ejecutado automáticamente):
--   drop trigger if exists trg_planes_actualizado_en on public.planes;
--   drop function if exists public.forzar_planes_actualizado_en();
--   alter table public.planes drop column if exists actualizado_en;
-- =============================================================================

alter table public.planes
  add column actualizado_en timestamptz not null default now();

comment on column public.planes.actualizado_en is
  'Fecha/hora de la última edición del plan (SIEMPRE now(), derivada por '
  'trg_planes_actualizado_en, nunca escrita directo desde el payload del '
  'cliente). planes es un catálogo GLOBAL sin tenant_id -- NO lleva el '
  'trigger genérico public.registrar_auditoria() (que exige tenant_id NOT '
  'NULL), mismo precedente que monedas/categorias_producto/atributos_'
  'producto/reglas_categoria_atributo (20260714185748). Ver NOTA AL EQUIPO en '
  'el header de 20260816092000 para la decisión pendiente sobre auditoría de '
  'catálogos globales.';

create or replace function public.forzar_planes_actualizado_en()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  NEW.actualizado_en := now();
  return NEW;
end;
$fn$;

comment on function public.forzar_planes_actualizado_en() is
  'Trigger BEFORE UPDATE en planes: pisa actualizado_en con now() en TODO '
  'UPDATE, sin importar qué valor llegue en el payload del cliente. Mismo '
  'patrón que public.actualizar_actualizado_en() (20260713090000).';

drop trigger if exists trg_planes_actualizado_en on public.planes;
create trigger trg_planes_actualizado_en
  before update on public.planes
  for each row
  execute function public.forzar_planes_actualizado_en();
