-- =============================================================================
-- Migración: current_tenant_id()/is_admin() resuelven el modo soporte de
-- Super-Admin (2da de 3 migraciones de la feature — ver header de 20260714220000)
-- -----------------------------------------------------------------------------
-- IMPACTO: agrega 1 función nueva (private.tenant_soporte_activo()) y
-- reemplaza (create or replace, misma firma) el cuerpo de
-- private.current_tenant_id() y private.is_admin(). CERO cambios de esquema,
-- columnas, políticas RLS o triggers de ninguna tabla — el efecto es 100%
-- indirecto, a través de estas 2 funciones que ya usa TODA la RLS del
-- proyecto. `create or replace function` con la MISMA firma conserva los
-- grants/revokes ya aplicados (revoke public+anon, grant authenticated —
-- 20260713090000/20260714201000): no hace falta re-declararlos.
--
-- ES DESTRUCTIVA: no. Para un usuario SIN membresía en super_admins, el
-- comportamiento de ambas funciones es BYTE A BYTE el mismo que antes (ver
-- diseño). Ningún tenant ni usuario existente pierde ni gana acceso salvo el
-- caso nuevo explícito: un Super-Admin CON una fila en
-- super_admin_tenant_activo (tabla creada en 20260714220000, hoy 0 filas en
-- cualquier proyecto real hasta que la consola 2.1 la use).
--
-- INVARIANTE DE NO-RECURSIÓN (documentado explícito, no solo implícito):
-- private.is_super_admin() (20260713090000) NO debe depender jamás de
-- private.current_tenant_id()/tenant_soporte_activo() — hoy solo lee
-- public.super_admins por auth.uid(), sin llamar a ninguna otra función
-- private. Esto importa porque la cadena de esta migración es
-- current_tenant_id() -> tenant_soporte_activo() -> is_super_admin(): si
-- is_super_admin() alguna vez "mirara hacia atrás" y llamara a
-- current_tenant_id() (directa o indirectamente, vía is_admin()/current_rol()
-- o cualquier otra función que dependa de current_tenant_id()), se cerraría
-- un ciclo real de invocación plpgsql (no detectado en tiempo de CREATE
-- FUNCTION — plpgsql no valida esto al compilar, solo al ejecutar) que
-- terminaría en "stack depth limit exceeded" la primera vez que CUALQUIER
-- política RLS del proyecto llamara a current_tenant_id(). Se agrega este
-- párrafo al comment on function de is_super_admin() (más abajo) para que
-- quede advertido en el propio catálogo, no solo en el texto de esta
-- migración.
--
-- DISEÑO:
--   - private.tenant_soporte_activo(): devuelve el tenant_id de la selección
--     de soporte del usuario autenticado SOLO si es Super-Admin (si no lo es,
--     null inmediato, sin tocar la tabla). Mismo contrato de ejecución que
--     current_tenant_id()/is_super_admin()/current_rol(): plpgsql (compilación
--     perezosa), stable, security definer, search_path fijo, revoke de public
--     Y anon explícito, grant solo a authenticated (aprendizaje 2026-07-13:
--     revoke de PUBLIC no alcanza a anon en Supabase).
--   - private.current_tenant_id(): ahora resuelve en ESTE orden:
--       (a) si tenant_soporte_activo() no es null -> ESE tenant (modo
--           soporte: el Super-Admin "es" ese tenant mientras dure la
--           selección).
--       (b) si no -> la membresía activa de usuarios_tenants, EXACTAMENTE
--           como antes (código sin tocar, solo movido dentro del mismo if).
--     Un usuario normal (sin fila en super_admins) pasa SIEMPRE por (b): cero
--     cambio de comportamiento. Un Super-Admin SIN selección (sin fila en
--     super_admin_tenant_activo) también cae a (b) — si además tuviera
--     membresía propia (caso raro, no es el flujo esperado: un Super-Admin de
--     plataforma normalmente NO es miembro de ningún tenant), vería SU propio
--     tenant como antes; si no tiene membresía (el caso normal), sigue dando
--     NULL igual que hoy. EFECTO EN LA APP (para backend-app/ui-app, próxima
--     fase 2.1): un Super-Admin sin selección activa tendrá
--     current_tenant_id() = null (salvo el caso raro de arriba) — cualquier
--     pantalla que dependa de "tener un tenant" debe branchear a un estado
--     "modo plataforma, elegí un tenant" en vez de asumir que todo usuario
--     autenticado tiene tenant.
--   - private.is_admin(): true si (tenant_soporte_activo() no es null) O
--     (current_rol() = 'admin'), EXACTAMENTE la opción simple sugerida en el
--     encargo. Un Super-Admin operando en un tenant seleccionado queda con
--     TODO el acceso que hoy tienen las políticas que exigen is_admin()
--     (usuarios_tenants INSERT/UPDATE, invitaciones SELECT/INSERT/UPDATE/
--     DELETE, tenants UPDATE) — acceso total = nivel Admin, tal como pide el
--     encargo. DECISIÓN DOCUMENTADA (no se cambia current_rol()): current_rol()
--     sigue leyendo SOLO usuarios_tenants y sigue devolviendo NULL para un
--     Super-Admin en soporte (no tiene membresía real, y no se le crea una
--     fila falsa en usuarios_tenants para simularla — eso ensuciaría el
--     conteo de "admins activos" de impedir_tenant_sin_admin_activo y el
--     listado real de staff del tenant). Efecto: is_admin() alcanza para
--     TODA la RLS que hoy discrimina por rol, pero cualquier código de la
--     app (fase 2.1) que use current_rol() directamente (en vez de
--     is_admin()) para decidir UX de "sos Admin" NO verá al Super-Admin en
--     soporte como admin — debe usar (o exponer) is_admin(), no current_rol(),
--     si quiere reflejar el modo soporte en la UI. Señalado explícitamente
--     para que backend-app/ui-app lo tengan en cuenta en 2.1.
--   - El resto de las ~30 políticas RLS del proyecto (paquetes, documentos,
--     subclientes, consolidados, rutas, zonas, notas de crédito,
--     documento_lineas, log_envios, tenant_atributos_producto,
--     paquete_atributos, consumo/notificaciones, etc.) NO usan is_admin() en
--     absoluto — dependen SOLO de current_tenant_id() = tenant_id. Revisadas
--     una por una (grep de `private.current_tenant_id()` y
--     `private.is_admin()` contra supabase/migrations/): ninguna necesita
--     cambio de política — extender current_tenant_id() ya les da al
--     Super-Admin en soporte el mismo acceso que a un miembro real del
--     tenant seleccionado, automáticamente, sin tocarlas. Las únicas 3 tablas
--     con lógica admin-only (usuarios_tenants, invitaciones, tenants) están
--     cubiertas por el cambio de is_admin() de esta misma migración.
--   - Catálogos GLOBALES (categorias_producto, atributos_producto,
--     reglas_categoria_atributo — 20260714185748) usan is_super_admin() DIRECTO
--     (no is_admin(), no current_tenant_id()): sin cambios, un Super-Admin
--     sigue gestionándolos siempre, con o sin selección de tenant.
--   - usuarios_tenants/tenants (SELECT) y usuarios_tenants (SELECT vía
--     usuarios_ver_mismo_tenant) YA tenían bypass explícito de
--     is_super_admin() desde 20260713090200 (visibilidad GLOBAL de todos los
--     tenants/membresías para cualquier Super-Admin, con o sin selección) —
--     preexistente, sin cambios en esta migración.
--
-- CÓMO VALIDAR (con el MCP, después de aplicar):
--   - Como usuario normal (admin/operador/contador, sin fila en super_admins):
--     current_tenant_id()/is_admin() se comportan IGUAL que antes de esta
--     migración (sin selección posible: no son Super-Admin).
--   - Como Super-Admin CON fila en super_admin_tenant_activo(tenant=X):
--     current_tenant_id() = X; is_admin() = true; UPDATE en una tabla de
--     negocio del tenant X funciona; del tenant Y (sin selección ahí) NO
--     alcanza ninguna fila.
--   - Como Super-Admin SIN fila en super_admin_tenant_activo: current_tenant_id()
--     = null (salvo que además tuviera membresía propia, caso documentado
--     arriba); is_admin() = false (salvo membresía propia con rol=admin).
--   - Correr la suite pgTAP
--     supabase/tests/database/20260714_super_admin_soporte.test.sql, y
--     re-correr supabase/tests/database/20260713_rls_aislamiento_multitenant.test.sql
--     y supabase/tests/database/20260714_auth_roles_y_rls_admin.test.sql
--     (usuarios normales, sin ninguna fila en super_admins/
--     super_admin_tenant_activo en esas suites) para confirmar CERO regresión.
--
-- PLAN DE REVERSIÓN (pensado, no ejecutado automáticamente): re-crear ambas
-- funciones tal como quedaron en 20260714201000/20260713090000 (sin la rama
-- de tenant_soporte_activo()), y:
--   drop function if exists private.tenant_soporte_activo();
-- =============================================================================

