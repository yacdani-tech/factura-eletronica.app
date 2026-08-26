-- =============================================================================
-- Migración: super_admin_tenant_activo — selección de tenant en modo soporte
-- -----------------------------------------------------------------------------
-- IMPACTO: crea UNA tabla nueva, `public.super_admin_tenant_activo` (0 filas
-- hoy, greenfield). Cero cambios en tablas/columnas/políticas existentes. Es
-- la PRIMERA de 3 migraciones de la feature "Super-Admin opera dentro de
-- cualquier tenant para soporte" (decisión de Yac, adelantada; la consola/
-- dashboard de super-admin es 2.1, fuera de esta tarea — esto es SOLO la capa
-- de BD). Las otras 2 migraciones de la misma feature:
--   - 20260714221000: extiende private.current_tenant_id()/is_admin() para
--     que lean esta tabla.
--   - 20260714222000: columna auditoria.actor_soporte + forzar_actor_auditoria().
--
-- QUÉ REPRESENTA LA TABLA: "este Super-Admin está operando AHORA dentro de
-- este tenant, con fines de soporte". Una fila = está dentro de ese tenant
-- (modo soporte activo); SIN fila = modo plataforma (ningún tenant
-- seleccionado). PK en `usuario_id` (no compuesta): por diseño, un
-- Super-Admin solo puede tener UN tenant seleccionado a la vez (igual
-- justificación 1:1 que usuarios_tenants, pero acá es 0:1 en vez de 1:1 — la
-- ausencia de fila es un estado válido y esperado).
--
-- ES DESTRUCTIVA: no. Tabla nueva sin dependientes.
--
-- SEGURIDAD (por qué esto NO permite que un usuario común se auto-asigne un
-- tenant, ni que un Super-Admin actúe en nombre de otro):
--   1. RLS deny-by-default: solo el PROPIO Super-Admin (is_super_admin() AND
--      usuario_id = auth.uid()) puede ver/insertar/actualizar/borrar SU fila.
--      Nadie más — ni siquiera un Admin de tenant sobre lo que sea que crea
--      que es "su" fila (no puede serlo: usuario_id siempre es el suyo
--      propio, ver punto 2).
--   2. Defensa en profundidad — trigger `forzar_usuario_super_admin_tenant_activo`
--      (BEFORE INSERT OR UPDATE): si hay sesión, PISA `usuario_id :=
--      auth.uid()` (mismo contrato que forzar_creado_por_documentos/
--      forzar_actor_auditoria: nunca confiar en una columna de identidad que
--      viene del payload del cliente, aunque el `with check` de RLS ya la
--      exija). Sin sesión (service_role/proceso de confianza), respeta el
--      valor explícito.
--   3. Guardia adicional en el MISMO trigger: si `NEW.usuario_id` no está en
--      `public.super_admins`, RAISE EXCEPTION. Esto es lo que impide que la
--      tabla se use para que un usuario CUALQUIERA se "auto-asigne" un
--      tenant — incluso si alguna política RLS futura se relajara por error,
--      esta guardia sigue bloqueando el INSERT/UPDATE a nivel de esquema (no
--      depende de que RLS se mantenga correcta para siempre; mismo principio
--      que impedir_tenant_sin_admin_activo/bloquear_mutacion_append_only).
--   4. `tenant_id` NO se restringe a "un tenant real que exista y esté
--      activo" más allá de la FK (cualquier tenant activo o bloqueado es
--      válido para soporte a propósito: un Super-Admin en soporte puede
--      necesitar operar sobre un tenant bloqueado para diagnosticar por qué
--      lo está). El valor de `tenant_id` NUNCA se valida contra RLS de otra
--      tabla para decidir si "existe" desde el punto de vista del cliente:
--      la seguridad real no está en validar el tenant_id en sí (cualquier
--      UUID de un tenant real es un valor legítimo para un Super-Admin), sino
--      en que SOLO un Super-Admin puede tener una fila acá — eso es lo que
--      `current_tenant_id()` (próxima migración) va a confiar.
--   5. Cambiar de tenant seleccionado (UPDATE de `tenant_id` en la propia
--      fila) refresca `seleccionado_en` automáticamente (mismo trigger) —
--      evita que la app tenga que hacer DELETE+INSERT para "cambiar de
--      tenant en soporte" y deja timestamp fiel de cuándo empezó la sesión
--      de soporte en el tenant ACTUAL (no el primero que se seleccionó).
--   6. `usuario_id` es INMUTABLE en UPDATE (mismo trigger, RAISE explícito si
--      `NEW.usuario_id IS DISTINCT FROM OLD.usuario_id`): un UPDATE legítimo
--      sobre esta tabla solo puede cambiar `tenant_id`. No es solo un efecto
--      derivado del punto 2 (que ya neutraliza esto DE HECHO en cualquier
--      UPDATE con sesión): el rechazo explícito importa para un UPDATE SIN
--      sesión, donde el punto 2 no fuerza nada — sin este guardia, un proceso
--      de confianza podría "transferir" la fila a otro usuario_id con un
--      simple UPDATE, algo que esta tabla nunca debe permitir (la vía
--      correcta para eso es DELETE + INSERT, no una mutación de identidad
--      in-place).
--
-- CÓMO VALIDAR (con el MCP, después de aplicar):
--   - list_tables: `super_admin_tenant_activo` con RLS+FORCE, PK usuario_id,
--     FK tenant_id -> tenants, índice en tenant_id.
--   - Como usuario NO super-admin autenticado: INSERT en esta tabla debe
--     fallar con P0001 (la guardia del trigger — que corre BEFORE INSERT,
--     SIEMPRE antes de que Postgres evalúe el WITH CHECK de RLS — fuerza
--     usuario_id := auth.uid() y luego exige que sea un Super-Admin real;
--     con este diseño, el 42501 de RLS queda inalcanzable en la práctica
--     para un INSERT con sesión, porque las condiciones que el trigger ya
--     garantiza cuando no falla implican las del propio with check — ver
--     nota de diseño extendida en la suite pgTAP).
--   - Como Super-Admin autenticado (fila en super_admins): INSERT con
--     cualquier tenant_id real debe funcionar y dejar usuario_id = auth.uid()
--     sin importar qué usuario_id se haya mandado en el payload.
--   - Como rol de sesión (BYPASSRLS) intentando INSERT con un usuario_id que
--     NO está en super_admins: debe fallar P0001 (guardia del trigger, no
--     depende de RLS).
--   - Un segundo Super-Admin autenticado no debe poder ver/editar la fila del
--     primero (0 filas en SELECT, ninguna fila alcanzada en UPDATE/DELETE).
--   - Como rol de sesión (BYPASSRLS, sin auth.uid()): un UPDATE que intente
--     cambiar usuario_id de una fila existente debe fallar P0001 (guardia
--     explícita de inmutabilidad, punto 2 arriba) — con sesión, este mismo
--     intento nunca llega a probarse de verdad porque el punto 1 ya fuerza
--     usuario_id de vuelta a auth.uid() antes de que el chequeo de igualdad
--     pueda ver una diferencia.
--   - Correr la suite pgTAP
--     supabase/tests/database/20260714_super_admin_soporte.test.sql.
--
-- PLAN DE REVERSIÓN (pensado, no ejecutado automáticamente):
--   drop trigger trg_super_admin_tenant_activo_forzar_usuario on public.super_admin_tenant_activo;
--   drop function if exists public.forzar_usuario_super_admin_tenant_activo();
--   drop table if exists public.super_admin_tenant_activo;
-- =============================================================================

