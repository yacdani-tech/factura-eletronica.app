-- =============================================================================
-- Migración: private.current_rol()/is_admin() + endurecer RLS a solo-Admin
-- (usuarios_tenants, invitaciones, tenants) + guardia BD "no dejar el tenant
-- sin Admin activo"
-- -----------------------------------------------------------------------------
-- IMPACTO: tarea 1.2 (Auth y usuarios), parte 1 y 2 del encargo. Toca:
--   - Crea 2 funciones nuevas en `private` (current_rol, is_admin) — mismo
--     patrón que private.current_tenant_id()/is_super_admin() (20260713090000).
--   - Reemplaza 4 políticas RLS existentes por versiones más estrictas:
--     usuarios_tenants (INSERT, UPDATE), invitaciones (la `for all` se
--     desglosa en 4: select/insert/update/delete), tenants (UPDATE). NINGUNA
--     tabla nueva, ninguna columna nueva, cero filas tocadas.
--   - Agrega 1 trigger nuevo (BEFORE UPDATE en usuarios_tenants): defensa en
--     profundidad para AUTH-4 ("no dejar el tenant sin Admin").
-- ES DESTRUCTIVA: no. Solo estrecha permisos (de "cualquier miembro" a "solo
-- Admin activo, o Super-Admin"); ningún dato existente se pierde ni cambia.
-- Un tenant real que hoy tenga un Operador/Contador editando estas 3 tablas
-- vía la API directa (no vía UI, que en el MVP aún no diferencia por rol en
-- el cliente) empezará a recibir 42501 (RLS) donde antes tenía éxito — es
-- exactamente el endurecimiento pedido (hallazgo de la tarea: "hoy cualquier
-- miembro del tenant puede... eso es solo Admin").
--
-- POR QUÉ (contexto — hallazgo de la tarea 1.2, no un bug reportado):
--   - Spec §5: "Admin: acceso completo dentro del tenant (config, gestión de
--     subclientes, rutas, facturación, staff)". §6.1 AUTH-3 ("Invitación de
--     staff por el Admin"), AUTH-4 ("Gestión de staff: cambiar rol,
--     desactivar/quitar usuario"), COU-4/COU-7 (config del courier, tipo de
--     cambio) — todas acciones de Admin, no de cualquier miembro.
--   - Las políticas creadas en 20260713090200 dejaban estas 3 tablas
--     editables por CUALQUIER miembro autenticado del tenant (Operador o
--     Contador incluidos) porque en ese momento no existía una función para
--     leer el ROL del usuario (solo current_tenant_id()/is_super_admin()).
--     Esta migración cierra ese hueco.
--
-- DISEÑO:
--   - private.current_rol(): lee usuarios_tenants.rol del usuario autenticado
--     filtrando `estado = 'activo'` — MISMO criterio que ya usa
--     current_tenant_id() (20260713090000): un miembro desactivado no cuenta
--     para RLS. Devuelve NULL si no hay membresía activa (nunca revienta).
--   - private.is_admin(): true solo si current_rol() = 'admin'. Un Admin
--     desactivado (estado=inactivo) devuelve false, igual que cualquier otro
--     rol — no hay atajo para "admin inactivo sigue mandando".
--   - Mismo contrato de ejecución que current_tenant_id()/is_super_admin():
--     plpgsql (compilación perezosa, ver 20260713090000), stable, security
--     definer, search_path fijo, revoke de public Y de anon explícito
--     (aprendizaje 2026-07-13: el revoke de PUBLIC NO alcanza a anon en
--     Supabase — default privileges le dan EXECUTE directo), grant solo a
--     authenticated.
--   - usuarios_tenants: SELECT queda IGUAL (todo miembro activo ve las
--     membresías de su propio tenant — necesario para que un Admin vea a su
--     equipo antes de gestionarlo, AUTH-4). INSERT/UPDATE pasan a exigir
--     is_admin() del mismo tenant (o is_super_admin(), que ya podía —
--     necesario para que Plataforma.app cree la membresía del primer Admin
--     al dar de alta un courier nuevo, COU-1: un usuario recién creado no
--     tiene current_tenant_id() propio todavía, así que sin el atajo de
--     super_admin nadie podría crear esa primera fila).
--   - invitaciones: la política `for all` (20260713090200) se desglosa en 4
--     (select/insert/update/delete). DECISIÓN TOMADA (documentada, no
--     preguntada: es una lectura razonable de "la gestión es del Admin" que
--     no contradice ninguna regla dura ni cambia semántica destructiva):
--       * SELECT sigue abierta a TODO miembro activo del tenant (ver la
--         lista de invitaciones pendientes es información de bajo riesgo y
--         el propio AUTH-3 la describe como parte del flujo, sin especificar
--         "solo el Admin la ve"; un Operador viendo "a quién se invitó" no
--         compromete nada).
--       * INSERT/UPDATE/DELETE exigen is_admin() del mismo tenant — invitar,
--         reenviar (=update de token/expira_en) y cancelar (=update de
--         estado, o un DELETE físico si la app alguna vez lo usa así) son
--         gestión de staff, exclusiva del Admin por AUTH-3.
--       * A diferencia de usuarios_tenants/tenants, NO se agrega bypass de
--         is_super_admin() a invitaciones (ni lo tenía la política original
--         `invitaciones_mismo_tenant`): Plataforma.app no gestiona
--         invitaciones de staff de un courier ajeno en el flujo actual. Si
--         Yac quiere que el Super-Admin pueda ver/gestionar invitaciones de
--         cualquier tenant por soporte, es una decisión aparte (ver reporte
--         de la tarea).
--   - tenants: UPDATE pasa a exigir is_admin() del propio tenant (además del
--     camino ya existente de is_super_admin(), sin cambios). INSERT sigue
--     exclusivo de Super-Admin (sin cambios, ya lo era). Sin política de
--     DELETE (sin cambios, ya no la tenía).
--   - Guardia BD "no dejar el tenant sin Admin activo" (AUTH-4): trigger
--     BEFORE UPDATE en usuarios_tenants. Bloquea el ÚLTIMO cambio (de rol o
--     de estado) que dejaría CERO membresías con rol=admin Y estado=activo
--     en ese tenant. Es defensa en profundidad, NO la validación primaria:
--     la UX real (qué error mostrar, sugerir a quién promover antes de
--     intentar el cambio, etc.) vive en la app — el comentario de la propia
--     tabla usuarios_tenants (20260713090200) ya decía esto explícitamente;
--     este trigger es la red de seguridad a nivel de esquema que ni siquiera
--     un rol con BYPASSRLS puede saltarse. NO se aplica a DELETE: no existe
--     política de DELETE para usuarios_tenants (deny-by-default ya de
--     antes), y el único camino real de DELETE físico es la cascada desde
--     `usuarios`/`auth.users` (borrado de cuenta completo, un flujo de
--     soporte/compliance distinto a "cambiar de rol o desactivar", fuera del
--     alcance de esta guardia — si Yac quiere cubrir también ese camino, es
--     una decisión aparte).
--
-- CÓMO VALIDAR (con el MCP, después de aplicar):
--   - list_tables / políticas: usuarios_tenants debe tener
--     usuarios_tenants_ver_mismo_tenant (sin cambios),
--     usuarios_tenants_insertar_admin, usuarios_tenants_editar_admin (nuevas,
--     reemplazan a las de 20260713090200); invitaciones debe tener 4
--     políticas (ver/gestionar por insert/update/delete); tenants debe tener
--     tenants_editar_propio_admin (reemplaza a tenants_editar_propio_o_super_admin).
--   - Como Operador o Contador (rol≠admin) autenticado: INSERT/UPDATE sobre
--     usuarios_tenants, invitaciones e UPDATE sobre tenants deben fallar con
--     42501 (RLS with check).
--   - Como Admin activo de su propio tenant: los mismos caminos deben seguir
--     funcionando sin cambios.
--   - Como Admin de un tenant intentando editar usuarios_tenants/invitaciones
--     /tenants de OTRO tenant: debe seguir fallando (tenant_id no coincide).
--   - Un Admin activo (único de su tenant) intentando degradarse a sí mismo
--     a operador, o desactivarse: debe fallar P0001
--     (trg_usuarios_tenants_impedir_sin_admin). Con un SEGUNDO Admin activo
--     en el mismo tenant, la misma operación debe funcionar.
--   - Correr la suite pgTAP actualizada
--     supabase/tests/database/20260714_auth_roles_y_rls_admin.test.sql.
--
-- PLAN DE REVERSIÓN (pensado, no ejecutado automáticamente):
--   drop trigger trg_usuarios_tenants_impedir_sin_admin on public.usuarios_tenants;
--   drop function if exists public.impedir_tenant_sin_admin_activo();
--   drop policy tenants_editar_propio_admin on public.tenants;
--   create policy tenants_editar_propio_o_super_admin on public.tenants
--     for update to authenticated
--     using (id = (select private.current_tenant_id()) or (select private.is_super_admin()))
--     with check (id = (select private.current_tenant_id()) or (select private.is_super_admin()));
--   drop policy invitaciones_eliminar_admin on public.invitaciones;
--   drop policy invitaciones_actualizar_admin on public.invitaciones;
--   drop policy invitaciones_insertar_admin on public.invitaciones;
--   drop policy invitaciones_ver_mismo_tenant on public.invitaciones;
--   create policy invitaciones_mismo_tenant on public.invitaciones
--     for all to authenticated
--     using (tenant_id = (select private.current_tenant_id()))
--     with check (tenant_id = (select private.current_tenant_id()));
--   drop policy usuarios_tenants_editar_admin on public.usuarios_tenants;
--   drop policy usuarios_tenants_insertar_admin on public.usuarios_tenants;
--   create policy usuarios_tenants_insertar_mismo_tenant on public.usuarios_tenants
--     for insert to authenticated
--     with check (tenant_id = (select private.current_tenant_id()) or (select private.is_super_admin()));
--   create policy usuarios_tenants_editar_mismo_tenant on public.usuarios_tenants
--     for update to authenticated
--     using (tenant_id = (select private.current_tenant_id()) or (select private.is_super_admin()))
--     with check (tenant_id = (select private.current_tenant_id()) or (select private.is_super_admin()));
--   drop function if exists private.is_admin();
--   drop function if exists private.current_rol();
-- =============================================================================

