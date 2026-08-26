-- =============================================================================
-- Migración: registrar_auditoria() — excluir columnas GENERATED del diff
-- -----------------------------------------------------------------------------
-- IMPACTO: solo el cuerpo de public.registrar_auditoria() (create or
-- replace). Cero cambios de esquema, triggers, políticas o attach (los 3
-- triggers siguen AFTER UPDATE únicamente, desde 20260714050000). Decisión
-- explícita de Yac (2026-07-14), respondiendo la pregunta elevada por esta
-- tarea: el diff de auditoría debe registrar SOLO los campos de negocio que
-- efectivamente se tocaron — las columnas GENERATED (recalculadas por
-- Postgres a partir de otras columnas, ej. diferencia_peso_g/estado_pesaje en
-- paquetes) NUNCA deben aparecer en `cambios`, aunque cambien de valor como
-- efecto derivado de la columna real que sí se editó.
--
-- ANTES: el loop de unión de claves (jsonb_each(v_old) UNION jsonb_each
-- (v_new)) solo excluía `actualizado_en` a mano. Un UPDATE de
-- peso_facturable_g en paquetes también recalcula las GENERATED
-- diferencia_peso_g y estado_pesaje -Postgres las incluye en to_jsonb(NEW)
-- como columnas reales- y el diff terminaba con 3 claves en vez de 1.
--
-- AHORA: las columnas GENERATED de la tabla que disparó el trigger se
-- detectan DINÁMICAMENTE del catálogo de sistema al inicio de la función,
-- vía `TG_RELID` (el oid de la tabla real, disponible dentro de cualquier
-- trigger) contra `pg_catalog.pg_attribute.attgenerated <> ''` (marca de
-- Postgres para columnas STORED GENERATED). A propósito NO se enumeran a
-- mano `diferencia_peso_g`/`estado_pesaje` — aplica el aprendizaje de
-- arquitecto-db del 2026-07-13 sobre listas hardcodeadas de exclusión: una
-- lista fija es allow-by-default disfrazado (protege lo que hoy conocemos,
-- pero una GENERATED nueva en paquetes, o la primera GENERATED de
-- documentos/subclientes/una tabla futura con este mismo trigger, se colaría
-- en el diff sin que nadie la agregara a la lista). La detección dinámica es
-- deny-by-default real: cualquier columna GENERATED, exista hoy o se cree
-- mañana en cualquier tabla que use este trigger genérico, queda excluida
-- automáticamente, sin mantenimiento.
--
-- La regla "UPDATE sin cambios reales (diff vacío) no genera fila" sigue
-- exactamente igual (la exclusión ocurre ANTES de esa comprobación, así que
-- de paso cubre el caso teórico de un UPDATE que solo re-dispara el cálculo
-- de una GENERATED sin cambiar ninguna columna real).
--
-- QUÉ NO CAMBIA: actor_id/actor_tipo (auth.uid() o "sistema"), origen (GUC
-- app.origen, parseo defensivo), las ramas TG_OP = 'INSERT'/'DELETE' como
-- código muerto documentado (no attacheadas desde 20260714050000), SECURITY
-- DEFINER, el revoke de EXECUTE para anon/authenticated (20260713091300).
--
-- FILAS HISTÓRICAS: las filas de auditoria insertadas ANTES de esta migración
-- que ya traen diferencia_peso_g/estado_pesaje (u otra GENERATED) dentro de
-- `cambios` NO se tocan ni se reescriben (auditoria es append-only por
-- diseño) — quedan tal cual, como snapshot fiel de lo que el sistema
-- registraba en ese momento. Esta migración solo cambia el comportamiento
-- HACIA ADELANTE.
--
-- ES DESTRUCTIVA: no.
--
-- CÓMO VALIDAR (con el MCP, después de aplicar):
--   - UPDATE de peso_facturable_g en un paquete (con sesión real) -> la fila
--     de auditoria resultante debe tener `cambios` con EXACTAMENTE 1 clave
--     (peso_facturable_g), sin diferencia_peso_g ni estado_pesaje.
--   - UPDATE que solo cambia una columna sin GENERATED asociada (ej.
--     tracking) -> comportamiento sin cambios (1 clave, la tocada).
--   - Correr la suite pgTAP actualizada
--     supabase/tests/database/20260713_auditoria.test.sql.
--
-- PLAN DE REVERSIÓN: re-aplicar el cuerpo de la función tal como quedó en
-- 20260714050000 (create or replace, sin la detección/exclusión de
-- GENERATED) — no recomendado, reintroduce ruido de columnas derivadas en el
-- diff de auditoría.
-- =============================================================================

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
  v_generadas   text[];
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

  -- Columnas GENERATED de la tabla real que disparó el trigger, detectadas
  -- DINÁMICAMENTE del catálogo (TG_RELID = oid de esa tabla) — nunca una
  -- lista hardcodeada por nombre de columna (ver nota de diseño en el header
  -- de esta migración). attgenerated <> '' es la marca de Postgres para toda
  -- columna STORED GENERATED (Postgres 12+); coalesce a array vacío para que
  -- `= any(...)` nunca compare contra NULL.
  select coalesce(array_agg(attname::text), array[]::text[])
    into v_generadas
    from pg_catalog.pg_attribute
   where attrelid = TG_RELID
     and attnum > 0
     and not attisdropped
     and attgenerated <> '';

  -- Unión de claves de ambos lados (cubre columnas que solo existen en uno
  -- de los dos jsonb: INSERT -v_old vacío- y DELETE -v_new vacío-, con el
  -- mismo código que UPDATE). Se excluyen dos categorías, ninguna por lista
  -- hardcodeada de nombres de negocio: `actualizado_en` (la pisa siempre
  -- actualizar_actualizado_en() en CUALQUIER UPDATE, aunque no cambie ningún
  -- dato real) y cualquier columna GENERATED de v_generadas (decisión de Yac
  -- 2026-07-14: el diff es solo de campos de negocio, las derivadas no
  -- cuentan como "un cambio" en sí mismas).
  for v_clave in
    select key from jsonb_each(v_old)
    union
    select key from jsonb_each(v_new)
  loop
    if v_clave = 'actualizado_en' or v_clave = any(v_generadas) then
      continue;
    end if;
    if (v_old -> v_clave) is distinct from (v_new -> v_clave) then
      v_cambios := v_cambios || jsonb_build_object(
        v_clave, jsonb_build_object('antes', v_old -> v_clave, 'despues', v_new -> v_clave)
      );
    end if;
  end loop;

  -- UPDATE sin cambios reales (diff vacío, ya sin contar actualizado_en ni
  -- GENERATED): no insertar (ruido). INSERT y DELETE siempre generan al
  -- menos un cambio (la fila entera aparece o desaparece) entre las columnas
  -- de negocio, así que esta guarda en la práctica solo poda UPDATEs (hoy
  -- además código muerto para las 3 tablas actuales: solo se attachea AFTER
  -- UPDATE desde 20260714050000).
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
  'Trigger genérico: escribe en auditoria el diff columna por columna entre '
  'OLD y NEW, SOLO de campos de negocio — excluye actualizado_en y toda '
  'columna GENERATED de la tabla (detectadas DINÁMICAMENTE del catálogo vía '
  'TG_RELID + pg_attribute.attgenerated, nunca una lista hardcodeada de '
  'nombres; decisión de Yac 2026-07-14, 20260714052000: un UPDATE de '
  'peso_facturable_g en paquetes ya NO trae diferencia_peso_g/estado_pesaje '
  'en cambios, aunque Postgres las recalcule como efecto derivado). Incluye '
  'actor_id/actor_tipo (auth.uid() o "sistema" explícito) y origen (GUC '
  'app.origen). Attacheada HOY solo como AFTER UPDATE en paquetes/documentos/'
  'subclientes (decisión de Yac 2026-07-14: la colecta automática es solo de '
  'UPDATE — ver 20260714050000). Conserva las ramas TG_OP = INSERT/DELETE '
  'como código muerto inofensivo a propósito: (a) el enum accion_auditoria '
  'sigue admitiendo esos valores para un evento MANUAL insertado a mano vía '
  'la política auditoria_insertar_mismo_tenant (R1); (b) si Yac revierte la '
  'decisión de solo-UPDATE, alcanza con volver a attachear los triggers '
  'existentes con `after insert or update or delete`, sin tocar esta '
  'función. Si en el futuro se crea la tabla tarifas y se le suma este '
  'trigger, attachearlo también como AFTER UPDATE únicamente, igual que las '
  '3 tablas actuales — la exclusión de GENERATED aplica sola, sin cambios en '
  'esta función. SECURITY DEFINER: la escritura del log nunca debe depender '
  'de la RLS de la tabla auditoria (ver nota de diseño en 20260713091000). '
  'Sin EXECUTE para anon/authenticated (revocado explícito en '
  '20260713091300). Filas históricas insertadas antes de 20260714052000 que '
  'ya traen GENERATED en cambios se conservan tal cual (append-only, no se '
  'reescriben).';