-- -----------------------------------------------------------------------------
-- private.is_super_admin() — SIN cambios de código, solo se extiende su
-- comment on function para dejar escrito en el catálogo el invariante de
-- no-recursión (ver nota de diseño arriba). El cuerpo de la función (creada
-- en 20260713090000) no se toca.
-- -----------------------------------------------------------------------------
comment on function private.is_super_admin() is
  'true si auth.uid() está registrado en super_admins (rol de plataforma de '
  'Plataforma.app). INVARIANTE (20260714221000): esta función NUNCA debe '
  'depender de private.current_tenant_id() ni de private.tenant_soporte_activo() '
  '(directa o indirectamente) — current_tenant_id() -> tenant_soporte_activo() '
  '-> is_super_admin() ya es una cadena real; si is_super_admin() llamara de '
  'vuelta a current_tenant_id() (o a is_admin()/current_rol(), que dependen de '
  'ella), se cerraría un ciclo de invocación plpgsql no detectado en tiempo de '
  'CREATE FUNCTION, que reventaría en tiempo de ejecución ("stack depth limit '
  'exceeded") la primera vez que cualquier política RLS del proyecto llamara '
  'a current_tenant_id().';

-- -----------------------------------------------------------------------------
-- private.tenant_soporte_activo()
-- -----------------------------------------------------------------------------
create or replace function private.tenant_soporte_activo()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant_id uuid;
begin
  if not (select private.is_super_admin()) then
    return null;
  end if;

  -- `limit 1` explícito por contrato (mismo criterio que current_tenant_id()/
  -- current_rol()), aunque usuario_id ya es PK de super_admin_tenant_activo y
  -- por lo tanto no podría devolver más de una fila: `select ... into` sin
  -- STRICT no lanza error ante múltiples filas (silenciosamente tomaría la
  -- primera), así que el `limit 1` deja el comportamiento esperado explícito
  -- en el propio texto de la función, no solo implícito por la PK.
  select sat.tenant_id into v_tenant_id
  from public.super_admin_tenant_activo sat
  where sat.usuario_id = (select auth.uid())
  limit 1;

  return v_tenant_id;
