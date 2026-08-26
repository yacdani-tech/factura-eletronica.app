-- =============================================================================
-- Migración: tenants, usuarios, membresías, invitaciones y contadores por tenant
-- -----------------------------------------------------------------------------
-- NOTA DE EXTRACCIÓN (factura-eletronica): migración adaptada del proyecto
-- factura-eletronica.app. La tabla `tenants` original tenía además columnas/enums del
-- MOTOR DE CÁLCULO de ESE producto (unidad_entrada, unidad_cobro, modo_peso,
-- submodo_consolidado, minimo_cobro, redondeo, tarifa_default_usd,
-- moneda_local, tipo_cambio, reglas_cobro jsonb) — se removieron acá por ser
-- de dominio específico (facturación de couriers), no del framework
-- multi-tenant genérico. Se conservan `fecha_alta`/`precio_suscripcion_usd`
-- (esta última agregada más adelante en este mismo set, `20260815090000`) por
-- ser genéricas del ciclo de vida de suscripción de CUALQUIER SaaS
-- multi-tenant. Un proyecto derivado que necesite moneda/tipo de cambio/motor
-- de cálculo propios de su dominio los agrega en una migración nueva.
-- -----------------------------------------------------------------------------
-- IMPACTO: crea el núcleo de identidad y multi-tenancy:
--   - usuarios (global, 1 fila por auth.users, correo único global).
--   - super_admins (rol de plataforma, mínimo).
--   - tenants (el tenant/cliente de la plataforma).
--   - usuarios_tenants (membresía 1:1 — un usuario pertenece a un solo tenant).
--   - invitaciones (AUTH-3: staff invitado por el Admin).
--   - tenant_contadores + public.siguiente_contador(): secuencias propias por
--     tenant (ej. numeración interna de un recurso cualquiera del dominio de
--     la app), sin exponer una tabla de contadores editable a mano.
-- ES DESTRUCTIVA: no.
-- CÓMO VALIDAR: greenfield. Verificar con el MCP: RLS habilitado en las 5
--   tablas nuevas, unique(usuarios_tenants.usuario_id) por ser también PK
--   (garantiza 1 tenant por usuario), unique(tenants.subdominio).
-- PLAN DE REVERSIÓN: drop table tenant_contadores, invitaciones,
--   usuarios_tenants, tenants, super_admins, usuarios (en ese orden); drop
--   de los tipos enum creados aquí; drop function siguiente_contador,
--   proteger_email_usuario.
--
-- CORRECCIÓN DE RONDA DE REVISIÓN (mismo día):
--   - AUTH-4 rompía porque `usuarios` solo tenía policy de SELECT de la
--     propia fila: un Admin no podía ver nombre/correo de sus compañeros de
--     tenant. Se agrega `usuarios_ver_mismo_tenant`.
--   - `usuarios_actualizar_propia_fila` permitía cambiar `email` vía
--     PostgREST, desincronizándolo de `auth.users` (fuente de verdad real
--     del correo de login). Se agrega un trigger que rechaza cambios de
--     `email` salvo desde `service_role`.
--   - Se agrega CHECK de subdominios reservados (defensa en profundidad de
--     COU-3; la lista completa/actualizable sigue viviendo en la app).
--   - Se agrega el trigger de integridad `invitaciones.invitado_por` contra
--     `usuarios_tenants` (vía el nuevo 3er argumento de
--     verificar_tenant_padre), análogo al que se agrega para
--     `documentos.creado_por` en la migración de documentos.
--   - Se documenta explícitamente (comentario en usuarios_tenants) que la
--     PK en `usuario_id` (columna única, no compuesta) hace IMPOSIBLE que un
--     usuario tenga dos filas de membresía activas a la vez, en el mismo o
--     en distinto tenant: solo puede existir UNA fila por usuario, punto —
--     no hace falta un índice único adicional.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Tipos enumerados
-- -----------------------------------------------------------------------------
create type public.rol_usuario as enum ('admin', 'operador', 'contador');
create type public.estado_membresia as enum ('activo', 'inactivo');
create type public.estado_invitacion as enum ('pendiente', 'aceptada', 'cancelada', 'expirada');
create type public.estado_tenant as enum ('activo', 'bloqueado');

