-- =============================================================================
-- Migración: auditoría (SOLO UPDATE) también sobre tenants, usuarios_tenants
--            e invitaciones — decisión de Yac (2026-07-16)
-- -----------------------------------------------------------------------------
-- IMPACTO:
--   1) Extiende public.registrar_auditoria() (create or replace, MISMA firma:
--      sigue siendo `returns trigger`, sin argumentos SQL declarados — los
--      triggers de Postgres pueden pasarle argumentos vía TG_ARGV sin que eso
--      cambie el signature de la función) para soportar, de forma opcional,
--      DOS argumentos de trigger: 1ro = nombre de columna a usar como
--      tenant_id, 2do = nombre de columna a usar como registro_id. Sin
--      argumentos (como siguen attacheados paquetes/documentos/subclientes),
--      el comportamiento es BYTE A BYTE el mismo que en 20260714052000
--      (tenant_id/id, resueltos ahora vía jsonb en vez de acceso estático a
--      campo — ver "POR QUÉ EL CAMBIO DE MECANISMO" más abajo).
--   2) Attachea 3 triggers AFTER UPDATE nuevos (ÚNICAMENTE UPDATE — regla dura
--      #13/decisión de Yac 2026-07-14, igual que paquetes/documentos/
--      subclientes desde 20260714050000): trg_tenants_auditoria,
--      trg_usuarios_tenants_auditoria, trg_invitaciones_auditoria.
--   3) Actualiza los `comment on table` de las 3 tablas para dejar constancia
--      de que ahora se auditan.
--   4) Agrega un bloque `do $$ ... $$` de verificación DDL-TIME (4ta ronda de
--      revisión externa, 2026-07-16) después de crear los 3 triggers: valida
--      contra information_schema.columns que las columnas configuradas para
--      tenant_id/registro_id de cada trigger EXISTEN de verdad en su tabla —
--      si no, RAISE EXCEPTION y la migración entera falla (nunca llega a
--      producción con un trigger mal configurado).
--
-- CAST DEFENSIVO (agregado tras hallazgo BLOQUEANTE de la ronda de revisión
-- externa, 2026-07-16, antes de que esta migración se diera por cerrada):
-- resolver tenant_id/registro_id vía jsonb (punto anterior) reemplazó el
-- acceso estático a campo por un `::uuid` sobre un texto dinámico — si ese
-- texto viniera ausente (columna resuelta que no existe en la tabla, ej. un
-- typo de argumento futuro) o con forma inválida de uuid (ej. un argumento
-- apuntando por error a una columna que no es uuid), el cast directo
-- rompería el trigger AFTER y ABORTARÍA la mutación de negocio real que lo
-- disparó — inaceptable para un mecanismo que debe ser 100% best-effort. Se
-- protegen AMBOS casos:
--   - Cast envuelto en `begin/exception when invalid_text_representation`
--     (mismo criterio ya usado para el parseo de la GUC app.origen desde
--     20260713091000): un valor con forma inválida deja el id en NULL en vez
--     de propagar el error.
--   - Guardia explícita que distingue CONFIG de DATO (endurecido en la 4ta
--     ronda de revisión externa, 2026-07-16 — ver también el punto 4 de
--     arriba): "la columna configurada no existe en el registro" (`v_new ?
--     clave` / `v_old ? clave`, el operador jsonb de EXISTENCIA DE CLAVE,
--     no de valor) es un error de CONFIGURACIÓN del trigger — deja la tabla
--     SIN auditar para siempre si nadie lo nota, por eso además se valida en
--     DDL-time (punto 4). "El valor está presente pero NULL o sin forma de
--     uuid" es una anomalía de DATOS puntual de esa fila — categóricamente
--     distinta, con su propio mensaje de WARNING. En AMBOS casos: sin id
--     válido no se puede insertar en `auditoria` de todos modos (tenant_id/
--     registro_id son NOT NULL) — se emite el WARNING correspondiente y se
--     retorna NEW/OLD sin insertar, dejando la mutación real SIEMPRE intacta
--     (esto no cambia: lo único que se endurece es que un error de
--     configuración ahora es imposible de confundir con un dato raro, y
--     además se detecta antes, en la migración).
--   - El propio `INSERT INTO auditoria` final queda envuelto en
--     `begin/exception when others` como última línea de defensa (cualquier
--     fallo no anticipado en la escritura del log —constraint futuro, etc.—
--     tampoco debe abortar la mutación real).
-- Ver la suite pgTAP (puntos "cast defensivo" y "cuando el INSERT final
-- falla de verdad") que ejercita el TRIGGER REAL (no solo el cast en
-- aislado) sobre tablas temporales con columnas/constraints problemáticos a
-- propósito.
--
-- POR QUÉ HACÍA FALTA UN CAMBIO EN LA FUNCIÓN (no alcanzaba con solo
-- attachear el trigger): registrar_auditoria() resolvía v_tenant_id/
-- v_registro_id por ACCESO ESTÁTICO a campo (`NEW.tenant_id`, `NEW.id`,
-- `OLD.tenant_id`, `OLD.id`). Eso rompe para 2 de las 3 tablas nuevas:
--   - `tenants` NO TIENE columna `tenant_id` (su PK `id` ES el tenant) ->
--     `NEW.tenant_id` da "record has no field tenant_id" en tiempo de
--     ejecución (mismo síntoma ya documentado para monedas/planes/
--     categorias_producto en 20260714185748 — por eso esas tablas globales
--     NUNCA llevaron este trigger). Acá SÍ hay una respuesta razonable: el
--     propio `id` de la fila ES el tenant_id a registrar.
--   - `usuarios_tenants` NO TIENE columna `id` (su PK es `usuario_id`) ->
--     `NEW.id` da el mismo error. La fila SÍ tiene tenant_id normal (columna
--     propia), pero el "id del registro auditado" debe ser `usuario_id`.
--   - `invitaciones` SÍ tiene `id` y `tenant_id` como cualquier tabla de
--     negocio estándar -> no necesita ningún argumento, cero caso especial.
--
-- DECISIÓN DE DISEÑO (resuelve la pregunta que dejó abierta 20260714185748
-- para catálogos globales, pero para un caso distinto: acá SIEMPRE hay un
-- tenant real, solo cambia CÓMO se lo nombra/localiza en la fila):
--   - Se prefirió generalizar registrar_auditoria() con argumentos de trigger
--     opcionales (columna-tenant, columna-registro) en vez de escribir 3
--     funciones de auditoría casi-idénticas (una por tabla) o forzar un ALTER
--     TABLE que agregue columnas `tenant_id`/`id` sintéticas a `tenants`/
--     `usuarios_tenants` solo para que un trigger genérico las use — ninguna
--     de esas dos alternativas se consideró razonable: la primera duplica
--     lógica de diff/actor/origen/GENERATED en 3 lugares (violaría el
--     principio DRY que ya motivó tener UN trigger genérico desde
--     20260713091000); la segunda ensuciaría el esquema de negocio (agregar
--     una columna que no significa nada de negocio, solo para satisfacer un
--     trigger interno) — regla general del proyecto: el esquema modela
--     negocio, no acomoda mecanismos de auditoría.
--   - Mecanismo: los valores de tenant_id/registro_id se extraen del MISMO
--     `to_jsonb(NEW)`/`to_jsonb(OLD)` que ya se calculaba para el diff (antes
--     se usaban SOLO para el diff; ahora también para resolver estas dos
--     columnas), indexando por el NOMBRE de columna resuelto (`tenant_id`/
--     `id` por default, o los que traiga TG_ARGV). Sin este cambio de
--     mecanismo, no había forma de leer `NEW.<nombre-dinámico>` en plpgsql
--     (el acceso a campo de un record es SIEMPRE estático, resuelto en
--     tiempo de compilación de la función).
--   - Los triggers de paquetes/documentos/subclientes NO se re-crean (no hace
--     falta): siguen `execute function public.registrar_auditoria()` sin
--     argumentos, TG_NARGS = 0, y la función usa los defaults 'tenant_id'/
--     'id' — exactamente las mismas columnas que antes accedía de forma
--     estática. Verificado: el valor que se guarda es IDÉNTICO (mismo
--     `.tenant_id`/`.id` del `to_jsonb(NEW)` que antes se leía directo del
--     record), así que la suite pgTAP existente
--     (supabase/tests/database/20260713_auditoria.test.sql, 49/49 antes de
--     esta migración) no debería requerir ningún cambio.
--   - `tenants`: `execute function public.registrar_auditoria('id')` — 1er
--     argumento (columna-tenant) override a 'id'; el 2do (columna-registro)
--     queda en su default ('id') porque coincide (la fila auditada Y su
--     tenant son la misma fila).
--   - `usuarios_tenants`: `execute function
--     public.registrar_auditoria('tenant_id', 'usuario_id')` — el 1er
--     argumento se repite explícito (ya es el default, pero los argumentos de
--     trigger son POSICIONALES: no se puede pasar solo el 2do sin repetir el
--     1ro) y el 2do override a 'usuario_id' (no hay columna `id`).
--   - `invitaciones`: `execute function public.registrar_auditoria()` — sin
--     argumentos, caso estándar.
--
-- QUÉ NO CAMBIA: la exclusión de `actualizado_en` y de columnas GENERATED
-- (detección dinámica vía TG_RELID + pg_attribute, 20260714052000) sigue
-- igual y aplica también a estas 3 tablas — ninguna de las 3 tiene columnas
-- GENERATED hoy (verificado contra sus migraciones de creación), así que
-- `v_generadas` será array vacío para las tres (mismo camino ya cubierto por
-- el test de `subclientes` en la suite existente). `tenants` SÍ tiene
-- `actualizado_en` (con su propio trigger `trg_tenants_actualizado_en`
-- BEFORE UPDATE) y queda excluida del diff igual que en paquetes/documentos/
-- subclientes; `usuarios_tenants`/`invitaciones` no tienen esa columna en
-- absoluto, así que la exclusión simplemente no encuentra esa clave (no-op).
-- SECURITY DEFINER, el revoke de EXECUTE para anon/authenticated
-- (20260713091300) y el resto de políticas RLS de `auditoria` NO se tocan.
--
-- ES DESTRUCTIVA: no. `registrar_auditoria()` se reemplaza vía `create or
-- replace` con la MISMA firma (conserva sus GRANT/REVOKE ya aplicados); los 3
-- triggers nuevos son puramente aditivos (AFTER, no cambian ningún resultado
-- de los UPDATE existentes sobre esas tablas, solo agregan una fila en
-- `auditoria` por cada UPDATE con cambios reales). Ninguna fila existente de
-- `tenants`/`usuarios_tenants`/`invitaciones`/`auditoria` se toca ni se
-- reescribe.
--
-- CÓMO VALIDAR (con el MCP, después de aplicar):
--   - list_triggers / pg_trigger: `trg_tenants_auditoria`,
--     `trg_usuarios_tenants_auditoria`, `trg_invitaciones_auditoria` deben
--     figurar como AFTER UPDATE (no INSERT/DELETE) en sus tablas respectivas.
--   - UPDATE de `tenants.nombre` (como Admin del tenant) -> auditoria gana 1
--     fila con tabla='tenants', registro_id = id del tenant, tenant_id = ESE
--     MISMO id, cambios = {"nombre": {...}} únicamente.
--   - UPDATE de `usuarios_tenants.rol` (como Admin) -> auditoria gana 1 fila
--     con tabla='usuarios_tenants', registro_id = usuario_id de la fila
--     editada (NO el tenant), tenant_id = tenant_id de esa membresía.
--   - UPDATE de `invitaciones.estado` (como Admin) -> auditoria gana 1 fila
--     con tabla='invitaciones', registro_id = id de la invitación, tenant_id
--     correcto.
--   - INSERT en cualquiera de las 3 tablas NO genera fila de auditoria (regla
--     dura #13, solo UPDATE).
--   - RLS de `auditoria` (sin cambios, ya existente): un Admin de tenant B no
--     ve ninguna de las filas de auditoría generadas para tenant A.
--   - DELETE en cualquiera de las 3 tablas (ej. vía cascada al borrar un
--     tenant, `on delete cascade` de usuarios_tenants/invitaciones) NO genera
--     fila de auditoria (regla dura #13, solo UPDATE).
--   - Cast defensivo: un trigger de prueba con argumentos apuntando a una
--     columna inexistente, o a una columna con un valor sin forma de uuid,
--     sobre una tabla temporal -> el UPDATE real se completa igual
--     (lives_ok) y NO se inserta fila en `auditoria` para esa tabla (en vez
--     de abortar con invalid_text_representation). El WARNING debe decir
--     "ERROR DE CONFIGURACIÓN" para la columna inexistente y "DATO fuera de
--     forma" para el valor inválido — mensajes DISTINTOS (ver `get_logs` del
--     MCP o el log de Postgres al correr la suite manualmente).
--   - Un INSERT final a `auditoria` que falla por un constraint REAL (no un
--     cast) -> el UPDATE real tampoco se aborta, 0 filas de auditoría para
--     esa tabla (el `begin/exception when others` que envuelve el INSERT lo
--     atrapa).
--   - Verificación DDL-TIME: re-aplicar esta migración (o una copia con un
--     argumento de columna deliberadamente mal escrito, ej.
--     `registrar_auditoria('columna_que_no_existe')` en vez de `'id'` para
--     tenants) debe hacer que la migración ENTERA falle con RAISE EXCEPTION
--     antes de completar — nunca debe quedar aplicada a medias con un
--     trigger mal configurado.
--   - Re-correr supabase/tests/database/20260713_auditoria.test.sql completa
--     (debe seguir en verde, mismo resultado que antes de esta migración —
--     ningún cambio de comportamiento para paquetes/documentos/subclientes).
--   - Correr la suite nueva
--     supabase/tests/database/20260716_auditoria_tenants_membresias_invitaciones.test.sql.
--
-- PLAN DE REVERSIÓN (pensado, no ejecutado automáticamente):
--   drop trigger trg_invitaciones_auditoria on public.invitaciones;
--   drop trigger trg_usuarios_tenants_auditoria on public.usuarios_tenants;
--   drop trigger trg_tenants_auditoria on public.tenants;
--   -- Reemplazar el cuerpo de registrar_auditoria() por el de 20260714052000
--   -- (acceso estático NEW.tenant_id/NEW.id, sin soporte de TG_ARGV) — los
--   -- DROP TRIGGER de arriba deben ir PRIMERO: sin ellos, revertir la función
--   -- dejaría paquetes/documentos/subclientes intactos (no usan argumentos)
--   -- pero los triggers de tenants/usuarios_tenants ya no existirían de
--   -- todos modos tras el DROP.
-- =============================================================================

create or replace function public.registrar_auditoria()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_old          jsonb;
  v_new          jsonb;
  v_cambios      jsonb := '{}'::jsonb;
  v_clave        text;
  v_registro_id  uuid;
  v_tenant_id    uuid;
  v_actor_id     uuid;
  v_actor_tipo   public.actor_tipo_auditoria;
  v_origen_txt   text;
  v_origen       public.origen_auditoria;
  v_generadas    text[];
  v_col_tenant   text := 'tenant_id';
  v_col_registro text := 'id';
  v_tenant_txt   text;
  v_registro_txt text;
  v_col_existe_tenant   boolean;
  v_col_existe_registro boolean;
begin
  -- Argumentos de trigger OPCIONALES (20260716060000): 1er argumento = nombre
  -- de columna a usar como tenant_id; 2do = nombre de columna a usar como
  -- registro_id. Sin argumentos (TG_NARGS = 0, el caso de paquetes/
  -- documentos/subclientes) se preservan los defaults de siempre
  -- ('tenant_id'/'id') -> cero cambio de comportamiento para esas 3 tablas.
  -- `nullif(..., '')` por si algún día un trigger pasa una cadena vacía en
  -- vez de omitir el argumento: se trata igual que "no override".
  if TG_NARGS >= 1 then
    v_col_tenant := coalesce(nullif(TG_ARGV[0], ''), v_col_tenant);
  end if;
  if TG_NARGS >= 2 then
    v_col_registro := coalesce(nullif(TG_ARGV[1], ''), v_col_registro);
  end if;

  if TG_OP = 'DELETE' then
    v_old := to_jsonb(OLD);
    v_new := '{}'::jsonb;
  elsif TG_OP = 'INSERT' then
    v_old := '{}'::jsonb;
    v_new := to_jsonb(NEW);
  else
    v_old := to_jsonb(OLD);
    v_new := to_jsonb(NEW);
  end if;

  -- tenant_id/registro_id YA NO se leen por acceso estático a campo
  -- (`NEW.tenant_id`/`NEW.id`/`OLD.tenant_id`/`OLD.id`, como hasta
  -- 20260714052000): se extraen del jsonb recién calculado, por el NOMBRE de
  -- columna resuelto arriba — esto es lo que permite reusar la MISMA función
  -- en tablas donde esas columnas se llaman distinto (`tenants.id` hace de
  -- tenant_id; `usuarios_tenants.usuario_id` hace de registro_id). Se
  -- prefiere v_new (INSERT/UPDATE); en DELETE v_new está vacío y cae a
  -- v_old.
  --
  -- DISTINCIÓN CONFIG vs DATO (4ta ronda de revisión externa, 2026-07-16):
  -- el operador jsonb `?` (existencia de CLAVE, no de valor) es la única
  -- forma de distinguir "esta columna no existe en la tabla" (error de
  -- CONFIGURACIÓN del trigger — un argumento de CREATE TRIGGER mal escrito,
  -- que dejaría la tabla auditando en silencio PARA SIEMPRE si no se
  -- distingue) de "la columna existe pero su valor es NULL o no tiene forma
  -- de uuid" (dato raro puntual de ESTA fila). `to_jsonb(record)` siempre
  -- incluye TODAS las columnas reales de la tabla como claves (con `null`
  -- como valor JSON si la columna es SQL NULL) — así que `v_new ? clave`
  -- (o `v_old ?` en DELETE, donde v_new es '{}') da `false` ÚNICAMENTE si esa
  -- columna no existe de verdad en el esquema de la tabla.
  v_col_existe_tenant := (v_new ? v_col_tenant) or (v_old ? v_col_tenant);
  v_col_existe_registro := (v_new ? v_col_registro) or (v_old ? v_col_registro);

  v_tenant_txt := coalesce(v_new ->> v_col_tenant, v_old ->> v_col_tenant);
  v_registro_txt := coalesce(v_new ->> v_col_registro, v_old ->> v_col_registro);

  -- CAST DEFENSIVO (hallazgo de la ronda de revisión externa, 2026-07-16):
  -- un `::uuid` directo sobre un valor con forma inválida lanza
  -- invalid_text_representation — si no se capturara, ese error se propaga
  -- desde un trigger AFTER y ABORTA la mutación de negocio real que lo
  -- disparó (el mismo riesgo que ya se documentó y evitó para el parseo de
  -- la GUC app.origen, aplicado ahora también acá). Se captura
  -- ESPECÍFICAMENTE ese SQLSTATE (no un "when others" ciego en el cast:
  -- un error de OTRA naturaleza durante el cast sería un bug real a no
  -- esconder) y se deja el valor en NULL para manejarlo explícito abajo.
  begin
    v_tenant_id := v_tenant_txt::uuid;
  exception when invalid_text_representation then
    v_tenant_id := null;
  end;
  begin
    v_registro_id := v_registro_txt::uuid;
  exception when invalid_text_representation then
    v_registro_id := null;
  end;

  -- Si no se pudo resolver un tenant_id/registro_id válido, auditoria.
  -- tenant_id/registro_id son NOT NULL: un INSERT con NULL fallaría igual y
  -- también abortaría la mutación real. En vez de eso, se SALTA el registro
  -- de auditoría (best-effort, nunca bloqueante) — pero el WARNING difiere
  -- SEGÚN LA CAUSA (4ta ronda de revisión externa, 2026-07-16), porque el
  -- riesgo real es distinto en cada caso:
  --   - Config: la columna NO EXISTE en la tabla -> error de CONFIGURACIÓN
  --     del trigger (un argumento de CREATE TRIGGER apunta a una columna que
  --     no está en el esquema) -> TODO UPDATE futuro de esa tabla se saltaría
  --     la auditoría PARA SIEMPRE, en silencio, si el mensaje no lo deja
  --     claro. Este caso debería haber sido atrapado en tiempo de migración
  --     (ver el bloque `do $$ ... $$` de verificación más abajo en esta
  --     misma migración) — si de todos modos ocurre en runtime (ej. alguien
  --     agrega un CREATE TRIGGER nuevo saltándose esa verificación, o le pasa
  --     `ALTER TABLE ... DROP COLUMN` a una columna que un trigger ya
  --     asumía), el WARNING lo dice explícito para que sea imposible de
  --     confundir con un dato raro puntual.
  --   - Dato: la columna SÍ EXISTE pero el valor de ESTA fila es NULL o no
  --     tiene forma de uuid -> anomalía de datos puntual de este registro,
  --     no de la configuración del trigger.
  if not v_col_existe_tenant or not v_col_existe_registro then
    raise warning
      'registrar_auditoria: ERROR DE CONFIGURACIÓN — la columna "%" (argumento del trigger) NO EXISTE en la tabla % (accion %); revisar el argumento pasado a CREATE TRIGGER ... EXECUTE FUNCTION registrar_auditoria(...) — se omite el registro de auditoría, la mutación real NO se ve afectada, pero esta tabla quedará SIN auditar hasta corregir el trigger',
      case when not v_col_existe_tenant then v_col_tenant else v_col_registro end, TG_TABLE_NAME, TG_OP;
    if TG_OP = 'DELETE' then
      return OLD;
    end if;
    return NEW;
  elsif v_tenant_id is null or v_registro_id is null then
    raise warning
      'registrar_auditoria: DATO fuera de forma — el valor de tenant_id/registro_id para tabla % (accion %) está NULL o no tiene forma de uuid (columna_tenant=% valor=%, columna_registro=% valor=%) — se omite el registro de auditoría, la mutación real NO se ve afectada',
      TG_TABLE_NAME, TG_OP, v_col_tenant, v_tenant_txt, v_col_registro, v_registro_txt;
    if TG_OP = 'DELETE' then
      return OLD;
    end if;
    return NEW;
  end if;

  -- Columnas GENERATED de la tabla real que disparó el trigger, detectadas
  -- DINÁMICAMENTE del catálogo (TG_RELID = oid de esa tabla) — nunca una
  -- lista hardcodeada por nombre de columna (20260714052000, sin cambios).
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
  -- actualizar_actualizado_en() en CUALQUIER UPDATE de las tablas que lo
  -- tienen, aunque no cambie ningún dato real) y cualquier columna GENERATED
  -- de v_generadas.
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
  -- además código muerto para las 6 tablas actuales: todas se attachean
  -- SOLO AFTER UPDATE desde 20260714050000/20260716060000).
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

  -- Última línea de defensa (hallazgo de la ronda de revisión externa,
  -- 2026-07-16): el propio INSERT a auditoria (NOT NULL/FK/CHECK, o
  -- cualquier fallo inesperado no anticipado arriba) TAMPOCO debe abortar la
  -- mutación real. Acá sí se captura `when others` a propósito (es la ÚLTIMA
  -- instancia antes de terminar el trigger, no un cast puntual): cualquier
  -- fallo de escritura del log queda como WARNING diagnosticable, nunca como
  -- una excepción que se propaga y revierte el UPDATE de negocio.
  begin
    insert into public.auditoria (tenant_id, tabla, registro_id, accion, cambios, actor_id, actor_tipo, origen)
    values (v_tenant_id, TG_TABLE_NAME, v_registro_id, TG_OP::public.accion_auditoria, v_cambios, v_actor_id, v_actor_tipo, v_origen);
  exception when others then
    raise warning
      'registrar_auditoria: no se pudo insertar la fila de auditoría para tabla % registro % (%) — se omite, la mutación real NO se ve afectada',
      TG_TABLE_NAME, v_registro_id, SQLERRM;
  end;

  if TG_OP = 'DELETE' then
    return OLD;
  end if;
  return NEW;
