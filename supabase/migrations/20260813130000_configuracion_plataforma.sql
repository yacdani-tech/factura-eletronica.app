-- =============================================================================
-- Migración: `public.configuracion_plataforma` — tabla SINGLETON de
-- configuración GLOBAL de la plataforma (no por tenant).
-- -----------------------------------------------------------------------------
-- NOTA DE EXTRACCIÓN (factura-eletronica): migración adaptada del proyecto
-- factura-eletronica.app. La versión original nacía con una primera columna de
-- dominio específico (`tolerancia_anulaciones_pct`, un umbral % de tasa de
-- anulación de facturas usado por un reporte de ESE producto) — se removió
-- acá. Queda el ESQUELETO SINGLETON (patrón reutilizable para cualquier
-- config global futura): la primera columna de dominio real la agrega el
-- proyecto derivado con un `alter table ... add column` (mismo patrón que
-- `20260815092000_configuracion_plataforma_dias_bloqueo.sql`, más adelante en
-- este mismo set, que sí es genérica de plataforma).
-- -----------------------------------------------------------------------------
-- IMPACTO: crea 1 tabla nueva (`configuracion_plataforma`), su RLS de
-- SOLO-super-admin (SELECT/UPDATE, sin INSERT/DELETE), 2 triggers de
-- bookkeeping (`actualizado_en` estándar + forzado de identidad de
-- `actualizado_por`), y siembra la única fila permitida. Ninguna tabla
-- existente se toca.
-- ES DESTRUCTIVA: no. Greenfield (tabla nueva).
--
-- DECISIÓN 1 (patrón singleton): `id boolean primary key default true check
-- (id)` — el único valor posible para `id` es `true` (el CHECK rechaza
-- `false`, y la PK impide una segunda fila con `id = true`), así que la tabla
-- estructuralmente NUNCA puede tener más de 1 fila. No se modela como una
-- tabla `key/value` genérica: cada parámetro global es una columna nueva de
-- esta misma fila (`alter table ... add column`), no una fila nueva.
--
-- DECISIÓN 2 (sin `tenant_id`, y por lo tanto SIN el trigger de auditoría
-- `registrar_auditoria()`): esta tabla es GLOBAL, análoga a `monedas`/
-- `planes` — NO tiene ni puede tener una columna `tenant_id` real (no
-- pertenece a ningún tenant, es config de la propia plataforma).
-- `registrar_auditoria()` necesita resolver un `tenant_id` de la fila (por
-- defecto `NEW.tenant_id`, o vía sus 2 argumentos opcionales de
-- `20260716060000` para tablas como `tenants` cuyo propio `id` HACE de
-- tenant_id) — pero `configuracion_plataforma` no tiene NINGÚN candidato
-- razonable para jugar ese rol (su `id` es un `boolean` fijo, no un tenant).
-- Forzar alguno de los dos mecanismos existentes sería, en el mejor caso, un
-- valor sin sentido semántico — no aporta nada y ensucia el log de warnings.
-- Volver `auditoria.tenant_id` nullable + adaptar `registrar_auditoria()`/su
-- RLS para filas globales es una decisión de alcance de auditoría que un
-- proyecto derivado puede tomar más adelante si hiciera falta; no se decide
-- unilateralmente en esta migración puntual.
--
-- DECISIÓN 3 (RLS: solo super-admin, SIN política de INSERT/DELETE): SELECT y
-- UPDATE exigen `private.is_super_admin()` — ni siquiera un Admin de tenant
-- puede leer o tocar esta config (es de la plataforma, no de su tenant). Sin
-- política de INSERT ni DELETE para NADIE (ni siquiera super-admin): la única
-- fila la crea el seed de esta migración (corre como el rol de la migración,
-- que bypassa RLS); la app nunca necesita insertar una fila nueva (ya existe
-- siempre) ni borrar la única que hay. Esto es una capa MÁS estricta que la
-- protección física del CHECK/PK: aunque el CHECK ya hace estructuralmente
-- imposible una 2da fila, la ausencia de política de INSERT bloquea el
-- intento incluso antes de llegar a evaluar esa restricción para cualquier
-- rol autenticado vía PostgREST.
--
-- IDENTIDAD (`actualizado_por`, aprendizaje de arquitecto-db 2026-07-13: toda
-- columna de identidad escribible por `authenticated` necesita trigger de
-- forzado): un trigger BEFORE INSERT OR UPDATE pisa `actualizado_por =
-- auth.uid()` cuando hay sesión; sin sesión (seed de esta migración, proceso
-- de sistema) respeta el valor explícito recibido (NULL, en el caso del
-- seed).
--
-- CÓMO VALIDAR (con el MCP, después de aplicar):
--   - `list_tables`: `configuracion_plataforma` existe, RLS+FORCE, exactamente
--     1 fila (`id = true`).
--   - `pg_policies`: 2 políticas (`SELECT`, `UPDATE`), ambas `to authenticated
--     using private.is_super_admin()`; NINGUNA de `INSERT`/`DELETE`.
--   - `pg_trigger`: `trg_configuracion_plataforma_actualizado_en` (BEFORE
--     UPDATE), `trg_configuracion_plataforma_identidad` (BEFORE INSERT OR
--     UPDATE). Ningún trigger de auditoría (a propósito, ver DECISIÓN 2).
--   - Como super-admin: `select` devuelve la fila; un `update` de cualquier
--     columna que un proyecto derivado agregue deja
--     `actualizado_por = auth.uid()` real (nunca un valor spoofeado del
--     payload).
--   - Como Admin de un tenant cualquiera (o `anon`): `select` devuelve 0
--     filas; `update` no da error pero no alcanza ninguna fila.
--   - `insert into configuracion_plataforma (id) values (false)` falla con
--     `23514` (CHECK); una segunda fila con `id` en su default (`true`) falla
--     con `23505` (PK duplicada) si se intentara sin pasar por RLS (con RLS,
--     de todos modos, no hay política de INSERT para ningún rol).
--
-- PLAN DE REVERSIÓN (pensado, no ejecutado automáticamente):
--   drop trigger if exists trg_configuracion_plataforma_identidad on public.configuracion_plataforma;
--   drop trigger if exists trg_configuracion_plataforma_actualizado_en on public.configuracion_plataforma;
--   drop table if exists public.configuracion_plataforma;
--   drop function if exists public.forzar_actualizado_por_configuracion_plataforma();
-- =============================================================================

