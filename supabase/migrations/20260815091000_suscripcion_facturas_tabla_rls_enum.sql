-- =============================================================================
-- Migración: tabla `public.suscripcion_facturas` (una fila por tenant por
-- ciclo de suscripción) + enum `public.estado_suscripcion_factura` + RLS +
-- trigger de auditoría (regla dura #13) + trigger de inmutabilidad del monto
-- (regla dura #6). Segundo paso de "cobro de la suscripción a los tenants"
-- (greenfield en BD, aprobada por Yac 2026-08-15).
-- -----------------------------------------------------------------------------
-- IMPACTO: crea 1 tabla nueva, 1 enum nuevo, 2 funciones nuevas (trigger de
-- inmutabilidad + attach de auditoría genérica ya existente), 3 triggers
-- nuevos, 1 índice adicional (además del que crea el UNIQUE), 2 políticas RLS
-- (solo SELECT — ver DECISIÓN 2). Ninguna tabla existente se modifica.
-- ES DESTRUCTIVA: no. Greenfield (tabla nueva, sin filas que migrar).
--
-- DECISIÓN 1 (una fila por tenant por ciclo, idempotencia por
-- `UNIQUE(tenant_id, periodo_inicio)`): mismo patrón que `consumo_ciclos`
-- (`UNIQUE(tenant_id, ciclo_inicio)`, 20260713090600) — el período se calcula
-- con `private.calcular_ciclo_consumo_vigente(fecha_alta, referencia)`
-- (20260810050000), el MISMO ancla de aniversario que ya usa el consumo del
-- plan (MED-1), así que un tenant nunca puede tener 2 facturas de
-- suscripción para el mismo `periodo_inicio` — la generación (RPC
-- `asegurar_facturas_suscripcion`, 20260815094000) usa `on conflict (tenant_id,
-- periodo_inicio) do nothing`, así que re-invocarla no duplica filas.
--
-- DECISIÓN 2 (RLS: SELECT únicamente, SIN política de INSERT/UPDATE/DELETE —
-- deny-by-default real, mismo patrón que `configuracion_plataforma`
-- 20260813130000 y los buckets de Storage bucket-only): la ÚNICA vía de
-- mutación son las RPC `SECURITY DEFINER` de `20260815094000`
-- (generación)/`20260815096000` (reportar/marcar/revertir pago) — corren
-- como el dueño de la función (bypassa RLS), así que no necesitan ninguna
-- política de escritura para funcionar. Ningún cliente (ni Admin de tenant,
-- ni Super-Admin) puede hacer un `insert`/`update`/`delete` directo contra
-- esta tabla vía PostgREST: toda mutación queda centralizada en la lógica
-- validada de las RPC (transiciones de estado válidas, guardas de tenant/
-- super-admin, congelamiento del monto).
--   - SELECT: `tenant_id = private.current_tenant_id() OR private.
--     is_super_admin()` — mismo patrón que TODAS las tablas de datos del
--     tenant (regla dura #1), el propio tenant ve sus facturas de
--     suscripción, el super-admin ve las de cualquiera.
--
-- DECISIÓN 3 (inmutabilidad del monto — regla dura #6, "documentos
-- inmutables: nunca UPDATE de montos"): a diferencia de `documentos`
-- (inmutable salvo la transición emitido->anulado), `suscripcion_facturas`
-- SÍ tiene un flujo de trabajo con varias columnas mutables por diseño
-- (`estado`, `comprobante_ruta`, `referencia_pago`, `reportado_en`,
-- `reportado_por`, `pagado_en`, `marcado_pagado_por`, `nota_super_admin`) —
-- un deny-by-default "solo se permite tocar `estado`" (como
-- `proteger_inmutabilidad_documento`, 20260713091800) sería incorrecto acá.
-- Se aplica el MISMO PRINCIPIO deny-by-default pero con la lista de
-- EXCEPCIONES ampliada a las columnas de workflow: `public.
-- proteger_inmutabilidad_suscripcion_factura()` compara la fila completa
-- (`to_jsonb(NEW) - <columnas de workflow> - 'actualizado_en'` vs el mismo
-- recorte de OLD) y rechaza cualquier diferencia fuera de esa lista corta y
-- explícita — así `id`, `tenant_id`, `periodo_inicio`, `periodo_fin`,
-- `monto_usd` (el snapshot congelado del precio efectivo), `fecha_emision`,
-- `fecha_vencimiento` y `creado_en` quedan protegidos para SIEMPRE, sin
-- mantener una lista de columnas "protegidas" que alguien podría olvidar
-- actualizar si se agrega una columna nueva (aprendizaje de arquitecto-db
-- 2026-07-13: preferir listar las EXCEPCIONES permitidas -corta y estable-
-- antes que las columnas bloqueadas -crece sin límite-). Las RPC de mutación
-- (20260815096000) son las únicas que tocan esas columnas de workflow, y
-- ellas mismas ya validan qué transiciones de `estado` son legales — este
-- trigger es la ÚLTIMA línea de defensa contra un bug futuro que intente
-- `update ... set monto_usd = ...` por error.
--
-- DECISIÓN 4 (auditoría — regla dura #13, solo UPDATE): se reusa
-- `public.registrar_auditoria()` (20260713091000, colecta SOLO en UPDATE
-- desde 20260714050000) attacheada `AFTER UPDATE` — el mismo patrón exacto
-- que `paquetes`/`documentos`/`subclientes`. `tenant_id` sale de
-- `NEW.tenant_id` (columna real, sin necesitar los 2 argumentos opcionales
-- que sí necesitó `tenants`, 20260716060000, porque ahí el propio `id` HACE
-- de tenant_id). El diff resultante cubrirá transiciones de estado,
-- comprobante subido, quién reportó/marcó el pago, etc. — exactamente la
-- pista que un cobro de plataforma necesita.
--
-- CÓMO VALIDAR (con `supabase db query --linked`, después de aplicar):
--   - `list_tables`/`information_schema`: `suscripcion_facturas` existe con
--     las columnas de este archivo, RLS+FORCE, 2 políticas (solo SELECT).
--   - `pg_indexes`: `suscripcion_facturas_tenant_periodo_unique` (del
--     UNIQUE) y `suscripcion_facturas_tenant_periodo_desc_idx`.
--   - `pg_trigger`: `trg_suscripcion_facturas_actualizado_en` (BEFORE
--     UPDATE), `trg_suscripcion_facturas_proteger_inmutabilidad` (BEFORE
--     UPDATE), `trg_suscripcion_facturas_auditoria` (AFTER UPDATE, solo
--     UPDATE — sin INSERT/DELETE, decisión de Yac 2026-07-14).
--   - `update suscripcion_facturas set monto_usd = monto_usd + 1 where id =
--     ...` falla con P0001 (deny-by-default), aunque corra como rol con
--     BYPASSRLS.
--   - `update suscripcion_facturas set estado = 'reportado' where id = ...`
--     (con el resto de columnas de workflow sin tocar) SÍ pasa.
--   - Un tenant NO ve `insert`/`update`/`delete` disponible vía PostgREST
--     (sin política -> deny).
--   - Correr `supabase/tests/database/20260815_suscripcion_facturas.test.sql`.
-- PLAN DE REVERSIÓN (pensado, no ejecutado automáticamente):
--   drop trigger if exists trg_suscripcion_facturas_auditoria on public.suscripcion_facturas;
--   drop trigger if exists trg_suscripcion_facturas_proteger_inmutabilidad on public.suscripcion_facturas;
--   drop trigger if exists trg_suscripcion_facturas_actualizado_en on public.suscripcion_facturas;
--   drop function if exists public.proteger_inmutabilidad_suscripcion_factura();
--   drop table if exists public.suscripcion_facturas;
--   drop type if exists public.estado_suscripcion_factura;
-- =============================================================================

create type public.estado_suscripcion_factura as enum ('pendiente', 'reportado', 'pagado');

create table public.suscripcion_facturas (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants (id) on delete cascade,

  -- Snapshot del ciclo (private.calcular_ciclo_consumo_vigente, mismo ancla
  -- que consumo_ciclos): [periodo_inicio, periodo_fin), inmutable.
  periodo_inicio      date not null,
  periodo_fin         date not null,

  -- Snapshot congelado del precio efectivo al generar (regla dura #6: nunca
  -- se re-UPDATE; ver proteger_inmutabilidad_suscripcion_factura()).
  monto_usd           numeric not null check (monto_usd >= 0),

  -- "Vence al inicio del ciclo" (decisión de Yac): ambas = periodo_inicio.
  fecha_emision       date not null,
  fecha_vencimiento   date not null,

  estado              public.estado_suscripcion_factura not null default 'pendiente',

  -- Workflow de pago (tenant reporta -> super-admin marca pagado).
  comprobante_ruta    text,
  referencia_pago     text,
  reportado_en        timestamptz,
  reportado_por       uuid references public.usuarios (id) on delete set null,
  pagado_en           timestamptz,
  marcado_pagado_por  uuid references public.usuarios (id) on delete set null,
  nota_super_admin    text,

  creado_en           timestamptz not null default now(),
  actualizado_en      timestamptz not null default now(),

  constraint suscripcion_facturas_periodo_valido check (periodo_fin > periodo_inicio),
  constraint suscripcion_facturas_tenant_periodo_unique unique (tenant_id, periodo_inicio)
);

comment on table public.suscripcion_facturas is
  'Factura de suscripción de la PLATAFORMA a cada tenant (tenant), una por '
  'ciclo de aniversario (private.calcular_ciclo_consumo_vigente). USD '
  'únicamente (regla dura #5, sin moneda local ni tipo de cambio: no es una '
  'factura del tenant a sus subclientes). monto_usd es un SNAPSHOT '
  'congelado del precio efectivo al generarse (regla dura #6, inmutable vía '
  'proteger_inmutabilidad_suscripcion_factura()). Generación LAZY '
  '"de aquí en adelante" (sin backfill) vía '
  'public.asegurar_facturas_suscripcion (20260815094000). Vence al INICIO '
  'del ciclo (fecha_vencimiento = periodo_inicio). Sin política RLS de '
  'INSERT/UPDATE/DELETE: toda mutación pasa por RPC SECURITY DEFINER.';

comment on column public.suscripcion_facturas.monto_usd is
  'Snapshot INMUTABLE del precio efectivo (coalesce(tenants.'
  'precio_suscripcion_usd, planes.precio_mensual_usd, 0)) al momento de '
  'generar esta factura. Un cambio de precio posterior NUNCA reescribe una '
  'factura ya generada (regla dura #6) — solo afecta a la próxima que se '
  'genere.';

comment on column public.suscripcion_facturas.fecha_vencimiento is
  'Vence al INICIO del ciclo (= periodo_inicio, pago por adelantado, '
  'decisión de Yac 2026-08-15): el atraso corre desde el día 1 del ciclo, no '
  'desde el cierre.';

comment on column public.suscripcion_facturas.estado is
  'pendiente -> reportado (el tenant sube comprobante, RPC '
  'reportar_pago_suscripcion) -> pagado (el super-admin lo confirma, RPC '
  'marcar_pago_suscripcion). revertir_pago_suscripcion permite corregir '
  'pagado -> pendiente. Transiciones validadas en las RPC, no en un CHECK '
  '(quedan explícitas y con mensajes claros en cada función).';

create index suscripcion_facturas_tenant_periodo_desc_idx
  on public.suscripcion_facturas (tenant_id, periodo_inicio desc);

comment on index public.suscripcion_facturas_tenant_periodo_desc_idx is
  'Sostiene las lecturas por tenant más recientes primero (histórico del '
  'tenant, resolución de la factura vigente = MAX(periodo_inicio)) — el '
  'índice del UNIQUE(tenant_id, periodo_inicio) ya cubre tenant_id solo, '
  'pero en orden ASC; este es DESC a propósito.';

-- -----------------------------------------------------------------------------
-- Bookkeeping estándar (mismo trigger que el resto del esquema).
-- -----------------------------------------------------------------------------
create trigger trg_suscripcion_facturas_actualizado_en
  before update on public.suscripcion_facturas
  for each row
  execute function public.actualizar_actualizado_en();

-- -----------------------------------------------------------------------------
-- Inmutabilidad deny-by-default del monto/identidad (ver DECISIÓN 3).
-- -----------------------------------------------------------------------------
create or replace function public.proteger_inmutabilidad_suscripcion_factura()
returns trigger
language plpgsql
set search_path = ''
as $fn$
declare
  v_new_protegido jsonb;
  v_old_protegido jsonb;
begin
  -- DENY-BY-DEFAULT: se compara la fila COMPLETA vía to_jsonb(), excluyendo
  -- únicamente las columnas de WORKFLOW (mutables por diseño, ver DECISIÓN 3
  -- del header de esta migración) y 'actualizado_en' (bookkeeping, la pisa
  -- trg_suscripcion_facturas_actualizado_en en CUALQUIER UPDATE real, antes
  -- de que este trigger corra por orden alfabético). Cualquier otra
  -- diferencia -monto_usd, periodo_inicio/fin, fecha_emision/vencimiento,
  -- tenant_id, id, creado_en, o una columna nueva que se agregue mañana- se
  -- rechaza sin necesidad de mantener una lista de columnas "protegidas".
  v_new_protegido := to_jsonb(NEW)
    - 'estado' - 'comprobante_ruta' - 'referencia_pago'
    - 'reportado_en' - 'reportado_por' - 'pagado_en' - 'marcado_pagado_por'
    - 'nota_super_admin' - 'actualizado_en';
  v_old_protegido := to_jsonb(OLD)
    - 'estado' - 'comprobante_ruta' - 'referencia_pago'
    - 'reportado_en' - 'reportado_por' - 'pagado_en' - 'marcado_pagado_por'
    - 'nota_super_admin' - 'actualizado_en';

  if v_new_protegido is distinct from v_old_protegido then
    raise exception
      'La factura de suscripción % es inmutable fuera de su workflow de pago: no se permite modificar monto_usd, período, fechas ni identidad. Corrección = ajustar el precio para el PRÓXIMO ciclo, nunca reescribir uno ya generado.',
      OLD.id;
  end if;

  return NEW;
end;
$fn$;

comment on function public.proteger_inmutabilidad_suscripcion_factura() is
  'Trigger BEFORE UPDATE, deny-by-default (regla dura #6): protege monto_usd/'
  'período/fechas/identidad de suscripcion_facturas comparando la fila '
  'completa (to_jsonb) y permitiendo únicamente los cambios en las columnas '
  'de workflow de pago (estado, comprobante_ruta, referencia_pago, '
  'reportado_*, pagado_en, marcado_pagado_por, nota_super_admin) + '
  'actualizado_en. Mismo principio que proteger_inmutabilidad_documento '
  '(20260713091800), adaptado: acá SÍ hay varias columnas mutables por '
  'diseño (el workflow de pago), así que la lista de EXCEPCIONES permitidas '
  'es más larga que la de documentos (que solo excluye "estado").';

create trigger trg_suscripcion_facturas_proteger_inmutabilidad
  before update on public.suscripcion_facturas
  for each row
  execute function public.proteger_inmutabilidad_suscripcion_factura();

-- -----------------------------------------------------------------------------
-- Auditoría (regla dura #13, SOLO UPDATE — decisión de Yac 2026-07-14): reusa
-- el trigger genérico ya existente, sin crear ninguna función nueva.
-- -----------------------------------------------------------------------------
create trigger trg_suscripcion_facturas_auditoria
  after update on public.suscripcion_facturas
  for each row
  execute function public.registrar_auditoria();

-- -----------------------------------------------------------------------------
-- RLS: SELECT únicamente (ver DECISIÓN 2). Sin política de INSERT/UPDATE/
-- DELETE para ningún rol: toda mutación pasa por RPC SECURITY DEFINER.
-- -----------------------------------------------------------------------------
alter table public.suscripcion_facturas enable row level security;
alter table public.suscripcion_facturas force row level security;

create policy suscripcion_facturas_ver_mismo_tenant_o_super_admin on public.suscripcion_facturas
  for select
  to authenticated
  using (tenant_id = (select private.current_tenant_id()) or (select private.is_super_admin()));
