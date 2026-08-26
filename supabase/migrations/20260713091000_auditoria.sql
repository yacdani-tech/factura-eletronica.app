-- =============================================================================
-- Migración: sistema de auditoría (tabla append-only + trigger genérico)
-- -----------------------------------------------------------------------------
-- IMPACTO: crea la tabla `auditoria` (nueva, sin dependientes existentes) y
-- un trigger GENÉRICO reutilizable (`public.registrar_auditoria()`) que se
-- instala en `paquetes`, `documentos` y `subclientes` (AFTER INSERT/UPDATE/
-- DELETE FOR EACH ROW). No cambia ninguna columna ni comportamiento de esas
-- 3 tablas más allá de agregarles ese trigger AFTER (observa, no decide: si
-- otro trigger BEFORE aborta la operación, nunca llegamos a auditar algo que
-- no pasó de verdad). Decisión explícita de Yac (2026-07-13), R1-R2 del
-- pedido de "sistema de auditoría".
--
-- DISEÑO (decisiones + porqué):
--   - `actor_tipo` ('usuario'|'sistema') NOT NULL, con CHECK de coherencia
--     ESTRICTA contra `actor_id`: 'usuario' <=> actor_id NOT NULL, 'sistema'
--     <=> actor_id IS NULL. auth.uid() NULL (cron/backend de confianza) NUNCA
--     se guarda como "actor_id NULL sin explicación": queda explícito que fue
--     el sistema, nunca un vacío ambiguo (pedido explícito de R2).
--   - `actor_id` con FK `on delete restrict` (no `set null`/`cascade`) hacia
--     `usuarios`: evita que borrar una fila de `usuarios` reescriba en
--     silencio (vía acción referencial) una fila de auditoría YA INSERTADA
--     —violaría el propio append-only de este sistema— y de paso preserva el
--     invariante actor_tipo='usuario' ⟺ actor_id NOT NULL sin tener que
--     re-validar el CHECK en cascada. Efecto secundario aceptado: no se
--     puede borrar físicamente un usuario que ya generó auditoría (mismo
--     principio que ya rige `documentos.subcliente_id`/`consolidado_id`).
--   - `origen` se lee de la GUC de sesión `app.origen` (las server actions
--     deben `set local app.origen = 'ui'|'import_excel'|'api'|'cron'` al
--     abrir su transacción); default 'api' si la GUC no está seteada o trae
--     un valor no reconocido — parseo defensivo: una GUC corrupta NUNCA debe
--     abortar la operación de negocio real que disparó el trigger AFTER.
--   - `cambios` se calcula comparando la UNIÓN de claves de to_jsonb(OLD) vs
--     to_jsonb(NEW) (mismo código cubre INSERT —antes=null— y DELETE
--     —despues=null— además de UPDATE), EXCLUYENDO `actualizado_en` a
--     propósito: esa columna la pisa siempre
--     `public.actualizar_actualizado_en()` (trigger BEFORE UPDATE ya
--     existente en paquetes/documentos/subclientes) en CUALQUIER UPDATE,
--     incluso uno que no cambia ningún dato real — sin excluirla, JAMÁS
--     habría un diff "vacío" y la regla de R2 ("UPDATE sin cambios reales no
--     genera fila") quedaría rota de raíz.
--   - El trigger es AFTER (no BEFORE): solo se audita una mutación que
--     efectivamente sucedió.
--   - `registrar_auditoria()` es SECURITY DEFINER a propósito (pedido
--     explícito de R2): la escritura del log NUNCA debe depender de que el
--     rol que disparó la mutación (`authenticated`) tenga, en ese instante,
--     una relación RLS coincidente con la fila de auditoría a insertar — son
--     preocupaciones distintas (RLS de `paquetes`/`documentos`/
--     `subclientes` gobierna si ESE usuario puede mutar ESA fila de negocio;
--     la escritura del propio log de auditoría no debe poder fallar por una
--     policy de OTRA tabla). Con esto, la política de INSERT de `auditoria`
--     (más abajo) deja de ser estrictamente necesaria PARA EL TRIGGER (la
--     bypassea al ser SECURITY DEFINER), pero se conserva igual por R1
--     ("INSERT permitido con with check de tenant propio") y por dos razones
--     prácticas: (a) portabilidad — en un Postgres sin las garantías del rol
--     `postgres` con BYPASSRLS que sí tiene el proyecto Supabase real (ver
--     aprendizaje 2026-07-13 de arquitecto-db), y (b) deja abierta la puerta
--     a que una server action inserte a mano un evento de auditoría puntual
--     que no sale del trigger genérico (ej. una corrección manual de soporte
--     sobre una fila concreta, documentada aparte del diff automático).
--   - UPDATE/DELETE de `auditoria`: DOBLE CAPA, mismo patrón que
--     `documento_lineas`/`log_envios` (20260713090500) — sin política RLS de
--     UPDATE/DELETE (deny-by-default) + trigger
--     `public.bloquear_mutacion_append_only()` (genérico, ya existe) como
--     defensa en profundidad. Ningún rol, ni siquiera un Admin del propio
--     tenant, puede editar o borrar un registro de auditoría.
--   - `registro_id` es `uuid` SIN FK real: es una referencia HETEROGÉNEA (a
--     paquetes, documentos, subclientes, y a futuro tarifas...) que no puede
--     modelarse como una sola FK. La integridad de "esa fila existió" queda
--     garantizada por construcción: el propio trigger la escribe con el id
--     real de la fila que está mutando en simultáneo.
--   - `tabla` es `text` libre (no un enum ni un CHECK de nombres conocidos):
--     el trigger genérico siempre la llena con TG_TABLE_NAME (valor de
--     sistema, nunca arbitrario), y un futuro INSERT manual (ver punto
--     anterior) puede necesitar un valor que hoy no existe como tabla real.
--   - Se REUSA `public.bloquear_mutacion_append_only()` (no se crean
--     funciones nuevas para el append-only).
-- ES DESTRUCTIVA: no. Tabla nueva sin filas que migrar; los triggers
-- agregados a paquetes/documentos/subclientes son puramente aditivos
-- (AFTER, no cambian ningún resultado de las mutaciones existentes, solo
-- agregan una fila en `auditoria` por cada mutación real).
-- CÓMO VALIDAR (con el MCP, después de aplicar):
--   - list_tables: `auditoria` con RLS+FORCE, columnas según este archivo.
--   - Insertar/actualizar/borrar una fila de prueba en `paquetes` (o
--     `documentos`/`subclientes`) como un usuario autenticado real y
--     confirmar que aparece EXACTAMENTE una fila nueva en `auditoria`, con
--     `cambios` reflejando solo los campos tocados (excepto actualizado_en).
--   - Un UPDATE que no cambia ningún valor real (ej. `update paquetes set
--     descripcion = descripcion where id = ...`) NO debe generar fila nueva.
--   - `update public.auditoria set cambios = '{}'` y `delete from
--     public.auditoria` deben fallar con P0001 incluso como rol con
--     BYPASSRLS (mismo patrón de prueba en dos capas que
--     documento_lineas/log_envios en la suite pgTAP existente).
-- PLAN DE REVERSIÓN (pensado, no ejecutado automáticamente):
--   drop trigger trg_subclientes_auditoria on public.subclientes;
--   drop trigger trg_documentos_auditoria on public.documentos;
--   drop trigger trg_paquetes_auditoria on public.paquetes;
--   drop function if exists public.registrar_auditoria();
--   drop table if exists public.auditoria;
--   drop type if exists public.origen_auditoria;
--   drop type if exists public.actor_tipo_auditoria;
--   drop type if exists public.accion_auditoria;
-- =============================================================================

create type public.accion_auditoria as enum ('INSERT', 'UPDATE', 'DELETE');
create type public.actor_tipo_auditoria as enum ('usuario', 'sistema');
create type public.origen_auditoria as enum ('ui', 'import_excel', 'api', 'cron');

-- -----------------------------------------------------------------------------
-- auditoria (append-only)
-- -----------------------------------------------------------------------------
create table public.auditoria (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants (id) on delete cascade,
  tabla        text not null,
  -- Sin FK real: referencia heterogénea (paquetes/documentos/subclientes/...
  -- a futuro tarifas). Ver nota de diseño en el header de esta migración.
  registro_id  uuid not null,
  accion       public.accion_auditoria not null,
  -- {"campo": {"antes": ..., "despues": ...}} — solo los campos que
  -- efectivamente cambiaron (ver public.registrar_auditoria()).
  cambios      jsonb not null default '{}'::jsonb,
  actor_id     uuid references public.usuarios (id) on delete restrict,
  actor_tipo   public.actor_tipo_auditoria not null,
  origen       public.origen_auditoria not null default 'api',
  creado_en    timestamptz not null default now(),

  constraint auditoria_actor_coherente check (
    (actor_tipo = 'usuario' and actor_id is not null)
    or (actor_tipo = 'sistema' and actor_id is null)
  )
);

comment on table public.auditoria is
  'Bitácora append-only de cambios (INSERT/UPDATE/DELETE) en tablas de datos '
  'del courier. Se llena automáticamente vía public.registrar_auditoria() '
  '(paquetes, documentos, subclientes; agregar tarifas cuando esa tabla '
  'exista) y opcionalmente a mano desde server actions para un evento '
  'puntual que no sale del trigger genérico. INMUTABLE: sin política de '
  'UPDATE/DELETE + trigger bloquear_mutacion_append_only como defensa en '
  'profundidad (mismo patrón que documento_lineas/log_envios).';

comment on column public.auditoria.actor_tipo is
  'Explícito a propósito: nunca dejar actor_id NULL "en silencio". '
  'usuario = auth.uid() no era NULL al momento del cambio; sistema = proceso '
  'de confianza sin sesión de usuario (cron/backend). El CHECK '
  'auditoria_actor_coherente garantiza la coherencia con actor_id.';

comment on column public.auditoria.origen is
  'Leído de la GUC de sesión app.origen (SET LOCAL desde la server action); '
  'default "api" si la GUC no está seteada o trae un valor no reconocido '
  '(parseo defensivo en registrar_auditoria(): una GUC mal seteada nunca '
  'aborta la operación de negocio real).';

comment on column public.auditoria.registro_id is
  'Id de la fila auditada en `tabla` (paquetes/documentos/subclientes/...). '
  'Sin FK real: es una referencia heterogénea a múltiples tablas posibles.';

create index auditoria_tenant_tabla_registro_idx on public.auditoria (tenant_id, tabla, registro_id);
create index auditoria_creado_en_idx on public.auditoria (creado_en desc);

alter table public.auditoria enable row level security;
alter table public.auditoria force row level security;

create policy auditoria_ver_mismo_tenant on public.auditoria
  for select
  to authenticated
  using (tenant_id = (select private.current_tenant_id()));

-- Permitida a propósito (R1): además de la escritura automática del trigger
-- genérico (SECURITY DEFINER, la bypassea), habilita que una server action
-- inserte manualmente un evento de auditoría puntual (ver nota de diseño en
-- el header de esta migración).
create policy auditoria_insertar_mismo_tenant on public.auditoria
  for insert
  to authenticated
  with check (tenant_id = (select private.current_tenant_id()));

-- Sin política de UPDATE ni DELETE (deny-by-default) + trigger explícito
-- (defensa en profundidad, mismo patrón que documento_lineas/log_envios).
create trigger trg_auditoria_bloquear_mutacion
  before update or delete on public.auditoria
  for each row
  execute function public.bloquear_mutacion_append_only();

-- -----------------------------------------------------------------------------
-- public.registrar_auditoria() — trigger genérico reutilizable
-- -----------------------------------------------------------------------------
-- AFTER INSERT OR UPDATE OR DELETE FOR EACH ROW en cualquier tabla con
-- columnas `id` (uuid) y `tenant_id` (regla dura #1: TODA tabla de datos de
-- courier las tiene). Sin argumentos: TG_TABLE_NAME/TG_OP ya identifican
-- todo lo que necesita.
create or replace function public.registrar_auditoria()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old         jsonb;
  v_new         jsonb;
  v_cambios     jsonb := '{}'::jsonb;
  v_clave       text;
  v_registro_id uuid;
  v_tenant_id   uuid;
  v_actor_id    uuid;
  v_actor_tipo  public.actor_tipo_auditoria;
  v_origen_txt  text;
  v_origen      public.origen_auditoria;
begin
  if TG_OP = 'DELETE' then
    v_old := to_jsonb(OLD);
    v_new := '{}'::jsonb;
    v_tenant_id := OLD.tenant_id;
    v_registro_id := OLD.id;
  elsif TG_OP = 'INSERT' then
    v_old := '{}'::jsonb;
    v_new := to_jsonb(NEW);
    v_tenant_id := NEW.tenant_id;
    v_registro_id := NEW.id;
  else
    v_old := to_jsonb(OLD);
    v_new := to_jsonb(NEW);
    v_tenant_id := NEW.tenant_id;
    v_registro_id := NEW.id;
  end if;

  -- Unión de claves de ambos lados (cubre columnas que solo existen en uno
  -- de los dos jsonb: INSERT -v_old vacío- y DELETE -v_new vacío-, con el
  -- mismo código que UPDATE). `actualizado_en` se excluye a propósito: la
  -- pisa siempre actualizar_actualizado_en() en CUALQUIER UPDATE, aunque no
  -- cambie ningún dato real — incluirla rompería la regla de "diff vacío no
  -- genera fila" para TODO UPDATE sin excepción (ver nota de diseño).
  for v_clave in
    select key from jsonb_each(v_old)
    union
    select key from jsonb_each(v_new)
  loop
    if v_clave = 'actualizado_en' then
      continue;
    end if;
    if (v_old -> v_clave) is distinct from (v_new -> v_clave) then
      v_cambios := v_cambios || jsonb_build_object(
        v_clave, jsonb_build_object('antes', v_old -> v_clave, 'despues', v_new -> v_clave)
      );
    end if;
  end loop;

  -- UPDATE sin cambios reales (diff vacío): no insertar (ruido). INSERT y
  -- DELETE siempre generan al menos un cambio (la fila entera aparece o
  -- desaparece), así que esta guarda en la práctica solo poda UPDATEs.
  if TG_OP = 'UPDATE' and v_cambios = '{}'::jsonb then
    return NEW;
  end if;

  v_actor_id := (select auth.uid());
  if v_actor_id is not null then
    v_actor_tipo := 'usuario';
  else
    v_actor_tipo := 'sistema';
  end if;

  -- Parseo defensivo de la GUC de sesión: un valor ausente o corrupto NUNCA
  -- debe abortar la mutación de negocio real que disparó este trigger AFTER.
  v_origen_txt := current_setting('app.origen', true);
  if v_origen_txt is null or v_origen_txt = '' then
    v_origen_txt := 'api';
  end if;
  begin
    v_origen := v_origen_txt::public.origen_auditoria;
  exception when invalid_text_representation then
    v_origen := 'api';
  end;

  insert into public.auditoria (tenant_id, tabla, registro_id, accion, cambios, actor_id, actor_tipo, origen)
  values (v_tenant_id, TG_TABLE_NAME, v_registro_id, TG_OP::public.accion_auditoria, v_cambios, v_actor_id, v_actor_tipo, v_origen);

  if TG_OP = 'DELETE' then
    return OLD;
  end if;
  return NEW;
end;
$$;

comment on function public.registrar_auditoria() is
  'Trigger genérico AFTER INSERT/UPDATE/DELETE: escribe en auditoria el diff '
  'columna por columna (excluyendo actualizado_en) entre OLD y NEW, con '
  'actor_id/actor_tipo (auth.uid() o "sistema" explícito) y origen (GUC '
  'app.origen). SECURITY DEFINER: la escritura del log nunca debe depender '
  'de la RLS de la tabla auditoria (ver nota de diseño en el header de la '
  'migración). Sin revoke de anon/authenticated: retorna `trigger`, Postgres '
  'no permite invocarla directamente vía RPC (mismo patrón que el resto de '
  'los triggers genéricos del proyecto — verificar_tenant_padre, '
  'bloquear_mutacion_append_only, proteger_paquete_facturado, etc. — '
  'ninguno lleva revoke porque ninguno es invocable fuera del mecanismo de '
  'trigger).';

-- -----------------------------------------------------------------------------
-- Attach a las tablas de datos de negocio del tenant.
-- -----------------------------------------------------------------------------
-- NOTA DE EXTRACCIÓN (factura-eletronica): la versión original de esta migración
-- (factura-eletronica.app) attacheaba este trigger a sus propias tablas de negocio
-- (paquetes, documentos, subclientes) — ninguna existe en este framework
-- genérico, así que el attach se removió acá. Este trigger se attachea
-- también, más adelante en este mismo set, a `tenants`/`usuarios_tenants`/
-- `invitaciones` (ver `20260716060000`, que además extiende la función con
-- argumentos opcionales para tablas cuya PK/columna de tenant no se llaman
-- literalmente `id`/`tenant_id`). Cualquier tabla de negocio NUEVA que un
-- proyecto derivado agregue (con `tenant_id uuid not null`, regla dura #1)
-- debe sumar, como último paso de su propia migración, el mismo attach:
--   create trigger trg_<tabla>_auditoria after update on public.<tabla>
--     for each row execute function public.registrar_auditoria();
-- (recordar: la colecta automática es SOLO en UPDATE — ver `20260714050000`
-- en el proyecto origen, decisión que este set ya adopta desde el inicio al
-- no attachear INSERT/DELETE en ningún lado).
-- -----------------------------------------------------------------------------