create table public.configuracion_plataforma (
  id                          boolean primary key default true check (id),
  actualizado_por             uuid references public.usuarios (id) on delete set null,
  creado_en                   timestamptz not null default now(),
  actualizado_en              timestamptz not null default now()
);

comment on table public.configuracion_plataforma is
  'Configuración GLOBAL de la plataforma (singleton: PK '
  '`id boolean` con CHECK(id), estructuralmente 1 sola fila posible). Tabla '
  'análoga a los catálogos globales del proyecto (monedas/planes): sin '
  'tenant_id, sin trigger de auditoría (ver DECISIÓN 2 del header de esta '
  'migración). SELECT/UPDATE restringidos a private.is_super_admin(); sin '
  'política de INSERT/DELETE para ningún rol (la única fila la crea el seed '
  'de esta migración). Cada parámetro global nuevo es una columna nueva de '
  'esta fila, agregada por el proyecto derivado.';

comment on column public.configuracion_plataforma.id is
  'Siempre `true` (CHECK(id) + PK): patrón singleton, impide '
  'estructuralmente una segunda fila.';

comment on column public.configuracion_plataforma.actualizado_por is
  'Quién dejó esta config así por última vez (trazabilidad, no parte de una '
  'clave de unicidad). Forzado desde auth.uid() cuando hay sesión (trigger '
  'trg_configuracion_plataforma_identidad); NULL para el seed de esta '
  'migración (proceso de sistema, sin sesión).';

-- -----------------------------------------------------------------------------
-- RLS: solo super-admin, sin política de INSERT/DELETE (ver DECISIÓN 3).
-- -----------------------------------------------------------------------------
alter table public.configuracion_plataforma enable row level security;
alter table public.configuracion_plataforma force row level security;

create policy configuracion_plataforma_ver_super_admin on public.configuracion_plataforma
  for select
  to authenticated
  using ((select private.is_super_admin()));

create policy configuracion_plataforma_editar_super_admin on public.configuracion_plataforma
  for update
  to authenticated
  using ((select private.is_super_admin()))
  with check ((select private.is_super_admin()));

-- Sin política de INSERT ni DELETE (deny-by-default): nadie, ni siquiera
-- super-admin, inserta o borra filas de esta tabla desde el cliente — la
-- única fila la crea el seed de esta migración.

-- -----------------------------------------------------------------------------
-- actualizado_en (bookkeeping estándar, mismo trigger que el resto del
-- esquema).
-- -----------------------------------------------------------------------------
create trigger trg_configuracion_plataforma_actualizado_en
  before update on public.configuracion_plataforma
  for each row
  execute function public.actualizar_actualizado_en();

-- -----------------------------------------------------------------------------
-- Identidad forzada (aprendizaje 2026-07-13).
-- -----------------------------------------------------------------------------
create or replace function public.forzar_actualizado_por_configuracion_plataforma()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if (select auth.uid()) is not null then
    NEW.actualizado_por := (select auth.uid());
  end if;
  return NEW;
end;
$fn$;

comment on function public.forzar_actualizado_por_configuracion_plataforma() is
  'Trigger BEFORE INSERT OR UPDATE: fuerza '
  'configuracion_plataforma.actualizado_por = auth.uid() cuando hay sesión '
  '(nunca confiar en el payload del cliente); si auth.uid() es NULL (seed de '
  'esta migración/proceso de sistema) respeta el valor explícito recibido.';

create trigger trg_configuracion_plataforma_identidad
  before insert or update on public.configuracion_plataforma
  for each row
  execute function public.forzar_actualizado_por_configuracion_plataforma();

-- Nota: SIN revoke de EXECUTE sobre forzar_actualizado_por_configuracion_plataforma()
-- — es `returns trigger` (no SECURITY DEFINER): Postgres rechaza llamarla
-- fuera de un contexto de trigger, así que el grant por defecto de PostgREST
-- es inofensivo (mismo criterio que el resto de los triggers de forzado de
-- identidad de este set).

-- -----------------------------------------------------------------------------
-- Seed de la única fila permitida (corre como el rol de la migración,
-- bypassa RLS; on conflict do nothing hace esta migración idempotente si se
-- re-aplicara sobre un proyecto que ya tuviera la fila).
-- -----------------------------------------------------------------------------
insert into public.configuracion_plataforma (id) values (true)
on conflict (id) do nothing;