end;
$fn$;

comment on function public.registrar_auditoria() is
  'Trigger genérico: escribe en auditoria el diff columna por columna entre '
  'OLD y NEW, SOLO de campos de negocio — excluye actualizado_en y toda '
  'columna GENERATED de la tabla (detectadas dinámicamente del catálogo vía '
  'TG_RELID + pg_attribute.attgenerated, nunca una lista hardcodeada de '
  'nombres; 20260714052000). Desde 20260716060000 admite 2 argumentos de '
  'trigger OPCIONALES (posicionales): 1ro = columna a usar como tenant_id, '
  '2do = columna a usar como registro_id — resueltos vía jsonb (ya no acceso '
  'estático a NEW.tenant_id/NEW.id), lo que permite reusar esta MISMA '
  'función en tablas cuya PK o columna de tenant no se llaman literalmente '
  '`id`/`tenant_id` (tenants: registrar_auditoria(''id'') porque su propio id '
  'ES el tenant; usuarios_tenants: registrar_auditoria(''tenant_id'', '
  '''usuario_id'') porque no tiene columna id). Sin argumentos, defaults '
  '''tenant_id''/''id'' — cero cambio de comportamiento para paquetes/'
  'documentos/subclientes/invitaciones. CAST DEFENSIVO (20260716060000): el '
  'texto resuelto para tenant_id/registro_id se castea a uuid dentro de un '
  'begin/exception invalid_text_representation (mismo criterio que el '
  'parseo de app.origen); si el valor viene ausente o inválido, se salta el '
  'registro de auditoría SIN abortar la mutación real — y el propio INSERT '
  'final a auditoria también queda protegido con un begin/exception when '
  'others como última línea de defensa. El WARNING emitido DISTINGUE la '
  'causa (endurecido en la 4ta ronda de revisión externa, 2026-07-16): '
  '"ERROR DE CONFIGURACIÓN" cuando la columna configurada NO EXISTE en la '
  'tabla (jsonb ? de existencia de CLAVE, no de valor — un typo de argumento '
  'dejaría la tabla sin auditar para siempre si no se distinguiera) vs '
  '"DATO fuera de forma" cuando la columna existe pero el valor de esa fila '
  'es NULL o no tiene forma de uuid. El error de configuración además se '
  'valida en DDL-TIME (bloque `do $$ ... $$` después de crear los 3 '
  'triggers en 20260716060000, contra information_schema.columns): si un '
  'argumento apunta a una columna inexistente, la MIGRACIÓN falla con RAISE '
  'EXCEPTION antes de completar, nunca llega a producción así. Incluye '
  'actor_id/actor_tipo '
  '(auth.uid() o "sistema" explícito) y origen (GUC app.origen). Attacheada '
  'HOY como AFTER UPDATE únicamente (decisión de Yac 2026-07-14, '
  '20260714050000) en paquetes, documentos, subclientes, tenants, '
  'usuarios_tenants e invitaciones (20260716060000). Conserva las ramas '
  'TG_OP = INSERT/DELETE como código muerto inofensivo a propósito: (a) el '
  'enum accion_auditoria sigue admitiendo esos valores para un evento MANUAL '
  'insertado a mano vía la política auditoria_insertar_mismo_tenant (R1); '
  '(b) si Yac revierte la decisión de solo-UPDATE, alcanza con volver a '
  'attachear los triggers existentes con `after insert or update or '
  'delete`, sin tocar esta función. SECURITY DEFINER: la escritura del log '
  'nunca debe depender de la RLS de la tabla auditoria. Sin EXECUTE para '
  'anon/authenticated (revocado explícito en 20260713091300).';

