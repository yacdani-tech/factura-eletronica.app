-- =============================================================================
-- Migración: public.correo_pertenece_a_otro_tenant(p_correo text) — chequeo de
-- "un usuario = un tenant" (regla dura #2) para bloquear invitaciones cruzadas
-- (UX pedida por Yac, 2026-07-17)
-- -----------------------------------------------------------------------------
-- POR QUÉ HACE FALTA UNA FUNCIÓN (no alcanza con RLS + cliente de sesión):
--   Al crear una invitación, la app necesita saber si el correo invitado YA
--   pertenece (tiene membresía) a OTRO tenant, para rechazarla con un mensaje
--   genérico en vez de dejar que un usuario termine con dos membresías (regla
--   dura #2: "un usuario pertenece a UN solo tenant"). El problema: la RLS de
--   `usuarios_tenants` (`usuarios_tenants_ver_mismo_tenant`, 20260713090200)
--   oculta correctamente las membresías de CUALQUIER otro tenant al Admin que
--   está creando la invitación — por diseño, no es un bug. Con el cliente de
--   sesión normal (rol `authenticated`, sujeto a esa RLS), un `select` directo
--   sobre `usuarios_tenants` para el correo invitado siempre da 0 filas si la
--   membresía real es de otro tenant, indistinguible de "no tiene membresía en
--   ningún lado". Hace falta una función `security definer` que SÍ pueda leer
--   a través de esa RLS, con su propio gate de autorización explícito
--   (obligatorio: una función `security definer` sin gate sería un bypass de
--   RLS regalado a cualquier `authenticated`) y que devuelva SOLO un booleano
--   — nunca qué tenant, ni ningún otro dato de la membresía ajena.
--
-- IMPACTO: agrega 1 función nueva en `public` (ningún cambio de tabla, columna,
-- política RLS existente ni trigger). No se toca ninguna fila.
-- ES DESTRUCTIVA: no. Greenfield para esta función (no reemplaza nada previo).
--
-- DISEÑO:
--   - Normaliza el correo recibido con `lower(btrim(p_correo))`, y compara
--     contra `lower(btrim(u.email))` (no contra `u.email` crudo): el correo
--     que llega desde la app YA se normaliza antes de llamar
--     (apps/web/lib/staff/acciones.ts: `.trim().toLowerCase()`), pero
--     `public.usuarios.email` se sincroniza tal cual viene de
--     `auth.users.email` (20260714203000) — no hay garantía de que TODA fila
--     histórica esté ya en minúsculas, así que la función normaliza ambos
--     lados por las suyas, sin depender de la disciplina del caller ni de una
--     migración de backfill.
--   - ANTI-ENUMERACIÓN (gate de rol, decisión tomada y documentada — el
--     encargo pedía decidir entre "false" y "raise"): el llamador debe ser
--     `private.is_admin()` (Admin real del tenant actual, o Super-Admin en
--     modo soporte — ver 20260714221000/223000: `is_admin()` YA cubre ambos
--     casos) O `private.is_super_admin()` (cubre al Super-Admin SIN selección
--     activa, que `is_admin()` solo no alcanzaría). Si el llamador no cumple
--     ninguna de las dos, se devuelve `false` de inmediato, NUNCA una
--     excepción: un booleano fijo no le da a un llamador no autorizado ninguna
--     señal distinta entre "no tenés permiso" y "el correo no pertenece a otro
--     tenant" — un `raise` sería un oráculo (¿qué excepción específica?,
--     ¿mensaje distinto?) que un cliente sin permiso podría usar para inferir
--     información. `false` es estrictamente menos información revelada.
--   - Devuelve TRUE si existe un `usuarios.email` (normalizado) con AL MENOS
--     una fila en `usuarios_tenants` cuyo `tenant_id` sea DISTINTO
--     (`is distinct from`, no `<>`: correcto incluso si
--     `private.current_tenant_id()` fuera NULL) del tenant actual del
--     llamador. Nunca expone CUÁL es ese otro tenant ni ningún otro dato: el
--     `exists (...)` colapsa todo a un solo booleano.
--   - `usuarios_tenants` es 1:1 por PK (`usuario_id` solo, regla dura #2 /
--     comentario de 20260713090200): el `exists` nunca puede matchear más de
--     una fila por usuario, pero se escribe con `exists` (no `count(*) = 1`)
--     de todas formas, por si esa cardinalidad cambiara en el futuro (N:M) —
--     el chequeo semántico correcto es siempre "¿existe ALGUNA membresía en
--     otro tenant?", no "¿hay exactamente una?".
--   - `security definer` + `set search_path = ''` (mismo patrón que
--     `private.current_tenant_id()`/`is_admin()`/`is_super_admin()`,
--     20260713090000/20260714201000): necesita leer `usuarios`/
--     `usuarios_tenants` de CUALQUIER tenant, algo que el propio `authenticated`
--     que la invoca no podría hacer por sí mismo bajo su propia RLS. El gate de
--     rol de arriba es la ÚNICA puerta: sin él, esta función sería un bypass
--     de RLS regalado a cualquier `authenticated`, sin importar su rol.
--   - Revokes explícitos de `public` Y de `anon` (aprendizaje 2026-07-13: el
--     `revoke ... from public` de Supabase NO alcanza a `anon` — los default
--     privileges le dan EXECUTE directo a cada función nueva); grant solo a
--     `authenticated` (el gate real es el chequeo interno de rol, no el grant
--     — un Operador autenticado SÍ puede EJECUTAR la función, pero siempre
--     recibe `false`).
--
-- EDGE CASES (los 4 del encargo + 1 propio, todos con test pgTAP):
--   (a) correo con membresía en el TENANT ACTUAL del llamador -> FALSE (ese
--       caso lo maneja la app como "ya es miembro de este courier", no es
--       "pertenece a otro courier" — lo resuelve solo el `is distinct from`).
--   (b) correo existente en `usuarios` SIN ninguna fila en `usuarios_tenants`
--       (ej. una cuenta Super-Admin de plataforma, que por diseño no es
--       miembro de ningún tenant — comentario de `public.super_admins`,
--       20260713090200) -> FALSE (el `join` no encuentra nada que evaluar).
--   (c) correo que no existe en `usuarios` -> FALSE (mismo camino: el `join`
--       no encuentra ninguna fila).
--   (d) llamador Super-Admin en modo soporte (con selección activa en
--       `super_admin_tenant_activo`, 20260714220000/221000) -> `is_admin()`
--       ya es true (cubre este caso) y `current_tenant_id()` resuelve al
--       tenant SELECCIONADO (no NULL): el chequeo funciona exactamente igual
--       que para un Admin real de ese tenant.
--   (e, propio) anti-enumeración: un Operador/Contador (rol≠admin, no
--       Super-Admin) consultando el correo de un usuario que SÍ pertenece a
--       otro tenant real -> FALSE igual (el gate de rol corta antes de
--       siquiera mirar `usuarios_tenants`).
--
-- CÓMO VALIDAR (con el MCP, después de aplicar):
--   - `has_function_privilege('anon', 'public.correo_pertenece_a_otro_tenant(text)', 'execute')`
--     -> false. Mismo chequeo para `public` (rol) -> false.
--     `has_function_privilege('authenticated', ...)` -> true (el gate real es
--     interno, no el grant).
--   - Como Admin real del tenant A: `select
--     public.correo_pertenece_a_otro_tenant('<correo de un miembro de B>')` ->
--     true; con el correo de un miembro de A (su propio tenant) -> false; con
--     un correo inexistente -> false.
--   - Como Operador de A (no admin): mismas consultas que arriba -> siempre
--     false, incluso para el correo que SÍ pertenece a B (anti-enumeración).
--   - Como Super-Admin con selección activa en A: mismo resultado que "Admin
--     real del tenant A". Como Super-Admin SIN selección: sigue pasando el
--     gate (is_super_admin() true) pero `current_tenant_id()` es NULL — el
--     chequeo sigue siendo válido (cualquier membresía real cuenta como
--     "otro tenant" relativo a NULL).
--   - Correr la suite pgTAP
--     supabase/tests/database/20260717_correo_pertenece_a_otro_tenant.test.sql.
--
-- PLAN DE REVERSIÓN (pensado, no ejecutado automáticamente):
--   drop function if exists public.correo_pertenece_a_otro_tenant(text);
--   -- Ningún otro objeto depende de esta función (no se referencia desde
--   -- ninguna política RLS ni desde ningún otro trigger/función del esquema).
-- =============================================================================

create or replace function public.correo_pertenece_a_otro_tenant(p_correo text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_correo         text;
  v_tenant_actual  uuid;
  v_pertenece      boolean;
begin
  -- Gate de anti-enumeración: ver nota de diseño arriba (false, nunca raise).
  if not (
    (select private.is_admin())
    or (select private.is_super_admin())
  ) then
    return false;
  end if;

  v_correo := lower(btrim(p_correo));
  if v_correo is null or v_correo = '' then
    return false;
  end if;

  v_tenant_actual := (select private.current_tenant_id());

  select exists (
    select 1
    from public.usuarios u
    join public.usuarios_tenants ut on ut.usuario_id = u.id
    where lower(btrim(u.email)) = v_correo
      and ut.tenant_id is distinct from v_tenant_actual
  ) into v_pertenece;

  return v_pertenece;
end;
$fn$;

comment on function public.correo_pertenece_a_otro_tenant(text) is
  'true si `p_correo` (normalizado lower/btrim) pertenece a un usuario con '
  'membresía ACTIVA-o-no en usuarios_tenants cuyo tenant_id sea DISTINTO del '
  'tenant actual del llamador (private.current_tenant_id()). Devuelve SOLO el '
  'booleano, jamás qué tenant ni ningún otro dato de la membresía ajena. '
  'Anti-enumeración: si el llamador no es private.is_admin() (Admin real, o '
  'Super-Admin en modo soporte) ni private.is_super_admin() (Super-Admin sin '
  'selección), devuelve false de inmediato — nunca una excepción, para no dar '
  'una señal distinta entre "sin permiso" y "no pertenece a otro tenant". '
  'Uso: bloquear la creación de una invitación (regla dura #2, un usuario = un '
  'tenant) cuando el correo invitado ya es miembro de OTRO courier.';

revoke all on function public.correo_pertenece_a_otro_tenant(text) from public;
revoke execute on function public.correo_pertenece_a_otro_tenant(text) from anon;
grant execute on function public.correo_pertenece_a_otro_tenant(text) to authenticated;
