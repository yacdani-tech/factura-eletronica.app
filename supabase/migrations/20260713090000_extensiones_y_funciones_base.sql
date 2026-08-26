-- =============================================================================
-- Migración: extensiones y funciones base (helpers de tenant + RLS + integridad)
-- -----------------------------------------------------------------------------
-- IMPACTO: No toca datos (proyecto nuevo). Crea:
--   - esquema `private` (funciones internas, NO expuestas por PostgREST/API).
--   - extensiones: pgcrypto (gen_random_uuid), pg_trgm (preparación para el
--     matching difuso de ingesta-matching, fase posterior; no se usa aún).
--   - private.current_tenant_id(): resuelve el tenant del usuario autenticado
--     leyendo la membresía real en usuarios_tenants a partir de auth.uid().
--     NUNCA confía en un tenant_id enviado por el cliente ni en un claim JWT
--     custom (evita claims desincronizados tras cambios de rol/membresía).
--   - private.is_super_admin(): true si el usuario autenticado es Super-Admin
--     de plataforma (tabla super_admins, creada en la siguiente migración;
--     la función se crea aquí y se usa desde ahí en adelante).
--   - public.verificar_tenant_padre(): trigger genérico de integridad que
--     impide que una fila referencie (por FK) una fila padre de OTRO tenant
--     (ej. un paquete apuntando a una ruta de otro courier). Es un guardia de
--     integridad referencial multi-tenant, no lógica de negocio: no decide
--     nada de dominio, solo compara tenant_id de la fila hija contra el
--     tenant_id de la fila padre referenciada.
--   - public.bloquear_mutacion_append_only(): trigger genérico reutilizable
--     para tablas 100% append-only (documento_lineas, log_envios): rechaza
--     CUALQUIER UPDATE/DELETE, sin excepción.
--
-- CORRECCIÓN DE RONDA DE REVISIÓN (revisor interno + QA externo, mismo día):
-- `private.current_tenant_id()` y `private.is_super_admin()` estaban en
-- `language sql`, referenciando `public.usuarios_tenants` / `public.super_admins`
-- — tablas que no existen todavía en ESTA migración (se crean en
-- `20260713090200`). A diferencia de PL/pgSQL (que compila el cuerpo de forma
-- perezosa, en la primera invocación), Postgres analiza y resuelve contra el
-- catálogo el cuerpo de una función `language sql` en el momento del propio
-- `CREATE FUNCTION` — con las tablas aún inexistentes, un `supabase db reset`
-- desde cero fallaba en esta migración. Fix: ambas pasan a `language plpgsql`
-- (mismo comportamiento, cuerpo envuelto en `declare/begin/return`), igual
-- que ya era el caso de `verificar_tenant_padre()`. No hay más funciones
-- `language sql` en el resto de las migraciones (grep verificado).
-- ES DESTRUCTIVA: no. Es la primera migración del proyecto (repo vacío).
-- CÓMO VALIDAR: no hay tenants existentes que romper (greenfield). Verificar
--   con el MCP (list_tables / list_extensions) que las extensiones y el
--   esquema `private` quedaron creados; que current_tenant_id()/is_super_admin()
--   son `language plpgsql security definer` con search_path fijo (necesitan
--   leer membresías sin quedar ellas mismas bloqueadas por RLS); y que
--   verificar_tenant_padre()/bloquear_mutacion_append_only() son a propósito
--   SECURITY INVOKER (ver comentario en cada definición) — todas con
--   search_path fijo para mitigar hijacking de search_path. Confirmar
--   además, con un `supabase db reset` real, que esta migración ya no falla
--   por orden de dependencias (era el bug bloqueante de esta ronda).
-- PLAN DE REVERSIÓN (pensado, no ejecutado automáticamente):
--   drop function if exists public.bloquear_mutacion_append_only();
--   drop function if exists public.verificar_tenant_padre();
--   drop function if exists private.is_super_admin();
--   drop function if exists private.current_tenant_id();
--   drop schema if exists private;
--   -- (no se deshabilitan pgcrypto/pg_trgm: pueden ser usadas por Supabase Auth
--   --  u otras piezas; su drop no es seguro de automatizar).
-- =============================================================================

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

-- Esquema para funciones internas que NO deben quedar expuestas en la API
-- pública de PostgREST (Supabase solo expone `public` y los esquemas listados
-- explícitamente en la config de la API; `private` se deja fuera a propósito).
create schema if not exists private;

