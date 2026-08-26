-- =============================================================================
-- Migración: public.tenant_bloqueado_propio() — vía de DETECCIÓN del bloqueo
-- del propio tenant, inmune a la circularidad que introdujo 20260815100000
-- (companion de esa migración; feature "bloquear courier expulsa y corta
-- acceso a sus usuarios" — plan completo en
-- docs/pendientes/bloquear-courier-expulsar-usuarios.md, sección 5).
-- -----------------------------------------------------------------------------
-- POR QUÉ HACE FALTA (la circularidad detectada por arquitecto-app + QA
-- externo tras aplicar 20260815100000): `obtenerUsuarioActual` (capa app)
-- lee `usuarios_tenants` (+ embed `tenants(estado)`) con el cliente de
-- SESIÓN del propio usuario, para poder DETECTAR que su tenant fue
-- bloqueado y expulsarlo. Las políticas de SELECT de `usuarios_tenants` y
-- `tenants` son `... = private.current_tenant_id() OR private.is_super_admin()`.
-- Pero 20260815100000 hizo que, para un miembro de un tenant YA bloqueado,
-- `current_tenant_id()` resuelva NULL — así que RLS le niega leer su PROPIA
-- fila de membresía y su PROPIO tenant, precisamente cuando la app necesita
-- leerlas para darse cuenta del bloqueo y cerrarle la sesión. El bloqueo de
-- datos de negocio (el objetivo real de 20260815100000) queda intacto y
-- correcto; lo que falla es la DETECCIÓN en la capa de app.
--
-- DISEÑO: una función SECURITY DEFINER (bypassa RLS, mismo mecanismo que
-- private.tenant_soporte_activo()/private.current_tenant_id()/
-- private.is_super_admin()) que responde una pregunta MUY acotada — "¿el
-- usuario autenticado es miembro ACTIVO de un tenant que está BLOQUEADO?" —
-- sin depender de current_tenant_id() en absoluto (evita la circularidad de
-- raíz, no la esquiva con un caso especial). Vive en el schema `public` (no
-- `private`, a diferencia de current_tenant_id()/is_admin()/etc.) porque la
-- app la invoca vía `supabase.rpc("tenant_bloqueado_propio")` desde el
-- cliente de sesión — PostgREST solo expone funciones de `public`.
--
-- IMPACTO: agrega 1 función nueva en `public`. CERO cambios de esquema,
-- columnas, políticas RLS o triggers de ninguna tabla, y CERO cambios en
-- 20260815100000 ni en ninguna otra función existente (current_tenant_id(),
-- is_admin(), is_super_admin(), tenant_soporte_activo() quedan intactas).
--
-- ES DESTRUCTIVA: no. Es una función nueva, pura lectura (STABLE, sin
-- efectos secundarios), invocable solo por `authenticated`.
--
-- CÓMO VALIDAR (con sesión real, no como definer directo — lo que prueba
-- que esquiva la circularidad):
--   - Miembro ACTIVO de un tenant con estado='bloqueado': la función
--     devuelve true, AUNQUE ese mismo miembro no pueda ver su propia fila
--     de usuarios_tenants ni su tenant vía SELECT directo (RLS se lo niega
--     por current_tenant_id() NULL) — la función sí puede, por ser
--     SECURITY DEFINER.
--   - Miembro ACTIVO de un tenant con estado='activo': false.
--   - Super-Admin de plataforma sin membresía real en ningún tenant: false
--     (no hay fila en usuarios_tenants para su usuario_id; la capa app de
--     todos modos lo protege adicionalmente con !esSuperAdmin, ver plan).
--   - anon: sin EXECUTE (permission denied, 42501) — revocado explícito.
--
-- PLAN DE REVERSIÓN (pensado, no ejecutado automáticamente):
--   drop function if exists public.tenant_bloqueado_propio();
-- =============================================================================

create or replace function public.tenant_bloqueado_propio()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_bloqueado boolean;
begin
  select true into v_bloqueado
  from public.usuarios_tenants ut
  join public.tenants t on t.id = ut.tenant_id
  where ut.usuario_id = (select auth.uid())
    and ut.estado = 'activo'
    and t.estado = 'bloqueado'
  limit 1;

  return coalesce(v_bloqueado, false);
end;
$fn$;

comment on function public.tenant_bloqueado_propio() is
  'Vía de DETECCIÓN (no de autorización de datos) del bloqueo del propio '
  'tenant, para que obtenerUsuarioActual (capa app) pueda expulsar a un '
  'usuario ya logueado cuyo tenant fue bloqueado. SECURITY DEFINER a '
  'propósito: bypassa RLS para esquivar la circularidad introducida por '
  '20260815100000 (para un miembro de un tenant bloqueado, '
  'private.current_tenant_id() resuelve NULL, lo que le niega vía RLS leer '
  'su propia fila de usuarios_tenants/tenants — exactamente lo que esta '
  'función necesita leer para detectar el bloqueo). Devuelve true SOLO si '
  'el usuario autenticado (auth.uid()) es miembro ACTIVO (usuarios_tenants. '
  'estado=''activo'') de un tenant con tenants.estado=''bloqueado''; false '
  'en cualquier otro caso, incluido un Super-Admin de plataforma sin '
  'membresía real en usuarios_tenants (la capa app además lo protege con '
  '!esSuperAdmin). No usar para autorizar acceso a datos de negocio — esa '
  'garantía sigue siendo current_tenant_id()/RLS, sin cambios.';

revoke all on function public.tenant_bloqueado_propio() from public;
revoke execute on function public.tenant_bloqueado_propio() from anon;
grant execute on function public.tenant_bloqueado_propio() to authenticated;
