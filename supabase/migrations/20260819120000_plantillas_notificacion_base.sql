-- =============================================================================
-- Migración: `public.plantillas_notificacion` — plantillas de correo/aviso
-- configurables por tenant (asunto + cuerpo + on/off), GENÉRICAS.
-- -----------------------------------------------------------------------------
-- NOTA DE EXTRACCIÓN (factura-eletronica): esqueleto adaptado del proyecto
-- factura-eletronica.app. La versión original tipaba la plantilla por un enum de
-- dominio (`public.evento_notificacion`, con eventos específicos de ESE
-- producto: invitación de staff, bienvenida de subcliente, factura anulada,
-- etc.). Acá se reemplaza por una columna GENÉRICA `clave text` — el proyecto
-- derivado define su propio catálogo de claves de evento a nivel de aplicación
-- (o promueve `clave` a un enum propio con una migración posterior). Todo lo
-- demás (RLS multi-tenant, triggers de `actualizado_en` + auditoría, unicidad
-- por `(tenant_id, clave, idioma)`) se conserva del patrón base.
-- -----------------------------------------------------------------------------
-- IMPACTO: crea 1 tabla nueva (`plantillas_notificacion`), su índice por
-- `tenant_id`, su RLS multi-tenant (política única `for all` al tenant de la
-- sesión), y 2 triggers de bookkeeping (`actualizado_en` estándar + auditoría
-- de UPDATE). Ninguna tabla existente se toca.
-- ES DESTRUCTIVA: no. Greenfield (tabla nueva).
--
-- SIN SEED DE NEGOCIO (a propósito): las plantillas son POR TENANT (FK
-- `tenant_id`), así que no se pueden sembrar en una base recién migrada (no
-- hay tenants todavía). El proyecto derivado las crea de forma perezosa por
-- tenant desde la app (al dar de alta el tenant, o al primer uso de cada
-- `clave`), nunca en esta migración.
--
-- MULTI-TENANT (regla dura #1): `tenant_id NOT NULL` + RLS. El `tenant_id`
-- SIEMPRE se resuelve server-side vía `private.current_tenant_id()` (subdominio/
-- sesión); jamás se acepta del cliente.
--
-- AUDITORÍA (regla dura #13): trigger `after update` con `registrar_auditoria()`
-- (default: resuelve el `tenant_id` de `NEW.tenant_id`). INSERT/DELETE NO
-- generan pista (la creación queda trazada por `creado_en`); la tabla
-- `auditoria` es append-only.
--
-- CÓMO VALIDAR (con el MCP, después de aplicar):
--   - `list_tables`: `plantillas_notificacion` existe, RLS + FORCE.
--   - `pg_policies`: 1 política `for all` `to authenticated` con
--     `tenant_id = (select private.current_tenant_id())` en USING y WITH CHECK.
--   - `pg_trigger`: `trg_plantillas_notificacion_actualizado_en` (BEFORE
--     UPDATE) y `trg_plantillas_notificacion_auditoria` (AFTER UPDATE).
-- =============================================================================

create table public.plantillas_notificacion (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants (id) on delete cascade,
  -- Clave GENÉRICA del evento/plantilla (ej. 'bienvenida'). El catálogo de
  -- claves lo define la aplicación del proyecto derivado, no la BD.
  clave          text not null,
  asunto         text not null,
  cuerpo         text not null,
  activa         boolean not null default true,
  -- Arquitectura preparada para multi-idioma; español por defecto.
  idioma         text not null default 'es',
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  constraint plantillas_notificacion_tenant_clave_idioma_unique unique (tenant_id, clave, idioma)
);

comment on table public.plantillas_notificacion is
  'Asunto/cuerpo configurables por tenant y clave de evento, con on/off. Los '
  'placeholders dependientes del evento se resuelven en la app al enviar.';

create index plantillas_notificacion_tenant_id_idx on public.plantillas_notificacion (tenant_id);

create trigger trg_plantillas_notificacion_actualizado_en
  before update on public.plantillas_notificacion
  for each row
  execute function public.actualizar_actualizado_en();

create trigger trg_plantillas_notificacion_auditoria
  after update on public.plantillas_notificacion
  for each row
  execute function public.registrar_auditoria();

alter table public.plantillas_notificacion enable row level security;
alter table public.plantillas_notificacion force row level security;

create policy plantillas_notificacion_mismo_tenant on public.plantillas_notificacion
  for all
  to authenticated
  using (tenant_id = (select private.current_tenant_id()))
  with check (tenant_id = (select private.current_tenant_id()));