-- -----------------------------------------------------------------------------
-- usuarios (identidad global — 1:1 con auth.users; correo único global)
-- -----------------------------------------------------------------------------
create table public.usuarios (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text not null unique,
  nombre     text,
  creado_en  timestamptz not null default now()
);

comment on table public.usuarios is
  'Identidad global de la app (1 fila por auth.users.id). Correo único global '
  '(AUTH-2): si dos proveedores (Google/manual) comparten correo, la app debe '
  'vincularlos a la MISMA fila aquí (AUTH-5), nunca duplicarla.';

alter table public.usuarios enable row level security;
alter table public.usuarios force row level security;

create policy usuarios_propia_fila on public.usuarios
  for select
  to authenticated
  using (id = (select auth.uid()) or (select private.is_super_admin()));

-- NOTA: la policy `usuarios_ver_mismo_tenant` (AUTH-4) se crea MÁS ABAJO en
-- este mismo archivo, después de la tabla `usuarios_tenants` — a diferencia
-- de una función `plpgsql` (compilación perezosa), `CREATE POLICY` SÍ
-- resuelve sus referencias contra el catálogo de inmediato, así que no puede
-- nombrar una tabla que todavía no existe en este punto del archivo (el
-- mismo tipo de bug que se corrigió en `20260713090000` para las funciones
-- `language sql`, pero aplicado a DDL en vez de a un CREATE FUNCTION).

-- `email` se excluye explícitamente de lo editable por el propio usuario
-- (ver trigger trg_usuarios_proteger_email más abajo): esta policy permite el
-- UPDATE en general (nombre, etc.), pero el trigger BEFORE UPDATE rechaza
-- cualquier intento de cambiar `email` que no venga de `service_role` — así
-- se evita desincronizar `public.usuarios.email` de `auth.users.email` (la
-- fuente de verdad real del correo de login) vía un simple PATCH de
-- PostgREST.
create policy usuarios_actualizar_propia_fila on public.usuarios
  for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- El alta de la fila (insert) la hace el backend al completar el signup
-- (server-side, con el propio uid ya emitido por Supabase Auth). Se permite
-- también al propio usuario autenticado insertar SU fila (id = auth.uid()),
-- cubriendo el flujo de app estándar (cliente Supabase autenticado) sin
-- depender de service_role.
create policy usuarios_insertar_propia_fila on public.usuarios
  for insert
  to authenticated
  with check (id = (select auth.uid()));

-- Bloquea cambios de `email` desde el cliente (cualquier rol autenticado),
-- incluso si en el futuro se agregara una policy de UPDATE más amplia sobre
-- esta tabla (defensa en profundidad, mismo patrón que
-- proteger_inmutabilidad_documento). `service_role` (usado solo desde
-- backend de confianza, nunca desde código de cliente) sí puede corregirlo,
-- ej. al reconciliar con un cambio de correo hecho directamente en
-- `auth.users`.
create or replace function public.proteger_email_usuario()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if NEW.email is distinct from OLD.email and current_user <> 'service_role' then
    raise exception
      'El correo de usuarios no se puede modificar desde el cliente (usuario %). Debe sincronizarse con auth.users vía backend/service_role.',
      OLD.id;
  end if;
  return NEW;
end;
$$;

comment on function public.proteger_email_usuario() is
  'Trigger: rechaza cambios de usuarios.email salvo cuando el rol activo es '
  'service_role (backend de confianza). Evita que un usuario autenticado '
  'desincronice su correo de auth.users vía PostgREST.';

create trigger trg_usuarios_proteger_email
  before update on public.usuarios
  for each row
  execute function public.proteger_email_usuario();