-- -----------------------------------------------------------------------------
-- private.current_rol() / private.is_admin()
-- -----------------------------------------------------------------------------
create or replace function private.current_rol()
returns public.rol_usuario
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rol public.rol_usuario;
begin
  select ut.rol into v_rol
  from public.usuarios_tenants ut
  where ut.usuario_id = (select auth.uid())
    and ut.estado = 'activo'
  limit 1;

  return v_rol;
end;
$$;

comment on function private.current_rol() is
  'Rol (admin/operador/contador) del usuario autenticado, leyendo SU '
  'membresía ACTIVA en usuarios_tenants (mismo criterio de estado=activo que '
  'private.current_tenant_id()). Devuelve NULL si no hay membresía activa: '
  'un miembro desactivado no cuenta para RLS, sin importar qué rol tuviera. '
  'No confundir con is_super_admin() (rol de plataforma, tabla distinta).';

revoke all on function private.current_rol() from public;
revoke execute on function private.current_rol() from anon;
grant execute on function private.current_rol() to authenticated;

create or replace function private.is_admin()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return (select private.current_rol()) = 'admin';
end;
$$;

comment on function private.is_admin() is
  'true si el usuario autenticado tiene membresía ACTIVA con rol=admin en su '
  'tenant actual. Base de las políticas RLS que restringen gestión de staff '
  '(usuarios_tenants), invitaciones y config del tenant (tenants) a solo '
  'Admin — spec §5, AUTH-3/4, COU-4/7.';

