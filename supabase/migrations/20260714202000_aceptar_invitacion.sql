-- =============================================================================
-- Migración: public.aceptar_invitacion(p_token text) — SECURITY DEFINER
-- -----------------------------------------------------------------------------
-- IMPACTO: tarea 1.2 (Auth y usuarios), parte 3 del encargo. Una función
-- nueva; cero cambios de esquema/columnas/políticas. El comentario de la
-- tabla `invitaciones` (20260713090200) difiere explícitamente esta función a
-- "la tarea 1.2 de Auth" — esta migración la cierra.
-- ES DESTRUCTIVA: no.
--
-- CONTRATO:
--   - Recibe el token (texto plano de la URL de invitación, `invitaciones.token`
--     es único). Requiere sesión (auth.uid() IS NOT NULL) — el invitado debe
--     haberse registrado/logueado (Google o correo/contraseña, AUTH-1) ANTES
--     de aceptar; la invitación no crea la cuenta de auth, solo la membresía.
--   - Bloquea la fila (`for update`) para evitar una carrera de doble-aceptación
--     concurrente del mismo token.
--   - Validaciones, en orden, cada una con mensaje de NEGOCIO (nunca un error
--     de constraint crudo):
--     1. Token inexistente -> error genérico (no revela si el token existe
--        pero está en otro estado, para no filtrar información del enlace).
--     2. estado no es 'pendiente' (aceptada/cancelada/expirada) -> error con
--        el estado real (mensaje distinto de "vencida", ver mensaje aparte).
--     3. expira_en <= now() con estado aún 'pendiente' (nadie corrió el
--        vencimiento todavía) -> se marca 'expirada' EN EL ACTO (mismo INSERT
--        transaccional) y falla con mensaje claro de vencimiento.
--     4. Email del usuario autenticado (leído de public.usuarios, la fuente
--        de verdad ya sincronizada — ver migración siguiente de esta tarea)
--        no coincide case-insensitive con invitaciones.email -> error de
--        negocio (nunca dejar aceptar con el correo equivocado).
--     5. El usuario YA tiene membresía (usuarios_tenants es 1:1 por PK en
--        usuario_id) -> chequeo EXPLÍCITO con mensaje de negocio ANTES de
--        intentar el INSERT (para no exponer un 23505 crudo); el INSERT
--        además queda protegido con un `exception when unique_violation` de
--        respaldo por si hay una carrera real entre dos aceptaciones
--        concurrentes del mismo usuario con dos invitaciones distintas.
--   - Camino feliz: INSERT en usuarios_tenants (rol/tenant_id de la
--     invitación, estado='activo') + UPDATE de la invitación a 'aceptada',
--     todo atómico (una sola función, una sola transacción de la llamada
--     RPC). Devuelve la fila de membresía creada.
--   - SECURITY DEFINER a propósito: el invitado NO tiene membresía todavía,
--     así que `private.current_tenant_id()` le devuelve NULL y la política
--     `invitaciones_ver_mismo_tenant` (20260714201000) no le dejaría ver la
--     fila por su cuenta — esta función necesita leer/escribir `invitaciones`
--     y escribir `usuarios_tenants` saltando esa RLS (mismo patrón que
--     `siguiente_contador()`, que además demuestra que el `postgres` real de
--     Supabase tiene BYPASSRLS aunque no sea superusuario).
--   - Grant: revoke de public Y de anon explícito (aprendizaje 2026-07-13 —
--     el revoke de PUBLIC no alcanza a anon en Supabase), grant solo a
--     authenticated (anon no tiene sesión, no puede aceptar nada).
--
-- CÓMO VALIDAR (con el MCP, después de aplicar):
--   - Camino feliz: usuario autenticado con el correo exacto de una
--     invitación pendiente y vigente -> select public.aceptar_invitacion('<token>')
--     crea la membresía con el rol de la invitación y la invitación queda
--     'aceptada'.
--   - Token inexistente -> P0001 con mensaje genérico.
--   - Invitación ya aceptada/cancelada -> P0001 mencionando el estado real.
--   - Invitación vencida (expira_en pasado, estado aún 'pendiente') -> queda
--     'expirada' tras el intento Y falla P0001 con mensaje de vencimiento.
--   - Email del autenticado distinto (case-insensitive) del de la invitación
--     -> P0001, sin crear membresía ni tocar la invitación.
--   - Usuario que YA tiene membresía (otra invitación previa, o ya es Admin
--     de otro tenant) -> P0001 de negocio, NUNCA un 23505 crudo.
--   - Anon (`select public.aceptar_invitacion('x')` sin sesión) -> 42501
--     (permission denied, ni siquiera entra al cuerpo).
--   - Correr la suite pgTAP
--     supabase/tests/database/20260714_auth_roles_y_rls_admin.test.sql
--     (sección aceptar_invitacion).
--
-- PLAN DE REVERSIÓN (pensado, no ejecutado automáticamente):
--   drop function if exists public.aceptar_invitacion(text);
-- =============================================================================

