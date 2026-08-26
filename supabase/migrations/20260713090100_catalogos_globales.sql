-- =============================================================================
-- Migración: catálogos globales (monedas, planes)
-- -----------------------------------------------------------------------------
-- NOTA DE EXTRACCIÓN (factura-eletronica): migración adaptada del proyecto
-- factura-eletronica.app. Se removió la sección original de "provincias / cantones /
-- distritos" (catálogo geográfico oficial de Costa Rica, en cascada) — es
-- contenido de dominio específico de ESE producto (ficha de subcliente), no
-- del framework multi-tenant genérico. Si un proyecto derivado de esta base
-- necesita un catálogo geográfico propio, se agrega como migración nueva,
-- propia de ese dominio.
-- -----------------------------------------------------------------------------
-- IMPACTO: crea tablas de catálogo GLOBALES (no llevan tenant_id — son
-- referencia compartida por toda la plataforma, no datos de un tenant):
--   - monedas: catálogo de monedas (código ISO, símbolo, decimales). Regla
--     dura del proyecto: nada de símbolo hardcodeado en código — el símbolo y
--     los decimales de cada moneda viven AQUÍ, como datos. Agregar una moneda
--     nueva (MXN, DOP, ...) = una fila, sin cambios de esquema.
--   - planes: catálogo de planes de suscripción de la plataforma. Esta
--     migración solo crea la ESTRUCTURA; las filas reales (nombre/tope) se
--     siembran en una migración de seed posterior.
-- ES DESTRUCTIVA: no.
-- CÓMO VALIDAR: greenfield, no hay tenants. Verificar con el MCP que las 2
--   tablas existen, RLS habilitado, y que monedas/planes solo son escribibles
--   por super-admin (o migraciones), nunca por un tenant.
-- PLAN DE REVERSIÓN: drop table planes, monedas (en ese orden, por las FK);
--   ninguna tiene aún filas de negocio.
--
-- CORRECCIÓN DE RONDA DE REVISIÓN (mismo día): las políticas de escritura de
-- monedas/planes eran un solo `for all`; se separan en insert/update/delete
-- independientes (mismo predicado `is_super_admin()` en las tres) — permite
-- auditar/otorgar por comando si algún día se necesita, y es más explícito
-- para lectura de código (menor, pedido en revisión).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- monedas
-- -----------------------------------------------------------------------------
create table public.monedas (
  codigo     text primary key,                 -- ISO 4217, ej. 'USD', 'CRC'
  nombre     text not null,
  simbolo    text not null,                    -- ej. '$', '₡' — vive en DATOS, no en código
  decimales  smallint not null default 2,
  activa     boolean not null default true,
  creado_en  timestamptz not null default now(),
  constraint monedas_decimales_check check (decimales >= 0 and decimales <= 6)
);

comment on table public.monedas is
  'Catálogo global de monedas soportadas (símbolo y decimales como datos, no '
  'hardcodeados). Agregar una moneda nueva = insertar una fila.';

alter table public.monedas enable row level security;
alter table public.monedas force row level security;

-- Lectura pública: cualquier usuario autenticado (la app la necesita para
-- mostrar montos) y anon (formulario /registro y páginas públicas de
-- documento necesitan formatear montos sin sesión).
create policy monedas_lectura_publica on public.monedas
  for select
  to authenticated, anon
  using (true);

-- Escritura: solo Super-Admin de plataforma (catálogo compartido entre todos
-- los tenants; ningún tenant individual debe poder alterarlo). Separado en
-- insert/update/delete (en vez de un solo `for all`) para que quede
-- explícito por comando.
create policy monedas_insertar_super_admin on public.monedas
  for insert
  to authenticated
  with check ((select private.is_super_admin()));

create policy monedas_actualizar_super_admin on public.monedas
  for update
  to authenticated
  using ((select private.is_super_admin()))
  with check ((select private.is_super_admin()));

create policy monedas_eliminar_super_admin on public.monedas
  for delete
  to authenticated
  using ((select private.is_super_admin()));

-- -----------------------------------------------------------------------------
-- planes
-- -----------------------------------------------------------------------------
create table public.planes (
  id                    uuid primary key default gen_random_uuid(),
  codigo                text not null unique,
  nombre                text not null,
  tope_documentos_mes   integer,               -- null = sin tope
  descripcion           text,
  activo                boolean not null default true,
  creado_en             timestamptz not null default now(),
  constraint planes_tope_documentos_mes_check check (tope_documentos_mes is null or tope_documentos_mes > 0)
);

comment on table public.planes is
  'Catálogo global de planes de suscripción de la plataforma. Estructura '
  'lista; los valores reales (nombre/tope) se siembran en una migración de '
  'seed posterior, cuando el pricing esté definido.';

alter table public.planes enable row level security;
alter table public.planes force row level security;

create policy planes_lectura_publica on public.planes
  for select
  to authenticated, anon
  using (true);

create policy planes_insertar_super_admin on public.planes
  for insert
  to authenticated
  with check ((select private.is_super_admin()));

create policy planes_actualizar_super_admin on public.planes
  for update
  to authenticated
  using ((select private.is_super_admin()))
  with check ((select private.is_super_admin()));

create policy planes_eliminar_super_admin on public.planes
  for delete
  to authenticated
  using ((select private.is_super_admin()));