revoke all on function private.is_admin() from public;
revoke execute on function private.is_admin() from anon;
grant execute on function private.is_admin() to authenticated;

-- -----------------------------------------------------------------------------
-- usuarios_tenants: INSERT/UPDATE pasan a exigir Admin (o Super-Admin)
-- -----------------------------------------------------------------------------
drop policy usuarios_tenants_insertar_mismo_tenant on public.usuarios_tenants;
drop policy usuarios_tenants_editar_mismo_tenant on public.usuarios_tenants;

-- Super-Admin conserva el atajo (necesario para crear la membresía del
-- primer Admin al dar de alta un courier nuevo, COU-1: ese usuario recién
-- creado todavía no tiene current_tenant_id() propio).
create policy usuarios_tenants_insertar_admin on public.usuarios_tenants
  for insert
  to authenticated
  with check (
    (select private.is_super_admin())
    or (
      tenant_id = (select private.current_tenant_id())
      and (select private.is_admin())
    )
  );

create policy usuarios_tenants_editar_admin on public.usuarios_tenants
  for update
  to authenticated
  using (
    (select private.is_super_admin())
    or (
      tenant_id = (select private.current_tenant_id())
      and (select private.is_admin())
    )
  )
  with check (
    (select private.is_super_admin())
    or (
      tenant_id = (select private.current_tenant_id())
      and (select private.is_admin())
    )
  );

-- -----------------------------------------------------------------------------
-- invitaciones: se desglosa la política `for all` en 4 (ver nota de diseño
-- del header — SELECT abierta a todo miembro, gestión exclusiva de Admin,
-- sin bypass de Super-Admin a propósito, igual que la política original).
-- -----------------------------------------------------------------------------
drop policy invitaciones_mismo_tenant on public.invitaciones;

create policy invitaciones_ver_mismo_tenant on public.invitaciones
  for select
  to authenticated
  using (tenant_id = (select private.current_tenant_id()));

create policy invitaciones_insertar_admin on public.invitaciones
  for insert
  to authenticated
  with check (
    tenant_id = (select private.current_tenant_id())
    and (select private.is_admin())
  );

create policy invitaciones_actualizar_admin on public.invitaciones
  for update
  to authenticated
  using (
    tenant_id = (select private.current_tenant_id())
    and (select private.is_admin())
  )
  with check (
    tenant_id = (select private.current_tenant_id())
    and (select private.is_admin())
  );