-- Nadie fuera del propio Postgres necesita ejecutar cosas en `private`
-- directamente; las funciones de este esquema se usan SOLO desde políticas
-- RLS o desde otras funciones. Se revoca uso por defecto y se otorga caso por
-- caso más abajo.
--
-- CONTRATO EXPLÍCITO DE EJECUCIÓN (quién puede correr qué):
--   - `authenticated`: USAGE sobre `private` + EXECUTE sobre
--     current_tenant_id() e is_super_admin() (las necesita para sus propias
--     políticas RLS, todas evaluadas como usuario logueado).
--   - `anon`: NADA en `private`. anon nunca tiene membresía ni tenant propio,
--     así que ninguna política que aplique a `anon` puede depender de
--     current_tenant_id()/is_super_admin() (ver catálogos globales: sus
--     políticas de lectura pública usan `using (true)`, nunca estas
--     funciones). Si una tarea futura necesita resolver un tenant desde
--     `anon` (ej. `/registro` por subdominio), NO debe reutilizar
--     current_tenant_id() (que depende de auth.uid(), inexistente para
--     anon) — necesita su propia función explícita y su propio análisis de
--     seguridad, no una ampliación de este grant.
revoke all on schema private from public;
grant usage on schema private to authenticated;

-- -----------------------------------------------------------------------------
-- private.current_tenant_id()
-- -----------------------------------------------------------------------------
-- Contrato (leer también supabase/README.md): resuelve el tenant_id del
-- usuario autenticado ÚNICAMENTE a partir de su membresía real en
-- usuarios_tenants, usando auth.uid() (el `sub` verificado del JWT de
-- Supabase Auth). La app JAMÁS debe pasar un tenant_id propio para que las
-- políticas RLS lo usen: esta función es la única fuente de verdad para "a
-- qué tenant pertenece este usuario" a nivel de base de datos.
--
-- El subdominio (ej. `acme.factura-eletronica.app`) es SOLO una señal de enrutamiento
-- de la app (qué courier mostrar); la app debe verificar en su propia capa
-- (middleware/server) que el tenant del usuario autenticado coincide con el
-- subdominio visitado, y negar la vista si no coincide. RLS no depende de
-- esa verificación de la app: aunque la app tuviera un bug de enrutamiento,
-- RLS sigue devolviendo solo las filas del tenant real del usuario.
--
-- Un usuario pertenece a un solo tenant en el MVP (usuarios_tenants es 1:1
-- por PK en usuario_id), por lo que esta función siempre devuelve como mucho
-- un tenant_id.
-- `language plpgsql` a propósito (no `language sql`): PL/pgSQL compila el
-- cuerpo de forma perezosa (en la primera invocación real), así que puede
-- referenciar `public.usuarios_tenants` aunque esa tabla todavía no exista
-- en el momento de este CREATE FUNCTION (se crea en la migración
-- `20260713090200`, más adelante en el mismo `db reset`). Con `language sql`
-- Postgres intenta resolver el cuerpo contra el catálogo YA en el CREATE
-- FUNCTION y esta migración fallaría — bug real detectado en revisión.
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
  select ut.tenant_id into v_tenant_id
  from public.usuarios_tenants ut
  where ut.usuario_id = (select auth.uid())
    and ut.estado = 'activo'
  limit 1;

  return v_tenant_id;
end;
$$;

comment on function private.current_tenant_id() is
  'Resuelve el tenant_id del usuario autenticado (auth.uid()) vía su membresía '
  'real en usuarios_tenants. Fuente única de verdad para RLS; nunca confiar en '
  'tenant_id proveniente del cliente.';

revoke all on function private.current_tenant_id() from public;
grant execute on function private.current_tenant_id() to authenticated;

-- -----------------------------------------------------------------------------
-- private.is_super_admin()
-- -----------------------------------------------------------------------------
-- true si el usuario autenticado es Super-Admin de plataforma (equipo de Plataforma.app).
-- La tabla super_admins se crea en la migración siguiente (`20260713090200`);
-- esta función se define ya (se referencia desde políticas de catálogos
-- globales de esa misma migración en adelante) calificando la tabla por su
-- nombre completo. `language plpgsql` a propósito (ver comentario extenso en
-- current_tenant_id() arriba): compila el cuerpo de forma perezosa, así que
-- puede referenciar una tabla que todavía no existe en este CREATE FUNCTION,
-- siempre que exista antes de la primera EJECUCIÓN real de la función.
create or replace function private.is_super_admin()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_es_super_admin boolean;
begin
  select exists (
    select 1
    from public.super_admins sa
    where sa.usuario_id = (select auth.uid())
  ) into v_es_super_admin;

  return v_es_super_admin;