-- -----------------------------------------------------------------------------
-- super_admins (rol de plataforma, mínimo)
-- -----------------------------------------------------------------------------
create table public.super_admins (
  usuario_id  uuid primary key references public.usuarios (id) on delete cascade,
  creado_en   timestamptz not null default now()
);

comment on table public.super_admins is
  'Rol de plataforma (mínimo). Quién administra esta tabla '
  '(alta del primer super-admin) es un procedimiento operativo fuera de la '
  'app, no expuesto por RLS a usuarios comunes.';

alter table public.super_admins enable row level security;
alter table public.super_admins force row level security;

-- Deny-by-default: solo un super-admin existente puede ver/gestionar la
-- lista de super-admins. Nadie más tiene ninguna política -> sin acceso.
create policy super_admins_solo_super_admin on public.super_admins
  for all
  to authenticated
  using ((select private.is_super_admin()))
  with check ((select private.is_super_admin()));

-- -----------------------------------------------------------------------------
-- tenants (el cliente/tenant de la plataforma)
-- -----------------------------------------------------------------------------
-- NOTA DE EXTRACCIÓN (factura-eletronica): la versión original de esta tabla
-- (factura-eletronica.app) tenía además columnas/enums de su MOTOR DE CÁLCULO
-- (unidad_entrada, unidad_cobro, modo_peso, submodo_consolidado, minimo_cobro,
-- redondeo, tarifa_default_usd, moneda_local, tipo_cambio, reglas_cobro
-- jsonb) — removidas acá por ser de dominio específico. Se conservan
-- `fecha_alta`/`precio_suscripcion_usd` (esta última se agrega más adelante
-- en este mismo set, `20260815090000`) por ser genéricas del ciclo de vida de
-- suscripción de cualquier SaaS multi-tenant.
create table public.tenants (
  id                     uuid primary key default gen_random_uuid(),
  nombre                 text not null,
  subdominio             text not null unique,
  plan_id                uuid references public.planes (id) on delete restrict,
  estado                 public.estado_tenant not null default 'activo',
  fecha_alta             date not null default current_date, -- ancla el ciclo de consumo/suscripción
  logo_url               text,

  creado_en              timestamptz not null default now(),
  actualizado_en         timestamptz not null default now(),

  constraint tenants_subdominio_formato check (subdominio ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'),
  -- Defensa en profundidad (palabras reservadas bloqueadas). La lista
  -- AUTORITATIVA y actualizable vive en la app (puede crecer sin migración);
  -- esta es solo una red de seguridad a nivel BD con un set mínimo de
  -- ejemplos + 'www'.
  constraint tenants_subdominio_no_reservado check (
    subdominio not in ('app', 'web', 'api', 'admin', 'registro', 'www')
  )
);

comment on table public.tenants is
  'Tenant (cliente de la plataforma). El subdominio es inmutable a nivel de '
  'producto; esta tabla no lo impide a nivel de BD (podría requerirse una '
  'corrección excepcional vía soporte), pero la app NUNCA debe ofrecer '
  'editarlo.';

create unique index tenants_subdominio_lower_idx on public.tenants (lower(subdominio));

alter table public.tenants enable row level security;
alter table public.tenants force row level security;

create policy tenants_ver_propio_o_super_admin on public.tenants
  for select
  to authenticated
  using (id = (select private.current_tenant_id()) or (select private.is_super_admin()));

-- Alta y baja de tenants es administrada por la plataforma: solo
-- Super-Admin. Un Admin del propio tenant SÍ puede editar su config,
-- por eso el update permite ambos caminos; el insert/delete
-- quedan reservados a Super-Admin únicamente.
create policy tenants_insertar_super_admin on public.tenants
  for insert
  to authenticated
  with check ((select private.is_super_admin()));

create policy tenants_editar_propio_o_super_admin on public.tenants
  for update
  to authenticated
  using (id = (select private.current_tenant_id()) or (select private.is_super_admin()))
  with check (id = (select private.current_tenant_id()) or (select private.is_super_admin()));

-- Sin política de DELETE: dar de baja un tenant es "bloquear" (estado),
-- nunca borrar la fila (rompería FKs de todo su historial).

create trigger trg_tenants_actualizado_en
  before update on public.tenants
  for each row
  execute function public.actualizar_actualizado_en();

-- -----------------------------------------------------------------------------
-- usuarios_tenants (membresía — 1:1 en el MVP)
-- -----------------------------------------------------------------------------
create table public.usuarios_tenants (
  usuario_id  uuid primary key references public.usuarios (id) on delete cascade,
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  rol         public.rol_usuario not null,
  estado      public.estado_membresia not null default 'activo',
  creado_en   timestamptz not null default now()
);

comment on table public.usuarios_tenants is
  'Membresía usuario-tenant. La PK es `usuario_id` SOLA (no compuesta con '
  'tenant_id): por definición de PK, un usuario_id no puede aparecer en más '
  'de UNA fila en toda la tabla, sin importar el tenant — es 1:1 ESTRICTO a '
  'nivel de esquema, no solo "único dentro del mismo tenant". Confirmado en '
  'ronda de revisión: no hace falta ningún índice único parcial adicional '
  'para impedir membresías activas cruzadas entre tenants, porque no puede '
  'existir una SEGUNDA fila del mismo usuario en ningún estado, ni siquiera '
  'inactiva, para intentarlo. Si el MVP alguna vez pasa a N:M (usuario en '
  'varios tenants), este comentario y la PK deben revisarse juntos. '
  '"No se puede dejar el tenant sin Admin" (AUTH-4) se valida en la app '
  '(backend-app), no aquí: es una regla de negocio multi-fila, no un '
  'guardia de integridad simple.';

create index usuarios_tenants_tenant_id_idx on public.usuarios_tenants (tenant_id);

alter table public.usuarios_tenants enable row level security;
alter table public.usuarios_tenants force row level security;

create policy usuarios_tenants_ver_mismo_tenant on public.usuarios_tenants
  for select
  to authenticated
  using (tenant_id = (select private.current_tenant_id()) or (select private.is_super_admin()));

create policy usuarios_tenants_insertar_mismo_tenant on public.usuarios_tenants
  for insert
  to authenticated
  with check (tenant_id = (select private.current_tenant_id()) or (select private.is_super_admin()));

create policy usuarios_tenants_editar_mismo_tenant on public.usuarios_tenants
  for update
  to authenticated
  using (tenant_id = (select private.current_tenant_id()) or (select private.is_super_admin()))
  with check (tenant_id = (select private.current_tenant_id()) or (select private.is_super_admin()));

-- AUTH-4 (gestión de staff: cambiar rol, desactivar/quitar) requiere que un
-- Admin pueda ver nombre/correo de los DEMÁS miembros de su propio tenant,
-- no solo su propia fila (policy `usuarios_propia_fila`, más arriba, solo
-- cubre id = auth.uid()). Se define AQUÍ (y no junto a las demás políticas
-- de `usuarios`) porque recién en este punto del archivo existe la tabla
-- `usuarios_tenants` que referencia. `usuarios_tenants` está protegida por
-- su propia RLS (`tenant_id = current_tenant_id()`), así que este EXISTS ya
-- queda acotado al tenant del que el llamador es realmente miembro — no
-- hace falta security definer aquí tampoco.
create policy usuarios_ver_mismo_tenant on public.usuarios
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.usuarios_tenants ut
      where ut.usuario_id = usuarios.id
        and ut.tenant_id = (select private.current_tenant_id())
    )
  );

