-- =============================================================================
-- Migración: private.current_tenant_id() excluye tenants bloqueados en la
-- rama de MIEMBRO (backstop de BD de la feature "bloquear courier expulsa y
-- corta acceso a sus usuarios" — plan completo en
-- docs/pendientes/bloquear-courier-expulsar-usuarios.md, sección 5. Esta
-- migración es SOLO el backstop de BD; el resto de la feature — layout,
-- route handler /salir, banner de login, exigirPermiso — es alcance de
-- backend-app/ui-app en otra tarea).
-- -----------------------------------------------------------------------------
-- IMPACTO: reemplaza (create or replace function, MISMA firma) el cuerpo de
-- private.current_tenant_id(), base tal cual estaba en
-- 20260714221000_current_tenant_id_is_admin_soporte.sql (líneas 192-220,
-- última definición de la función, sin redefiniciones posteriores). CERO
-- cambios de esquema, columnas, políticas RLS ni triggers de ninguna tabla —
-- el efecto es 100% indirecto, a través de esta función que ya usa TODA la
-- RLS del proyecto (~30 políticas dependen de current_tenant_id() = tenant_id,
-- ver inventario en el header de 20260714221000). `create or replace
-- function` con la misma firma conserva los grants/revokes ya aplicados
-- (revoke public+anon, grant authenticated — 20260713090000/20260714201000):
-- no hace falta re-declararlos.
--
-- QUÉ CAMBIA (único cambio de código): la rama de MIEMBRO (segundo `select
-- ... into v_tenant_id` del cuerpo, la que corre cuando no hay modo soporte
-- activo) pasa de filtrar solo `usuarios_tenants.estado = 'activo'` a exigir
-- TAMBIÉN `tenants.estado = 'activo'` (join a public.tenants). Un usuario
-- MIEMBRO (con membresía activa) de un tenant con estado='bloqueado' ahora
-- resuelve current_tenant_id() = NULL -> ninguna política RLS del proyecto
-- matchea nada para él -> deny-by-default total sobre sus propios datos de
-- negocio, sin necesidad de tocar ninguna policy individual.
--
-- QUÉ NO CAMBIA (explícito, para que quede documentado en el catálogo y no
-- solo en el encargo):
--   - La rama de MODO SOPORTE (private.tenant_soporte_activo(), evaluada
--     PRIMERO en el cuerpo de la función) NO se toca: un Super-Admin con
--     selección activa sobre un tenant bloqueado sigue resolviendo ESE
--     tenant con normalidad — necesita poder seguir operando/desbloqueando
--     el tenant desde la consola de soporte. tenant_soporte_activo() en sí
--     tampoco se modifica.
--   - private.is_admin() NO se toca en esta migración (sigue dependiendo de
--     tenant_soporte_activo()/current_rol(), ninguno de los dos cambia de
--     comportamiento por esta migración salvo el efecto indirecto ya descrito
--     de current_tenant_id() para la rama de miembro).
--   - private.is_super_admin() NO se toca.
--   - Ninguna política RLS se re-escribe: todas siguen comparando
--     tenant_id = private.current_tenant_id() tal cual, así que el bloqueo
--     se propaga automáticamente a las ~30 tablas que ya dependían de esta
--     función, sin editarlas una por una.
--
-- ES DESTRUCTIVA: no. Para un usuario miembro de un tenant con
-- estado='activo' (el caso de CUALQUIER tenant existente hoy que no haya
-- sido bloqueado explícitamente desde /soporte), el comportamiento es BYTE A
-- BYTE el mismo que antes de esta migración — el join a tenants no descarta
-- ninguna fila adicional porque `estado = 'activo'` ya era el default y el
-- estado normal de todo tenant. El único caso que cambia de comportamiento
-- es el de un usuario miembro de un tenant YA marcado 'bloqueado' — que hoy
-- (antes de esta migración) seguía teniendo acceso pleno a sus datos vía RLS
-- pese al bloqueo, el bug exacto que esta feature corrige.
--
-- CÓMO VALIDAR (contra la BD real, en transacción con ROLLBACK o con datos
-- efímeros que se limpian después):
--   - Miembro de un tenant puesto en estado='bloqueado': current_tenant_id()
--     resuelve NULL; un `select * from paquetes` (o cualquier tabla de
--     negocio) autenticado como ese usuario devuelve 0 filas.
--   - Miembro de un tenant con estado='activo' (el caso normal): sin cambio
--     de comportamiento, current_tenant_id() sigue resolviendo su tenant.
--   - Super-Admin en modo soporte (fila en super_admin_tenant_activo) sobre
--     ESE MISMO tenant bloqueado: current_tenant_id() sigue resolviendo el
--     tenant (rama de soporte corre primero y no filtra por tenants.estado).
--   - Re-correr supabase/tests/database/20260713_rls_aislamiento_multitenant.
--     test.sql y supabase/tests/database/20260714_super_admin_soporte.
--     test.sql para confirmar CERO regresión (ninguna de las dos suites
--     bloquea ningún tenant, así que el join nuevo no debe cambiar ningún
--     resultado ahí).
--
-- PLAN DE REVERSIÓN (pensado, no ejecutado automáticamente): re-crear
-- private.current_tenant_id() tal como quedó en 20260714221000 (rama de
-- miembro SIN el join a public.tenants ni el filtro t.estado = 'activo') —
-- trivial, es quitar 2 líneas del `create or replace function` de abajo.
-- =============================================================================

create or replace function private.current_tenant_id()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_tenant_id uuid;
begin
  -- Modo soporte: un Super-Admin con selección activa "es" ese tenant
  -- mientras dure la selección (20260714220000/221000), SIN filtrar por
  -- tenants.estado — debe poder seguir operando/desbloqueando un tenant
  -- bloqueado desde la consola de soporte. Para cualquier usuario que no sea
  -- Super-Admin, tenant_soporte_activo() es NULL de inmediato y este bloque
  -- no cambia nada respecto del comportamiento anterior a esta migración.
  v_tenant_id := (select private.tenant_soporte_activo());
  if v_tenant_id is not null then
    return v_tenant_id;
  end if;

  -- Rama de miembro (20260815100000): además de la membresía activa, exige
  -- que el TENANT también esté activo. Un miembro de un tenant bloqueado
  -- resuelve NULL acá -> ninguna política RLS del proyecto le alcanza
  -- ninguna fila de datos de negocio.
  select ut.tenant_id into v_tenant_id
  from public.usuarios_tenants ut
  join public.tenants t on t.id = ut.tenant_id
  where ut.usuario_id = (select auth.uid())
    and ut.estado = 'activo'
    and t.estado = 'activo'
  limit 1;

  return v_tenant_id;
end;
$fn$;

comment on function private.current_tenant_id() is
  'Resuelve el tenant_id del usuario autenticado. Orden: (1) selección de '
  'modo soporte de Super-Admin (private.tenant_soporte_activo(), '
  '20260714221000) — si existe, ESE tenant, SIN filtrar por tenants.estado '
  '(el Super-Admin debe poder seguir operando/desbloqueando un tenant '
  'bloqueado); (2) si no, la membresía real ACTIVA en usuarios_tenants '
  'exigiendo TAMBIÉN tenants.estado = ''activo'' (20260815100000: backstop '
  'de BD de "bloquear courier expulsa y corta acceso a sus usuarios" — un '
  'miembro de un tenant con estado=''bloqueado'' resuelve NULL, y por lo '
  'tanto queda sin acceso a NINGÚN dato de negocio vía RLS, sin tocar '
  'ninguna política individual). Fuente única de verdad para RLS; nunca '
  'confiar en tenant_id proveniente del cliente.';