create policy invitaciones_eliminar_admin on public.invitaciones
  for delete
  to authenticated
  using (
    tenant_id = (select private.current_tenant_id())
    and (select private.is_admin())
  );

-- -----------------------------------------------------------------------------
-- tenants: UPDATE pasa a exigir Admin del propio tenant (o Super-Admin, sin
-- cambios en ese camino). INSERT sigue exclusivo de Super-Admin (sin tocar).
-- -----------------------------------------------------------------------------
drop policy tenants_editar_propio_o_super_admin on public.tenants;

create policy tenants_editar_propio_admin on public.tenants
  for update
  to authenticated
  using (
    (id = (select private.current_tenant_id()) and (select private.is_admin()))
    or (select private.is_super_admin())
  )
  with check (
    (id = (select private.current_tenant_id()) and (select private.is_admin()))
    or (select private.is_super_admin())
  );

-- -----------------------------------------------------------------------------
-- Guardia BD: no dejar el tenant sin ningún Admin activo (AUTH-4)
-- -----------------------------------------------------------------------------
-- Defensa en profundidad, NO la validación primaria (esa vive en la app,
-- según ya documenta el comentario de usuarios_tenants desde 20260713090200).
-- Bloquea el ÚLTIMO cambio de rol/estado que dejaría el tenant sin ningún
-- admin activo. Sin security definer a propósito: la subconsulta de conteo
-- queda sujeta a la misma RLS de SELECT de usuarios_tenants, que YA permite
-- ver todas las membresías del propio tenant (o de cualquier tenant, para
-- Super-Admin) — no hace falta bypass de privilegios para este chequeo.
create or replace function public.impedir_tenant_sin_admin_activo()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_queda_admin boolean;
begin
  if OLD.rol = 'admin' and OLD.estado = 'activo'
     and not (NEW.rol = 'admin' and NEW.estado = 'activo')
  then
    select exists (
      select 1
      from public.usuarios_tenants ut
      where ut.tenant_id = OLD.tenant_id
        and ut.rol = 'admin'
        and ut.estado = 'activo'
        and ut.usuario_id <> OLD.usuario_id
    ) into v_queda_admin;

    if not v_queda_admin then
      raise exception
        'No se puede dejar el tenant % sin ningún Admin activo (AUTH-4): '
        'promueva a otro miembro a Admin antes de cambiar el rol o '
        'desactivar al usuario % (última membresía Admin activa del tenant). '
        'Este guardia es defensa en profundidad a nivel de BD; la UX de este '
        'caso (a quién promover, confirmación, etc.) vive en la app.',
        OLD.tenant_id, OLD.usuario_id;
    end if;
  end if;
  return NEW;
end;
$$;

comment on function public.impedir_tenant_sin_admin_activo() is
  'Trigger BEFORE UPDATE en usuarios_tenants (AUTH-4): bloquea el último '
  'cambio de rol/estado que dejaría un tenant con cero membresías '
  'rol=admin/estado=activo. Defensa en profundidad (incluso para un rol con '
  'BYPASSRLS); la validación/UX primaria vive en la app. No cubre DELETE '
  '(usuarios_tenants no tiene política de DELETE para authenticated; el '
  'único camino físico es la cascada desde usuarios/auth.users, un flujo de '
  'borrado de cuenta distinto a "cambiar de rol o desactivar", fuera del '
  'alcance de esta guardia).';

create trigger trg_usuarios_tenants_impedir_sin_admin
  before update on public.usuarios_tenants
  for each row
  execute function public.impedir_tenant_sin_admin_activo();

comment on table public.usuarios_tenants is
  'Membresía usuario-tenant. La PK es `usuario_id` SOLA (no compuesta con '
  'tenant_id): por definición de PK, un usuario_id no puede aparecer en más '
  'de UNA fila en toda la tabla, sin importar el tenant — es 1:1 ESTRICTO a '
  'nivel de esquema, no solo "único dentro del mismo tenant". Gestión '
  '(INSERT/UPDATE: cambiar rol, desactivar) restringida a Admin activo del '
  'propio tenant o Super-Admin desde 20260714201000 (antes, cualquier '
  'miembro autenticado del tenant podía mutar esta tabla — hallazgo de la '
  'tarea 1.2). "No se puede dejar el tenant sin Admin" (AUTH-4) se valida '
  'primero en la app (backend-app); desde 20260714201000 además hay un '
  'guardia mínimo en BD (trg_usuarios_tenants_impedir_sin_admin) como '
  'defensa en profundidad — la UX del error sigue siendo responsabilidad de '
  'la app, este trigger solo impide el estado inconsistente a nivel de '
  'esquema. Si el MVP alguna vez pasa a N:M (usuario en varios tenants), '
  'este comentario y la PK deben revisarse juntos.';
