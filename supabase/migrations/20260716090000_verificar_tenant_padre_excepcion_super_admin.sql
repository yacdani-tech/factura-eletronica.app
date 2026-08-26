-- =============================================================================
-- Migración: verificar_tenant_padre() — excepción para actores Super-Admin
--            en columnas de identidad (AUTH-8, bug real reportado por Yac,
--            2026-07-16)
-- -----------------------------------------------------------------------------
-- BUG REPORTADO: un Super-Admin en modo soporte (20260714220000/221000/222000
-- — current_tenant_id() = tenant seleccionado, is_admin() = true, ACCESO
-- TOTAL nivel Admin) NO podía crear invitaciones de staff dentro del tenant
-- seleccionado. Error real:
--   "Aislamiento multi-tenant violado: usuarios_tenants.invitado_por = <uid
--   del super-admin> pertenece a un tenant distinto del de la fila
--   (tenant_id = <tenant seleccionado>)"
-- Causa: la app setea invitado_por = auth.uid() (el propio Super-Admin,
-- acciones.ts de staff, apps/web/lib/staff/acciones.ts), y el trigger
-- trg_invitaciones_invitado_por_tenant_padre (20260713090200) —
-- public.verificar_tenant_padre('invitado_por', 'usuarios_tenants',
-- 'usuario_id')— busca el tenant_id de ESE usuario_id en usuarios_tenants
-- para compararlo contra NEW.tenant_id. Un Super-Admin de plataforma, por
-- diseño (AUTH-8, comentario de public.super_admins en 20260713090200), NO
-- tiene fila propia en usuarios_tenants (no es miembro de ningún tenant) —
-- la subconsulta no encuentra nada, v_tenant_padre queda NULL, y NULL IS
-- DISTINCT FROM <tenant seleccionado> es true -> RAISE EXCEPTION, aunque la
-- referencia sea perfectamente legítima (el propio Super-Admin actuando en
-- soporte). Viola AUTH-8: el Super-Admin en soporte debe operar con acceso
-- TOTAL, como Admin del courier — crear invitaciones incluido.
--
-- BARRIDO (mismo patrón "pertenece a un tenant distinto" en TODAS las
-- migraciones, pedido explícito): public.verificar_tenant_padre() es un
-- ÚNICO trigger genérico reutilizado por 14 attachments distintos (grep
-- verificado contra supabase/migrations/ completo). De esos 14, SOLO DOS
-- tienen tabla_padre = 'usuarios_tenants' (columna_id_padre = 'usuario_id',
-- es decir, validan un ACTOR/identidad, no una entidad de negocio):
--   - documentos.creado_por            (trg_documentos_creado_por_tenant_padre,
--     20260713090500) — mismo bug latente: forzado siempre a auth.uid() por
--     forzar_creado_por_documentos() (20260713091200), así que un Super-Admin
--     en soporte tampoco podía emitir un documento hasta esta migración.
--   - invitaciones.invitado_por        (trg_invitaciones_invitado_por_tenant_padre,
--     20260713090200) — el bug reportado.
-- Los otros 12 attachments (subcliente_id->subclientes, ruta_id->rutas,
-- zona_id->zonas, consolidado_id->consolidados, documento_id->documentos,
-- documento_anulado_id->documentos, paquete_id->paquetes) referencian
-- ENTIDADES de negocio, nunca actores — un uuid de Super-Admin jamás debería
-- considerarse una referencia legítima ahí, y la excepción de abajo NO los
-- alcanza (queda acotada explícitamente a tabla_padre = 'usuarios_tenants' Y
-- columna_id_padre = 'usuario_id'). Arreglar la ÚNICA función genérica
-- corrige AMBOS puntos con una sola migración: no hace falta tocar los 14
-- CREATE TRIGGER existentes.
--
-- DISEÑO DE LA EXCEPCIÓN: dentro del mismo `if v_tenant_padre is distinct
-- from v_tenant_fila_nueva`, antes del RAISE, se agrega: si la referencia es
-- de tipo actor (tabla_padre = 'usuarios_tenants' y columna_id_padre =
-- 'usuario_id') Y el valor referenciado (v_valor_fk) existe en
-- public.super_admins, se permite (return NEW) en vez de levantar la
-- excepción. El resto del chequeo (para cualquier otra combinación de
-- tabla_padre/columna) queda IDÉNTICO.
--
-- POR QUÉ ES SEGURA (no abre un vector de fuga nuevo): la función sigue SIN
-- `security definer` (corre con los privilegios del llamador, sin cambios).
-- El `exists (select 1 from public.super_admins sa where sa.usuario_id =
-- v_valor_fk)` queda sujeto a la RLS real de super_admins
-- (`super_admins_solo_super_admin`, 20260713090200: `using
-- (private.is_super_admin())` — sin filtro por fila, solo por el llamador).
-- Efecto: si el llamador NO es Super-Admin, is_super_admin() da false, RLS
-- oculta TODAS las filas de super_admins (no solo la de v_valor_fk), y el
-- exists() da false sin importar si v_valor_fk es o no un Super-Admin real
-- — un Admin de tenant A que intente forjar invitado_por/creado_por con el
-- uuid REAL de un Super-Admin (conocido o adivinado) sigue bloqueado con la
-- excepción original, exactamente como antes de esta migración. Solo un
-- llamador que sea GENUINAMENTE Super-Admin (auth.uid() con fila propia en
-- super_admins) puede ver esas filas y pasar la excepción — y en el flujo
-- real (invitado_por/creado_por siempre forzados a auth.uid() por sus
-- respectivos triggers de forzado) eso significa exactamente "el propio
-- Super-Admin autenticado actuando en soporte", nunca un tercero.
--
-- ES DESTRUCTIVA: no. `create or replace function` con la MISMA firma
-- (`returns trigger`, mismos TG_ARGV posicionales) — los 14 CREATE TRIGGER
-- existentes NO se tocan, siguen apuntando a la misma función. Ningún dato
-- existente se reescribe. Para cualquier llamador que NO sea Super-Admin
-- (el 100% de los casos hoy, en cualquier proyecto real: el modo soporte es
-- una feature nueva de 20260714220000), el comportamiento es BYTE A BYTE el
-- mismo que antes — la rama nueva solo se alcanza cuando el chequeo original
-- YA iba a fallar (v_tenant_padre distinct from v_tenant_fila_nueva) y
-- además tabla_padre/columna_id_padre coinciden con el patrón de actor.
--
-- CÓMO VALIDAR (con el MCP, después de aplicar):
--   - Como un Super-Admin CON selección activa en super_admin_tenant_activo
--     (tenant X): insertar en invitaciones con tenant_id = X, invitado_por =
--     su propio auth.uid() -> INSERT exitoso (antes: P0001).
--   - Mismo Super-Admin: insertar en documentos con tenant_id = X, creado_por
--     forzado a su propio auth.uid() (forzar_creado_por_documentos ya lo
--     hace) -> INSERT exitoso.
--   - Un Admin real de tenant A sigue SIN poder crear una invitación con
--     invitado_por = uid de un usuario de tenant B (no Super-Admin): sigue
--     P0001, sin cambios.
--   - Un Admin real de tenant A intentando forjar invitado_por = uid REAL de
--     un Super-Admin de plataforma: sigue P0001 (RLS de super_admins lo
--     bloquea, ver "POR QUÉ ES SEGURA" arriba).
--   - Correr la suite pgTAP
--     supabase/tests/database/20260716_verificar_tenant_padre_super_admin.test.sql.
--   - Re-correr supabase/tests/database/20260713_rls_aislamiento_multitenant.test.sql
--     y supabase/tests/database/20260714_super_admin_soporte.test.sql (cero
--     regresión esperada: ninguna de las dos ejercita un Super-Admin creando
--     invitaciones/documentos hoy).
--
-- PLAN DE REVERSIÓN (pensado, no ejecutado automáticamente): re-crear
-- public.verificar_tenant_padre() tal como quedó en 20260713090000 (sin la
-- rama de excepción de super_admins) — el resto del proyecto (14 triggers
-- attacheados) sigue funcionando igual, solo se pierde la excepción.
-- =============================================================================