-- -----------------------------------------------------------------------------
-- invitaciones (AUTH-3)
-- -----------------------------------------------------------------------------
create table public.invitaciones (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants (id) on delete cascade,
  email         text not null,
  rol           public.rol_usuario not null,
  estado        public.estado_invitacion not null default 'pendiente',
  token         text not null default encode(gen_random_bytes(32), 'hex'),
  invitado_por  uuid references public.usuarios (id) on delete set null,
  expira_en     timestamptz not null,
  creado_en     timestamptz not null default now(),
  constraint invitaciones_token_unique unique (token)
);

comment on table public.invitaciones is
  'Invitación de staff (AUTH-3): correo + rol + enlace con vencimiento. '
  'reenviar = nueva fila o refrescar token/expira_en (decisión de la app); '
  'cancelar = estado=cancelada.';

create index invitaciones_tenant_id_idx on public.invitaciones (tenant_id);
create index invitaciones_pendientes_por_tenant_idx on public.invitaciones (tenant_id, email)
  where estado = 'pendiente';

-- Consistencia de tenant en invitado_por: verificar_tenant_padre necesita un
-- 3er argumento porque `usuarios_tenants` no tiene columna `id` (su PK es
-- `usuario_id`). invitado_por es nullable (no se valida si no está seteado).
create trigger trg_invitaciones_invitado_por_tenant_padre
  before insert or update on public.invitaciones
  for each row
  execute function public.verificar_tenant_padre('invitado_por', 'usuarios_tenants', 'usuario_id');