end;
$$;

comment on function private.tenant_soporte_activo() is
  'Tenant que el usuario autenticado tiene seleccionado en modo soporte '
  '(super_admin_tenant_activo), SOLO si es Super-Admin de plataforma; NULL en '
  'cualquier otro caso (no es Super-Admin, o es Super-Admin sin selección '
  'activa). Base de current_tenant_id()/is_admin() para el modo soporte '
  '(20260714221000).';

revoke all on function private.tenant_soporte_activo() from public;
revoke execute on function private.tenant_soporte_activo() from anon;
grant execute on function private.tenant_soporte_activo() to authenticated;

-- -----------------------------------------------------------------------------
-- private.current_tenant_id() — con rama de modo soporte
-- -----------------------------------------------------------------------------
create or replace function private.current_tenant_id()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant_id uuid;
begin
  -- Modo soporte: un Super-Admin con selección activa "es" ese tenant
  -- mientras dure la selección (20260714220000/221000). Para cualquier
  -- usuario que no sea Super-Admin, tenant_soporte_activo() es NULL de
  -- inmediato y este bloque no cambia nada respecto del comportamiento
  -- anterior a esta migración.
  v_tenant_id := (select private.tenant_soporte_activo());
  if v_tenant_id is not null then
    return v_tenant_id;
  end if;

  select ut.tenant_id into v_tenant_id
  from public.usuarios_tenants ut
  where ut.usuario_id = (select auth.uid())
    and ut.estado = 'activo'
  limit 1;

  return v_tenant_id;
end;
$$;

comment on function private.current_tenant_id() is
  'Resuelve el tenant_id del usuario autenticado. Orden: (1) selección de '
  'modo soporte de Super-Admin (private.tenant_soporte_activo(), '
  '20260714221000) — si existe, ESE tenant; (2) si no, la membresía real en '
  'usuarios_tenants (comportamiento original, 20260713090000), sin cambios '
  'para cualquier usuario que no sea Super-Admin con selección activa. Fuente '
  'única de verdad para RLS; nunca confiar en tenant_id proveniente del '
  'cliente.';

-- -----------------------------------------------------------------------------
-- private.is_admin() — con rama de modo soporte
-- -----------------------------------------------------------------------------
create or replace function private.is_admin()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select private.tenant_soporte_activo()) is not null then
    return true;
  end if;

  return (select private.current_rol()) = 'admin';
end;
$$;

comment on function private.is_admin() is
  'true si (a) el usuario autenticado es Super-Admin con selección activa en '
  'super_admin_tenant_activo (modo soporte, 20260714221000 — acceso total = '
  'nivel Admin en el tenant seleccionado), o (b) tiene membresía ACTIVA con '
  'rol=admin en su tenant actual (comportamiento original, 20260714201000). '
  'NOTA: current_rol() NO se modifica y sigue devolviendo NULL para un '
  'Super-Admin en soporte (no tiene membresía real en usuarios_tenants) — '
  'código de app que necesite reflejar "es admin" debe usar is_admin(), no '
  'current_rol() directo, para cubrir también el modo soporte.';