-- -----------------------------------------------------------------------------
-- Attach: tenants, usuarios_tenants, invitaciones (solo AFTER UPDATE).
-- -----------------------------------------------------------------------------
drop trigger if exists trg_tenants_auditoria on public.tenants;
create trigger trg_tenants_auditoria
  after update on public.tenants
  for each row
  execute function public.registrar_auditoria('id');

drop trigger if exists trg_usuarios_tenants_auditoria on public.usuarios_tenants;
create trigger trg_usuarios_tenants_auditoria
  after update on public.usuarios_tenants
  for each row
  execute function public.registrar_auditoria('tenant_id', 'usuario_id');

drop trigger if exists trg_invitaciones_auditoria on public.invitaciones;
create trigger trg_invitaciones_auditoria
  after update on public.invitaciones
  for each row
  execute function public.registrar_auditoria();

-- -----------------------------------------------------------------------------
-- Verificación DDL-TIME (4ta ronda de revisión externa, 2026-07-16): un error
-- de CONFIGURACIÓN (attachear el trigger con un nombre de columna que no
-- existe en la tabla) es categóricamente distinto de un valor de dato raro en
-- runtime — el never-abort de la función es correcto para lo segundo, pero
-- dejaría una tabla mal configurada auditando en silencio PARA SIEMPRE si
-- nadie lo notara (cada UPDATE futuro generaría el WARNING de "columna
-- inexistente" y nada más). La MIGRACIÓN debe fallar EN EL ACTO si esto
-- pasara, nunca llegar a producción así — se valida contra
-- information_schema.columns (pedido explícito del reviewer, en vez de
-- pg_attribute/TG_RELID como usa la exclusión de columnas GENERATED) que las
-- columnas resueltas para tenant_id/registro_id de los 3 triggers recién
-- creados EXISTEN de verdad en su tabla. Acotado a las 3 tablas que ESTA
-- migración attachea (paquetes/documentos/subclientes ya vienen validados
-- por su propia suite pgTAP extensa desde 20260713091000/20260714052000 y no
-- se tocan acá).
do $$
declare
  -- Record variable (en vez de una lista de escalares en el target del FOR):
  -- es el patrón más inequívoco para "recorrer filas de una query" en
  -- plpgsql, mismo criterio de simplicidad que el resto de la migración.
  v_fila   record;
  v_existe boolean;
begin
  for v_fila in
    select * from (values
      ('tenants', 'id', 'id'),
      ('usuarios_tenants', 'tenant_id', 'usuario_id'),
      ('invitaciones', 'tenant_id', 'id')
    ) as t(tabla, col_tenant, col_registro)
  loop
    select exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = v_fila.tabla and column_name = v_fila.col_tenant
    ) into v_existe;
    if not v_existe then
      raise exception
        'registrar_auditoria(): la columna de tenant "%" configurada para la tabla public.% NO EXISTE (revisar el argumento de CREATE TRIGGER en 20260716060000) — migración abortada, no debe llegar a producción así',
        v_fila.col_tenant, v_fila.tabla;
    end if;

    select exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = v_fila.tabla and column_name = v_fila.col_registro
    ) into v_existe;
    if not v_existe then
      raise exception
        'registrar_auditoria(): la columna de registro "%" configurada para la tabla public.% NO EXISTE (revisar el argumento de CREATE TRIGGER en 20260716060000) — migración abortada, no debe llegar a producción así',
        v_fila.col_registro, v_fila.tabla;
    end if;
  end loop;