create or replace function public.verificar_tenant_padre()
returns trigger
language plpgsql
set search_path = ''
as $fn$
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
    -- EXCEPCIÓN (20260716090000, AUTH-8): un Super-Admin de plataforma en
    -- modo soporte "es" el tenant seleccionado (current_tenant_id()/
    -- is_admin(), 20260714221000) con ACCESO TOTAL nivel Admin, pero por
    -- diseño NO tiene fila propia en usuarios_tenants (no es miembro de
    -- ningún tenant) — la subconsulta de arriba nunca encuentra su tenant,
    -- así que v_tenant_padre queda NULL aunque la referencia sea legítima
    -- (ej. documentos.creado_por / invitaciones.invitado_por = el propio
    -- Super-Admin actuando en soporte). Acotada EXCLUSIVAMENTE al caso "la
    -- columna referenciada es un actor" (tabla_padre = usuarios_tenants,
    -- columna_id_padre = usuario_id) — jamás a columnas de entidades de
    -- negocio (subcliente_id, ruta_id, zona_id, documento_id, paquete_id,
    -- etc.), donde un uuid de Super-Admin nunca debería considerarse una
    -- referencia válida. Segura sin `security definer`: el `exists` de abajo
    -- corre con los privilegios del llamador, sujeto a la RLS real de
    -- super_admins (deny-by-default salvo que el LLAMADOR mismo sea
    -- Super-Admin) — un Admin de tenant A que intente forjar esta columna
    -- con el uuid real de un Super-Admin sigue bloqueado, ver nota de diseño
    -- extensa en el header de la migración.
    if v_tabla_padre = 'usuarios_tenants'
       and v_columna_id_padre = 'usuario_id'
       and exists (select 1 from public.super_admins sa where sa.usuario_id = v_valor_fk)
    then
      return NEW;
    end if;

    raise exception
      'Aislamiento multi-tenant violado: %.% = % pertenece a un tenant distinto del de la fila (tenant_id = %)',
      v_tabla_padre, v_columna_fk, v_valor_fk, v_tenant_fila_nueva;
  end if;

  return NEW;
end;
$fn$;

comment on function public.verificar_tenant_padre() is
  'Trigger genérico: valida que NEW.tenant_id coincida con el tenant_id de la '
  'fila padre referenciada (argumentos: columna_fk, tabla_padre[, columna_id_padre '
  '(default id)]). Guardia de integridad referencial multi-tenant, reutilizado '
  'por varias tablas. EXCEPCIÓN (20260716090000, AUTH-8): cuando tabla_padre = '
  'usuarios_tenants y columna_id_padre = usuario_id (columnas de ACTOR/identidad '
  '— documentos.creado_por, invitaciones.invitado_por), un valor que exista en '
  'public.super_admins se acepta aunque no tenga fila en usuarios_tenants (un '
  'Super-Admin de plataforma no es miembro de ningún tenant, pero en modo '
  'soporte opera con acceso total nivel Admin, AUTH-8). Nunca aplica a columnas '
  'de entidades de negocio (subcliente_id, ruta_id, zona_id, documento_id, '
  'paquete_id, etc.).';