create table public.super_admin_tenant_activo (
  usuario_id      uuid primary key references public.usuarios (id) on delete cascade,
  tenant_id       uuid not null references public.tenants (id) on delete cascade,
  seleccionado_en timestamptz not null default now()
);

comment on table public.super_admin_tenant_activo is
  'Selección de "modo soporte" de un Super-Admin de plataforma: una fila = '
  'ese Super-Admin está operando AHORA dentro de tenant_id (acceso total, '
  'nivel Admin, vía private.is_admin() — ver 20260714221000); sin fila = modo '
  'plataforma (ningún tenant seleccionado). PK en usuario_id (0:1, no 1:1: la '
  'ausencia de fila es un estado normal). RLS deny-by-default: solo el propio '
  'Super-Admin ve/gestiona SU fila (nadie más, ni siquiera Admin de tenant). '
  'usuario_id se fuerza siempre desde auth.uid() (trg_..._forzar_usuario, '
  'nunca del payload) y ese mismo trigger exige que sea un Super-Admin real '
  '(existe en super_admins) — defensa en profundidad más allá de RLS: esta '
  'tabla no puede usarse para que un usuario cualquiera se auto-asigne un '
  'tenant. La consola/dashboard que use esta tabla (elegir/salir de un '
  'tenant) es tarea 2.1, fuera de esta migración — esto es solo la capa BD.';

comment on column public.super_admin_tenant_activo.tenant_id is
  'Tenant que el Super-Admin está operando en modo soporte. Cualquier tenant '
  'real (activo o bloqueado) es un valor válido: un Super-Admin puede '
  'necesitar entrar a un tenant bloqueado para diagnosticarlo. La seguridad '
  'NO está en validar este valor contra otra RLS: está en que SOLO un '
  'Super-Admin puede tener fila en esta tabla (ver trigger de guardia).';

comment on column public.super_admin_tenant_activo.seleccionado_en is
  'Se refresca a now() en cada INSERT y en cada UPDATE que cambie tenant_id '
  '(trg_super_admin_tenant_activo_forzar_usuario) — timestamp de cuándo '
  'empezó la sesión de soporte en el tenant ACTUALMENTE seleccionado, no el '
  'primero que se eligió alguna vez.';

