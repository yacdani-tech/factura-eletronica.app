-- =============================================================================
-- Migración: revocar EXECUTE de las funciones de trigger de sincronización
-- auth.users -> public.usuarios (hallazgo de advisors tras aplicar 20260714203000)
-- -----------------------------------------------------------------------------
-- IMPACTO: solo permisos (revoke) sobre public.manejar_nuevo_usuario_auth() y
-- public.sincronizar_email_usuario_auth(). Cero cambios de esquema/lógica.
-- ES DESTRUCTIVA: no.
--
-- POR QUÉ: el advisor de seguridad de Supabase (get_advisors, corrido en el
-- pase de validación de la tarea 1.2 el 2026-07-14) marcó ambas funciones
-- como "SECURITY DEFINER ejecutable por anon/authenticated vía
-- /rest/v1/rpc/...". En la práctica NO son explotables: devuelven `trigger`,
-- y Postgres rechaza ejecutar funciones de trigger fuera de un contexto de
-- trigger ("trigger functions can only be called as triggers") — pero el
-- criterio del proyecto (ver 20260713090800_fix_advisors_seguridad y el
-- aprendizaje 2026-07-13: el revoke de PUBLIC no alcanza a anon en Supabase,
-- que recibe EXECUTE por default privileges) es dejar el advisor en limpio
-- con revokes explícitos, no depender de la inejecutabilidad incidental.
-- Un trigger NO necesita que el rol que dispara la sentencia tenga EXECUTE
-- sobre su función: el permiso se chequea contra el DUEÑO del trigger al
-- crearlo, así que este revoke no rompe la sincronización real.
--
-- CÓMO VALIDAR (con el MCP, después de aplicar):
--   - get_advisors(security): desaparecen las 3 advertencias
--     anon_/authenticated_security_definer_function_executable sobre estas
--     dos funciones (la de aceptar_invitacion/authenticated permanece: esa
--     función SÍ es una RPC intencional para usuarios logueados).
--   - Re-correr la suite pgTAP
--     supabase/tests/database/20260714_auth_roles_y_rls_admin.test.sql:
--     la sección "Sincronización auth.users -> public.usuarios" debe seguir
--     pasando igual (los triggers no dependen del EXECUTE del invocador).
--
-- PLAN DE REVERSIÓN (pensado, no ejecutado automáticamente):
--   grant execute on function public.manejar_nuevo_usuario_auth() to authenticated, anon;
--   grant execute on function public.sincronizar_email_usuario_auth() to authenticated, anon;
--   -- (no recomendado: reintroduce el hallazgo del advisor sin ganar nada.)
-- =============================================================================

revoke all on function public.manejar_nuevo_usuario_auth() from public;
revoke execute on function public.manejar_nuevo_usuario_auth() from anon;
revoke execute on function public.manejar_nuevo_usuario_auth() from authenticated;

revoke all on function public.sincronizar_email_usuario_auth() from public;
revoke execute on function public.sincronizar_email_usuario_auth() from anon;
revoke execute on function public.sincronizar_email_usuario_auth() from authenticated;