end $$;

comment on table public.tenants is
  'Courier (tenant). El subdominio es inmutable a nivel de producto (COU-3); '
  'esta tabla no lo impide a nivel de BD (podría requerirse una corrección '
  'excepcional vía soporte), pero la app NUNCA debe ofrecer editarlo. Todo '
  'UPDATE queda auditado vía trg_tenants_auditoria (20260716060000, solo '
  'UPDATE — regla dura #13/decisión de Yac 2026-07-14): registrar_auditoria '
  'usa el propio `id` de la fila como tenant_id de la auditoría (esta tabla '
  'no tiene columna tenant_id propia — su PK ES el tenant).';

comment on table public.usuarios_tenants is
  'Membresía usuario-tenant. La PK es `usuario_id` SOLA (no compuesta con '
  'tenant_id): por definición de PK, un usuario_id no puede aparecer en más '
  'de UNA fila en toda la tabla, sin importar el tenant — es 1:1 ESTRICTO a '
  'nivel de esquema, no solo "único dentro del mismo tenant". Gestión '
  '(INSERT/UPDATE: cambiar rol, desactivar) restringida a Admin activo del '
  'propio tenant o Super-Admin desde 20260714201000 (antes, cualquier '
  'miembro autenticado del tenant podía mutar esta tabla — hallazgo de la '
  'tarea 1.2). "No se puede dejar el tenant sin Admin" (AUTH-4) se valida '
  'primero en la app (backend-app); desde 20260714201000 además hay un '
  'guardia mínimo en BD (trg_usuarios_tenants_impedir_sin_admin) como '
  'defensa en profundidad — la UX del error sigue siendo responsabilidad de '
  'la app, este trigger solo impide el estado inconsistente a nivel de '
  'esquema. Si el MVP alguna vez pasa a N:M (usuario en varios tenants), '
  'este comentario y la PK deben revisarse juntos. Todo UPDATE queda '
  'auditado vía trg_usuarios_tenants_auditoria (20260716060000, solo '
  'UPDATE): registrar_auditoria usa `usuario_id` (no hay columna `id`) como '
  'registro_id de la auditoría.';