create index super_admin_tenant_activo_tenant_id_idx
  on public.super_admin_tenant_activo (tenant_id);

alter table public.super_admin_tenant_activo enable row level security;
alter table public.super_admin_tenant_activo force row level security;

-- Deny-by-default total salvo la propia fila del propio Super-Admin. Ningún
-- bypass adicional para Admin de tenant ni para otro Super-Admin: cada
-- Super-Admin gestiona SOLO su propia selección.
create policy super_admin_tenant_activo_propia_fila on public.super_admin_tenant_activo
  for all
  to authenticated
  using (
    (select private.is_super_admin())
    and usuario_id = (select auth.uid())
  )
  with check (
    (select private.is_super_admin())
    and usuario_id = (select auth.uid())
  );

-- -----------------------------------------------------------------------------
-- public.forzar_usuario_super_admin_tenant_activo()
-- -----------------------------------------------------------------------------
-- BEFORE INSERT OR UPDATE. Tres garantías, ninguna delegada solo a RLS:
--   1. Con sesión activa, usuario_id SIEMPRE es auth.uid() (ignora el
--      payload) — mismo contrato que forzar_creado_por_documentos/
--      forzar_actor_auditoria. Sin sesión (service_role/proceso de
--      confianza), respeta el valor explícito.
--   2. `usuario_id` es INMUTABLE en UPDATE, explícito (no solo "neutralizado
--      de hecho" por el punto 1): un UPDATE legítimo sobre esta tabla SOLO
--      puede cambiar `tenant_id` (+ el refresco de `seleccionado_en` que
--      dispara ese cambio). Con sesión, el punto 1 ya deja NEW.usuario_id =
--      auth.uid() = OLD.usuario_id de hecho (RLS `using` ya exigía que la fila
--      objetivo fuera la propia) — este chequeo explícito es la defensa que
--      importa para un UPDATE SIN sesión (service_role/proceso de confianza),
--      donde el punto 1 no fuerza nada: sin este RAISE, un proceso de
--      confianza podría "transferir" la fila a otro usuario_id con un simple
--      UPDATE, algo que esta tabla nunca debe permitir (cada Super-Admin
--      gestiona SOLO su propia selección; "transferir" no es un caso de uso
--      real — la vía correcta sería DELETE + INSERT, dos filas con historia
--      propia, no una mutación de identidad in-place).
--   3. El usuario_id resultante (tras el punto 1) DEBE existir en
--      public.super_admins, o la operación se rechaza — defensa en
--      profundidad: esta tabla no debe poder usarse para que un usuario
--      cualquiera se auto-asigne un tenant, ni siquiera si una política RLS
--      futura más amplia lo permitiera por error (mismo principio que
--      impedir_tenant_sin_admin_activo/bloquear_mutacion_append_only: la
--      guardia vive a nivel de esquema, no solo en RLS).
create or replace function public.forzar_usuario_super_admin_tenant_activo()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null then
    NEW.usuario_id := (select auth.uid());
  end if;

  if TG_OP = 'UPDATE' then
    if NEW.usuario_id is distinct from OLD.usuario_id then
      raise exception
        'super_admin_tenant_activo: usuario_id es inmutable (fila %) — un UPDATE solo puede cambiar tenant_id; para "transferir" la selección a otro usuario_id, usar DELETE + INSERT',
        OLD.usuario_id;
    end if;

    if NEW.tenant_id is distinct from OLD.tenant_id then
      NEW.seleccionado_en := now();
    end if;
  end if;

  if not exists (
    select 1 from public.super_admins sa where sa.usuario_id = NEW.usuario_id
  ) then
    raise exception
      'super_admin_tenant_activo: usuario % no es Super-Admin de plataforma (tabla super_admins) — no puede tener selección de tenant en modo soporte',
      NEW.usuario_id;
  end if;

  return NEW;
end;
$$;

comment on function public.forzar_usuario_super_admin_tenant_activo() is
  'Trigger BEFORE INSERT OR UPDATE en super_admin_tenant_activo: con sesión, '
  'fuerza usuario_id = auth.uid() en INSERT (nunca confiar en el payload); en '
  'UPDATE, usuario_id es INMUTABLE (RAISE explícito si cambia — un UPDATE '
  'legítimo solo toca tenant_id) y refresca seleccionado_en cuando cambia el '
  'tenant_id seleccionado; exige SIEMPRE que el usuario_id resultante sea un '
  'Super-Admin real (existe en super_admins), defensa en profundidad más allá '
  'de RLS.';

create trigger trg_super_admin_tenant_activo_forzar_usuario
  before insert or update on public.super_admin_tenant_activo
  for each row
  execute function public.forzar_usuario_super_admin_tenant_activo();