end;
$$;

comment on function private.is_super_admin() is
  'true si auth.uid() está registrado en super_admins (rol de plataforma de Plataforma.app).';

revoke all on function private.is_super_admin() from public;
grant execute on function private.is_super_admin() to authenticated;

-- -----------------------------------------------------------------------------
-- public.verificar_tenant_padre()
-- -----------------------------------------------------------------------------
-- Trigger genérico BEFORE INSERT OR UPDATE. Se instala con 2 o 3 argumentos
-- (columna_fk, tabla_padre[, columna_id_padre]), ej.:
--   create trigger trg_zonas_tenant_padre before insert or update on zonas
--     for each row execute function public.verificar_tenant_padre('ruta_id', 'rutas');
--   -- tabla_padre sin PK literal `id` (ej. usuarios_tenants, PK = usuario_id):
--   create trigger trg_documentos_creado_por_tenant_padre before insert or update on documentos
--     for each row execute function public.verificar_tenant_padre('creado_por', 'usuarios_tenants', 'usuario_id');
--
-- El 3er argumento (columna_id_padre) es OPCIONAL y por defecto es 'id'
-- (TG_ARGV fuera de rango devuelve NULL, y COALESCE lo resuelve a 'id') —
-- retrocompatible con todos los usos existentes de 2 argumentos.
--
-- Verifica que NEW.tenant_id coincida con el tenant_id de la fila referenciada
-- por NEW.<columna_fk> en <tabla_padre>. Si la FK es NULL (referencia
-- opcional no seteada), no valida nada. Esto cierra un vector de fuga entre
-- tenants que RLS por sí sola NO cubre: un usuario autenticado del tenant A
-- solo puede escribir filas con tenant_id = A (por el `with check` de las
-- políticas de INSERT/UPDATE), pero una FK corriente (`references rutas(id)`)
-- solo exige que exista ALGUNA fila con ese id, sin importar de qué tenant es
-- — si alguien adivinara/filtrara el UUID de una ruta de OTRO tenant, podría
-- enlazarla igual. Este trigger es un guardia de integridad referencial
-- (compara tenant_id de dos filas), no una decisión de negocio.
--
-- A propósito SIN `security definer`: corre con los privilegios de quien
-- dispara el trigger (el usuario autenticado), así que la consulta al padre
-- (`select tenant_id from <tabla_padre> where <columna_id_padre> = ...`)
-- queda sujeta a la MISMA RLS que ya protege esa tabla. Para una referencia
-- LEGÍTIMA (misma tenant), la política de SELECT de la tabla padre ya deja
-- ver esa fila al usuario (es de su propio tenant), así que la subconsulta
-- devuelve el tenant_id real y el INSERT/UPDATE pasa sin problema — esto
-- está cubierto explícitamente por pruebas pgTAP de inserciones VÁLIDAS
-- (zonas/subclientes/paquetes/documentos como usuario del tenant, no solo
-- los intentos de fuga) en supabase/tests/database/, precisamente para
-- demostrar que este diseño no bloquea escrituras legítimas. Si el padre
-- referenciado es de OTRO tenant, RLS ya lo hace invisible (la subconsulta
-- no devuelve fila) y v_tenant_padre queda NULL, lo que el IS DISTINCT FROM
-- de abajo trata como mismatch igual — protege sin necesitar privilegios
-- elevados (principio de mínimo privilegio).
create or replace function public.verificar_tenant_padre()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_columna_fk text := TG_ARGV[0];
  v_tabla_padre text := TG_ARGV[1];
  v_columna_id_padre text := coalesce(TG_ARGV[2], 'id');
  v_tenant_fila_nueva uuid;
  v_valor_fk uuid;
  v_tenant_padre uuid;