comment on table public.invitaciones is
  'Invitación de staff (AUTH-3): correo + rol + enlace con vencimiento. '
  'reenviar = nueva fila o refrescar token/expira_en (decisión de la app); '
  'cancelar = estado=cancelada. El estado "expirada" del enum '
  'estado_invitacion NO se materializa automáticamente al intentar aceptar '
  'una invitación vencida (public.aceptar_invitacion() solo la RECHAZA, '
  'nunca actualiza su estado — ver 20260714210000: un UPDATE antes del RAISE '
  'de rechazo no puede sobrevivir en la misma transacción). Una invitación '
  'vencida queda "pendiente" en BD indefinidamente; su vencimiento es '
  'DERIVADO (expira_en <= now()), nunca leído del estado persistido. Si algún '
  'flujo necesita materializar "expirada" de verdad (ej. un listado de '
  'backoffice que quiera distinguirlas visualmente, o una limpieza '
  'periódica), debe hacerlo en su PROPIA transacción, fuera de '
  'aceptar_invitacion() — candidato de una tarea de Fase 4, no implementado '
  'todavía. SELECT restringido a Admin activo del propio tenant desde '
  '20260714213000 (hallazgo del revisor, cierre de 1.2: `token` es la '
  'credencial de facto del enlace de invitación y no debía ser legible por '
  'cualquier miembro del tenant) — mismo criterio que ya exigían '
  'INSERT/UPDATE/DELETE desde 20260714201000. `aceptar_invitacion()` (SECURITY '
  'DEFINER, owner con BYPASSRLS) no se ve afectada: el invitado sigue '
  'pudiendo leer/bloquear su propia invitación por token sin pasar por esta '
  'RLS. Todo UPDATE queda auditado vía trg_invitaciones_auditoria '
  '(20260716060000, solo UPDATE) — caso estándar de registrar_auditoria(), '
  'sin argumentos: esta tabla ya tiene columnas `id`/`tenant_id` propias.';
