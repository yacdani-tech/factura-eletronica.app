-- =============================================================================
-- Migración: sincronización auth.users -> public.usuarios (alta + email)
-- -----------------------------------------------------------------------------
-- IMPACTO: tarea 1.2 (Auth y usuarios), parte 4 del encargo. Agrega 2
-- triggers sobre `auth.users` (AFTER INSERT, AFTER UPDATE OF email) + sus
-- funciones. Además reemplaza (create or replace) el CUERPO de
-- `public.proteger_email_usuario()` (creada en 20260713090200, NO se edita
-- el archivo de esa migración) para abrir un camino explícito y acotado que
-- permita a la sincronización legítima escribir `usuarios.email` sin
-- debilitar el guardia original. Cero cambios de columnas/tablas/políticas.
-- ES DESTRUCTIVA: no.
--
-- POR QUÉ HACE FALTA TOCAR proteger_email_usuario() (no es un bug, es una
-- consecuencia esperada, anticipada por el encargo de esta tarea):
--   `trg_usuarios_proteger_email` (BEFORE UPDATE en public.usuarios) rechaza
--   cualquier cambio de `email` salvo que `current_user = 'service_role'`.
--   El trigger de sincronización de este archivo (AFTER UPDATE OF email en
--   auth.users) es SECURITY DEFINER: durante su ejecución `current_user` es
--   el DUEÑO de la función (el rol que corrió esta migración, `postgres` en
--   Supabase), NUNCA literalmente 'service_role' — así que sin ajustar el
--   guardia, la sincronización automática quedaría bloqueada por su propio
--   guardia de protección. Fix: una señal EXPLÍCITA por GUC transaccional
--   (mismo patrón ya usado en el proyecto para
--   `anular_documento_original_al_crear_nota_credito()` /
--   `proteger_inmutabilidad_documento()`, 20260713091600 — nunca
--   `pg_trigger_depth()`, señal incidental y frágil): el trigger de
--   sincronización setea `app.sincronizando_email_auth` con el id EXACTO del
--   usuario, SOLO alrededor de su propio UPDATE; `proteger_email_usuario()`
--   permite el cambio si esa GUC coincide con `OLD.id`, además del camino ya
--   existente de `service_role`. `set_config` no es invocable desde
--   PostgREST, así que la señal no es falsificable desde un cliente.
--
-- DISEÑO (alta):
--   - `public.manejar_nuevo_usuario_auth()`: AFTER INSERT en auth.users.
--     Inserta la fila espejo (id, email, nombre). `nombre` se completa desde
--     `raw_user_meta_data`, probando en orden: 'nombre' (si el signup manual
--     de la app lo manda), 'full_name' y 'name' (claims estándar que Supabase
--     Auth recibe de Google OAuth) — el primero no nulo que exista. `ON
--     CONFLICT (id) DO NOTHING`: si la fila ya existe (la app la insertó ella
--     misma vía `usuarios_insertar_propia_fila`, en una carrera con este
--     trigger), NO se duplica ni se pisa el nombre ya guardado — pedido
--     explícito del encargo.
--   - SECURITY DEFINER, dueño con privilegios para insertar en
--     `public.usuarios` sin depender de que exista sesión `authenticated`
--     todavía (este trigger corre en la MISMA transacción del signup de
--     Supabase Auth, antes de que el cliente tenga un JWT utilizable).
--
-- DISEÑO (sincronización de email):
--   - `public.sincronizar_email_usuario_auth()`: AFTER UPDATE OF email en
--     auth.users (solo se dispara si `email` realmente cambió — la cláusula
--     `OF email` de Postgres ya lo filtra, no hace falta un IF adicional).
--     Actualiza `public.usuarios.email` al nuevo valor, protegido por la
--     señal GUC descrita arriba.
--   - `email is distinct from` en el UPDATE evita un UPDATE (y por lo tanto
--     un intento de disparar `trg_usuarios_proteger_email`) cuando el correo
--     ya estuviera sincronizado por algún otro camino.
--
-- CÓMO VALIDAR (con el MCP, después de aplicar):
--   - Insertar una fila de prueba en auth.users (id + email + raw_user_meta_data
--     con 'full_name') -> aparece automáticamente en public.usuarios con ese
--     nombre.
--   - Insertar una fila en auth.users y (en la MISMA transacción, simulando
--     la carrera) insertar manualmente la fila espejo en public.usuarios
--     ANTES de que corra el trigger -> no falla, no se duplica, el nombre
--     explícito sobrevive (ON CONFLICT DO NOTHING).
--   - `update auth.users set email = '...' where id = ...` -> el email se
--     sincroniza en public.usuarios sin que trg_usuarios_proteger_email lo
--     bloquee.
--   - Como usuario autenticado (rol authenticated, no la sincronización):
--     `update public.usuarios set email = '...'` sobre la propia fila sigue
--     fallando (el guardia original sigue vigente para el cliente).
--   - Correr la suite pgTAP
--     supabase/tests/database/20260714_auth_roles_y_rls_admin.test.sql
--     (sección sync auth.users).
--
-- PLAN DE REVERSIÓN (pensado, no ejecutado automáticamente):
--   drop trigger trg_auth_users_sincronizar_email on auth.users;
--   drop function if exists public.sincronizar_email_usuario_auth();
--   drop trigger trg_auth_users_crear_usuario on auth.users;
--   drop function if exists public.manejar_nuevo_usuario_auth();
--   -- Revertir proteger_email_usuario() a la versión de 20260713090200
--   -- (create or replace con el cuerpo original, sin el chequeo de la GUC).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Alta: auth.users -> public.usuarios (espejo)
-- -----------------------------------------------------------------------------
create or replace function public.manejar_nuevo_usuario_auth()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.usuarios (id, email, nombre)
  values (
    NEW.id,
    NEW.email,
    coalesce(
      NEW.raw_user_meta_data ->> 'nombre',
      NEW.raw_user_meta_data ->> 'full_name',
      NEW.raw_user_meta_data ->> 'name'
    )
  )
  on conflict (id) do nothing;

  return NEW;