alter table public.invitaciones enable row level security;
alter table public.invitaciones force row level security;

create policy invitaciones_mismo_tenant on public.invitaciones
  for all
  to authenticated
  using (tenant_id = (select private.current_tenant_id()))
  with check (tenant_id = (select private.current_tenant_id()));

-- El invitado acepta la invitación ANTES de tener membresía (todavía no es
-- parte del tenant) — típicamente vía una función de backend con
-- SECURITY DEFINER dedicada (a diseñar en la tarea 1.2 de Auth), no por
-- lectura directa de esta tabla desde un usuario anónimo. Por eso no se
-- agrega aquí ninguna política para `anon`: el flujo de aceptación de
-- invitación se resuelve server-side con el token (fuera del alcance de RLS
-- de lectura pública) en la tarea de Auth.

-- -----------------------------------------------------------------------------
-- tenant_contadores + public.siguiente_contador()
-- -----------------------------------------------------------------------------
-- Secuencias propias por tenant (ej. numeración interna de cualquier recurso
-- del dominio de la app). Se modela como tabla + función atómica en vez de
-- `sequence` de Postgres porque necesitamos UNA secuencia INDEPENDIENTE por
-- (tenant_id, contador) sin crear una sequence nueva por cada tenant que se
-- registre.
create table public.tenant_contadores (
  tenant_id  uuid not null references public.tenants (id) on delete cascade,
  contador   text not null,   -- nombre lógico del contador (definido por la app)
  valor      bigint not null default 0,
  primary key (tenant_id, contador)
);

comment on table public.tenant_contadores is
  'Secuencias atómicas por tenant. Sin acceso directo desde la API: solo vía '
  'public.siguiente_contador() (security definer).';

-- Sin políticas permisivas: RLS habilitado + FORCE + ningún GRANT directo a
-- authenticated/anon => deny-by-default total sobre la tabla en sí.
alter table public.tenant_contadores enable row level security;
alter table public.tenant_contadores force row level security;
revoke all on public.tenant_contadores from authenticated, anon;

create or replace function public.siguiente_contador(p_tenant_id uuid, p_contador text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_valor bigint;
begin
  if p_tenant_id is distinct from (select private.current_tenant_id())
     and not (select private.is_super_admin()) then
    raise exception 'No autorizado para el tenant %', p_tenant_id;
  end if;

  insert into public.tenant_contadores (tenant_id, contador, valor)
  values (p_tenant_id, p_contador, 1)
  on conflict (tenant_id, contador)
  do update set valor = public.tenant_contadores.valor + 1
  returning valor into v_valor;

  return v_valor;
end;
$$;

comment on function public.siguiente_contador(uuid, text) is
  'Devuelve el siguiente número atómico de la secuencia (tenant_id, contador). '
  'Uso: numeración interna de cualquier recurso del dominio de la app. Valida '
  'que el llamador pertenezca al tenant solicitado.';

revoke all on function public.siguiente_contador(uuid, text) from public;
grant execute on function public.siguiente_contador(uuid, text) to authenticated;