begin
  -- NEW.tenant_id se puede leer directamente: aunque esta función es
  -- genérica (NEW es de tipo `record`, polimórfico), el acceso por nombre de
  -- campo se resuelve en tiempo de ejecución contra el tipo real de la fila,
  -- y la regla dura #1 garantiza que TODA tabla que use este trigger tiene
  -- una columna tenant_id. Solo el nombre de la columna FK varía según la
  -- tabla (viene por TG_ARGV), por eso ESA sí necesita SQL dinámico.
  v_tenant_fila_nueva := NEW.tenant_id;

  execute format('select ($1).%I', v_columna_fk) into v_valor_fk using NEW;

  if v_valor_fk is null then
    return NEW;
  end if;

  execute format('select tenant_id from public.%I where %I = $1', v_tabla_padre, v_columna_id_padre)
    into v_tenant_padre
    using v_valor_fk;

  if v_tenant_padre is distinct from v_tenant_fila_nueva then
    raise exception
      'Aislamiento multi-tenant violado: %.% = % pertenece a un tenant distinto del de la fila (tenant_id = %)',
      v_tabla_padre, v_columna_fk, v_valor_fk, v_tenant_fila_nueva;
  end if;

  return NEW;
end;
$$;

comment on function public.verificar_tenant_padre() is
  'Trigger genérico: valida que NEW.tenant_id coincida con el tenant_id de la '
  'fila padre referenciada (argumentos: columna_fk, tabla_padre[, columna_id_padre '
  '(default id)]). Guardia de integridad referencial multi-tenant, reutilizado '
  'por varias tablas.';

-- -----------------------------------------------------------------------------
-- public.bloquear_mutacion_append_only()
-- -----------------------------------------------------------------------------
-- Trigger genérico BEFORE UPDATE OR DELETE para tablas 100% append-only
-- (documento_lineas, log_envios): rechaza CUALQUIER UPDATE o DELETE, sin
-- excepción — se escriben una sola vez al emitir/registrar y nunca se tocan
-- (ni siquiera si el documento padre termina anulado: una corrección crea
-- líneas/logs NUEVOS en el documento de reemplazo, jamás edita los del
-- documento anulado).
--
-- Defensa en profundidad: hoy estas tablas ya no tienen política de UPDATE
-- ni DELETE (RLS las deniega por ausencia de política), pero si una política
-- futura más amplia (ej. un "for all" agregado sin cuidado) las habilitara
-- por error, este trigger sigue bloqueando la mutación a nivel de tabla,
-- sin depender de que RLS se mantenga correcta para siempre.
--
-- Consecuencia a propósito: como documento_lineas/log_envios tienen
-- `documento_id on delete cascade` y documentos tiene `tenant_id on delete
-- cascade`, un intento de `DELETE FROM tenants` (operación excepcional,
-- nunca expuesta por RLS — tenants no tiene policy de DELETE) para un
-- courier que ya emitió al menos un documento hará que Postgres intente
-- borrar en cascada sus documento_lineas/log_envios, y ESTE trigger
-- abortará esa transacción. Es intencional: ningún borrado físico, ni
-- siquiera el de un tenant completo por soporte, debe poder destruir
-- evidencia de facturación en silencio.
create or replace function public.bloquear_mutacion_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception
    'La tabla %.% es append-only: no se permite UPDATE ni DELETE (fila id = %)',
    TG_TABLE_SCHEMA, TG_TABLE_NAME, OLD.id;
end;
$$;

comment on function public.bloquear_mutacion_append_only() is
  'Trigger genérico: rechaza todo UPDATE/DELETE sobre la tabla donde se '
  'instale. Defensa en profundidad para tablas append-only (documento_lineas, '
  'log_envios), además de la ausencia de política RLS de UPDATE/DELETE.';

-- -----------------------------------------------------------------------------
-- public.actualizar_actualizado_en()
-- -----------------------------------------------------------------------------
-- Trigger genérico BEFORE UPDATE que mantiene una columna `actualizado_en`
-- (timestamptz) en `now()` en cada UPDATE. Evita depender de la extensión
-- contrib `moddatetime` (cuya ubicación de esquema puede variar entre
-- proyectos Supabase) y evita que cada tabla reimplemente el mismo trigger.
create or replace function public.actualizar_actualizado_en()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  NEW.actualizado_en := now();
  return NEW;
end;
$$;

comment on function public.actualizar_actualizado_en() is
  'Trigger genérico: setea NEW.actualizado_en = now() en cada UPDATE.';
