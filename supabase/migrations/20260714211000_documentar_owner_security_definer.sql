-- =============================================================================
-- Migración: documentar el owner esperado de los triggers SECURITY DEFINER
-- de sincronización auth.users -> public.usuarios (solo comentarios)
-- -----------------------------------------------------------------------------
-- IMPACTO: SOLO metadata (`comment on function`) de
-- public.manejar_nuevo_usuario_auth() y public.sincronizar_email_usuario_auth()
-- (creadas en 20260714203000, ya aplicada a la BD remota — no se edita ese
-- archivo). Cero cambios de comportamiento/esquema/permisos/triggers.
-- ES DESTRUCTIVA: no.
--
-- POR QUÉ: addendum de la ronda de QA externa del 2026-07-14 sobre la tarea
-- 1.2 (Auth y usuarios). La mayoría de los reclamos del QA fueron
-- descartados por ser falsos positivos verificados contra el código real
-- (documentado por Yac en el cierre de fase), pero se pidió agregar, como
-- documentación defensiva BARATA para entornos futuros, una línea explícita
-- en el comentario de cada función SECURITY DEFINER nueva indicando el owner
-- esperado (el rol que corre las migraciones en Supabase, típicamente
-- `postgres`, con atributo BYPASSRLS) — ya se agregó la misma línea en
-- `public.aceptar_invitacion()` dentro de 20260714210000 (esa función SÍ se
-- estaba corrigiendo por un bug real, así que el comentario nuevo fue parte
-- del mismo `create or replace`). Estas dos funciones de sincronización NO
-- tienen ningún bug pendiente — por eso esta migración es exclusivamente de
-- comentarios, para no re-tocar lógica que ya se validó contra la BD remota.
--
-- CÓMO VALIDAR (con el MCP, después de aplicar):
--   - `select obj_description('public.manejar_nuevo_usuario_auth()'::regprocedure)`
--     y el equivalente para `sincronizar_email_usuario_auth` deben incluir la
--     frase sobre el owner esperado.
--   - Los triggers `trg_auth_users_crear_usuario` / `trg_auth_users_sincronizar_email`
--     y el comportamiento observable de ambas funciones no cambian: correr de
--     nuevo la suite pgTAP
--     supabase/tests/database/20260714_auth_roles_y_rls_admin.test.sql
--     (sección "Sincronización auth.users -> public.usuarios") debe dar el
--     mismo resultado que antes de esta migración.
--
-- PLAN DE REVERSIÓN (pensado, no ejecutado automáticamente): re-aplicar los
-- comentarios tal como quedaron en 20260714203000 (comment on function, sin
-- la línea de owner).
-- =============================================================================

comment on function public.manejar_nuevo_usuario_auth() is
  'Trigger AFTER INSERT en auth.users: crea la fila espejo en public.usuarios '
  '(id, email, nombre desde raw_user_meta_data: nombre > full_name > name). '
  'ON CONFLICT (id) DO NOTHING: si la app ya insertó la fila ella misma '
  '(carrera con este trigger), no la duplica ni pisa el nombre existente. '
  'SECURITY DEFINER: corre en la misma transacción del signup de Supabase '
  'Auth, antes de que exista una sesión authenticated utilizable. Owner '
  'esperado: el rol que ejecuta las migraciones en el proyecto Supabase '
  '(típicamente `postgres`), con atributo BYPASSRLS — documentado como '
  'referencia defensiva para entornos futuros (ya probado contra la BD '
  'remota real con ese owner); no implica ningún cambio de comportamiento.';

comment on function public.sincronizar_email_usuario_auth() is
  'Trigger AFTER UPDATE OF email en auth.users: sincroniza public.usuarios.email '
  'al nuevo valor. Autoriza el cambio ante trg_usuarios_proteger_email vía la '
  'GUC transaccional app.sincronizando_email_auth (con el id exacto del '
  'usuario, seteada solo alrededor de este UPDATE) — necesario porque, al ser '
  'SECURITY DEFINER, current_user durante su ejecución es el dueño de la '
  'función (postgres), nunca literalmente service_role. set_config no es '
  'invocable desde PostgREST: la señal no es falsificable desde un cliente. '
  'Owner esperado: el rol que ejecuta las migraciones en el proyecto Supabase '
  '(típicamente `postgres`), con atributo BYPASSRLS — documentado como '
  'referencia defensiva para entornos futuros (ya probado contra la BD '
  'remota real con ese owner); no implica ningún cambio de comportamiento.';