end;
$$;

comment on function public.manejar_nuevo_usuario_auth() is
  'Trigger AFTER INSERT en auth.users: crea la fila espejo en public.usuarios '
  '(id, email, nombre desde raw_user_meta_data: nombre > full_name > name). '
  'ON CONFLICT (id) DO NOTHING: si la app ya insertó la fila ella misma '
  '(carrera con este trigger), no la duplica ni pisa el nombre existente. '
  'SECURITY DEFINER: corre en la misma transacción del signup de Supabase '
  'Auth, antes de que exista una sesión authenticated utilizable.';

create trigger trg_auth_users_crear_usuario
  after insert on auth.users
  for each row
  execute function public.manejar_nuevo_usuario_auth();

-- -----------------------------------------------------------------------------
-- Sincronización de email: auth.users -> public.usuarios
-- -----------------------------------------------------------------------------
create or replace function public.sincronizar_email_usuario_auth()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Señal explícita y acotada (mismo patrón que app.anulando_documento,
  -- 20260713091600): SOLO este usuario, SOLO alrededor de este UPDATE. Se
  -- limpia incluso si el UPDATE falla.
  perform set_config('app.sincronizando_email_auth', NEW.id::text, true);
  begin
    update public.usuarios
       set email = NEW.email
     where id = NEW.id
       and email is distinct from NEW.email;
  exception when others then
    perform set_config('app.sincronizando_email_auth', '', true);
    raise;
  end;
  perform set_config('app.sincronizando_email_auth', '', true);

  return NEW;
end;
$$;

comment on function public.sincronizar_email_usuario_auth() is
  'Trigger AFTER UPDATE OF email en auth.users: sincroniza public.usuarios.email '
  'al nuevo valor. Autoriza el cambio ante trg_usuarios_proteger_email vía la '
  'GUC transaccional app.sincronizando_email_auth (con el id exacto del '
  'usuario, seteada solo alrededor de este UPDATE) — necesario porque, al ser '
  'SECURITY DEFINER, current_user durante su ejecución es el dueño de la '
  'función (postgres), nunca literalmente service_role. set_config no es '
  'invocable desde PostgREST: la señal no es falsificable desde un cliente.';

create trigger trg_auth_users_sincronizar_email
  after update of email on auth.users
  for each row
  execute function public.sincronizar_email_usuario_auth();

-- -----------------------------------------------------------------------------
-- Ajuste del guardia existente: permitir el camino de sincronización legítima
-- -----------------------------------------------------------------------------
create or replace function public.proteger_email_usuario()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if NEW.email is distinct from OLD.email
     and current_user <> 'service_role'
     and coalesce(current_setting('app.sincronizando_email_auth', true), '') <> OLD.id::text
  then
    raise exception
      'El correo de usuarios no se puede modificar desde el cliente (usuario %). Debe sincronizarse con auth.users vía backend/service_role.',
      OLD.id;
  end if;
  return NEW;
end;
$$;

comment on function public.proteger_email_usuario() is
  'Trigger: rechaza cambios de usuarios.email salvo (a) rol activo '
  'service_role (backend de confianza), o (b) la señal explícita '
  'app.sincronizando_email_auth con el id exacto de esta fila, seteada '
  'ÚNICAMENTE por trg_auth_users_sincronizar_email (20260714203000) '
  'alrededor de su propio UPDATE legítimo. Evita que un usuario autenticado '
  'desincronice su correo de auth.users vía PostgREST, sin bloquear la '
  'sincronización automática real.';