create or replace function public.aceptar_invitacion(p_token text)
returns public.usuarios_tenants
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invitacion  public.invitaciones;
  v_email       text;
  v_membresia   public.usuarios_tenants;
begin
  if (select auth.uid()) is null then
    raise exception 'Debe iniciar sesión para aceptar una invitación.';
  end if;

  -- Bloquea la fila para evitar una carrera de doble-aceptación del mismo
  -- token (dos pestañas, doble click, etc.).
  select * into v_invitacion
  from public.invitaciones
  where token = p_token
  for update;

  if not found then
    raise exception 'El enlace de invitación no es válido.';
  end if;

  if v_invitacion.estado = 'pendiente' and v_invitacion.expira_en <= now() then
    update public.invitaciones set estado = 'expirada' where id = v_invitacion.id;
    raise exception
      'Esta invitación venció el %. Solicite una nueva al Admin de su equipo.',
      to_char(v_invitacion.expira_en, 'DD/MM/YYYY HH24:MI');
  end if;

  if v_invitacion.estado <> 'pendiente' then
    raise exception
      'Esta invitación ya está en estado "%" y no se puede aceptar.',
      v_invitacion.estado;
  end if;

  select email into v_email from public.usuarios where id = (select auth.uid());

  if v_email is null then
    raise exception 'No se encontró su usuario. Intente iniciar sesión nuevamente.';
  end if;

  if lower(v_email) <> lower(v_invitacion.email) then
    raise exception
      'Esta invitación fue enviada a otro correo (%). Inicie sesión con ese correo para aceptarla.',
      v_invitacion.email;
  end if;

  if exists (select 1 from public.usuarios_tenants where usuario_id = (select auth.uid())) then
    raise exception
      'Su usuario ya pertenece a un equipo: un usuario solo puede pertenecer '
      'a un tenant (regla 1:1 del MVP). Si necesita cambiarse de equipo, '
      'contacte a soporte.';
  end if;

  begin
    insert into public.usuarios_tenants (usuario_id, tenant_id, rol, estado)
    values ((select auth.uid()), v_invitacion.tenant_id, v_invitacion.rol, 'activo')
    returning * into v_membresia;
  exception when unique_violation then
    raise exception
      'Su usuario ya pertenece a un equipo (aceptación concurrente detectada). '
      'Recargue la página.';
  end;

  update public.invitaciones set estado = 'aceptada' where id = v_invitacion.id;

  return v_membresia;
end;
$$;

comment on function public.aceptar_invitacion(text) is
  'Acepta una invitación de staff (AUTH-3) por su token: valida vigencia '
  '(marca expirada si venció), que el correo del autenticado coincida '
  '(case-insensitive) y que no tenga membresía previa (1:1), inserta la '
  'membresía con el rol de la invitación y la marca aceptada — todo atómico. '
  'SECURITY DEFINER: el invitado aún no tiene membresía/tenant propio, así '
  'que necesita saltar la RLS de invitaciones/usuarios_tenants para leer su '
  'propia invitación por token y crear su membresía.';

revoke all on function public.aceptar_invitacion(text) from public;
revoke execute on function public.aceptar_invitacion(text) from anon;
grant execute on function public.aceptar_invitacion(text) to authenticated;
