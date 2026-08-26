-- =============================================================================
-- Migración: auditoria.actor_soporte — marca inequívoca de acciones de
-- Super-Admin en modo soporte (3ra de 3 migraciones de la feature — ver
-- header de 20260714220000)
-- -----------------------------------------------------------------------------
-- IMPACTO: agrega 1 columna (`actor_soporte boolean not null default false`)
-- a `public.auditoria` (tabla existente, append-only) y reemplaza (create or
-- replace, misma firma) el cuerpo de `public.forzar_actor_auditoria()`. Cero
-- cambios en `public.registrar_auditoria()`, en los triggers attacheados
-- (siguen AFTER UPDATE únicamente en paquetes/documentos/subclientes, desde
-- 20260714050000) ni en las políticas RLS de `auditoria` (sigue append-only:
-- INSERT permitido con with check de tenant propio, SELECT por tenant, sin
-- UPDATE/DELETE — 20260713091000).
--
-- ES DESTRUCTIVA: no. `add column ... not null default false` en Postgres
-- 11+ escribe el default una sola vez en el catálogo (no reescribe cada fila
-- existente) — ninguna fila histórica de auditoria se toca; todas quedan con
-- actor_soporte = false (correcto: la feature de modo soporte no existía
-- cuando se generaron).
--
-- POR QUÉ (regla dura #13 + encargo explícito): toda acción que un
-- Super-Admin haga dentro de un tenant en modo soporte debe quedar auditada
-- Y ser inequívocamente identificable como acción de soporte, nunca
-- confundible con la de un miembro real del tenant. actor_id sigue siendo
-- SIEMPRE auth.uid() (el propio Super-Admin, nunca del payload) —
-- actor_soporte es la marca ADICIONAL que distingue "auth.uid() actuó como
-- miembro real" de "auth.uid() actuó en modo soporte sobre un tenant ajeno".
--
-- DISEÑO:
--   - Columna nueva en vez de tocar el enum actor_tipo_auditoria
--     ('usuario'|'sistema'): actor_soporte es un eje ORTOGONAL, no un tercer
--     valor de actor_tipo. Un Super-Admin en soporte sigue siendo
--     actor_tipo='usuario' (SÍ tiene actor_id, es una persona con sesión) —
--     lo único que cambia es EN QUÉ CALIDAD actuó. Modelarlo como un tercer
--     valor de actor_tipo rompería el CHECK auditoria_actor_coherente
--     (actor_tipo='usuario' <=> actor_id IS NOT NULL) sin necesidad: acá
--     actor_id SIEMPRE está presente.
--   - Se fuerza en public.forzar_actor_auditoria() (BEFORE INSERT en
--     auditoria, 20260713091500) — el mismo trigger que YA fuerza actor_id/
--     actor_tipo desde auth.uid(), ignorando el payload. Se agrega UNA línea:
--     `NEW.actor_soporte := (select private.tenant_soporte_activo()) is not
--     null`, ejecutada SIEMPRE (no solo dentro del `if auth.uid() is not
--     null`) — así un intento de INSERT manual (vía la política
--     auditoria_insertar_mismo_tenant, R1) con actor_soporte=true en el
--     payload, hecho por un usuario que NO es Super-Admin en soporte, queda
--     igual de imposible que falsificar actor_id: el trigger SIEMPRE
--     recalcula el valor real, nunca respeta lo que venga en NEW antes de
--     correr. Sin sesión (service_role/proceso de confianza),
--     tenant_soporte_activo() da NULL de inmediato (is_super_admin() ya
--     depende de auth.uid()) -> actor_soporte queda false, correcto (no hay
--     "soporte" sin una sesión de Super-Admin real detrás).
--   - Es IDEMPOTENTE con registrar_auditoria() (SECURITY DEFINER): esa
--     función no toca actor_soporte al armar el INSERT (deja el default de
--     la columna, false), y el trigger forzar_actor_auditoria() —que corre
--     DESPUÉS, como BEFORE INSERT de la propia tabla auditoria, sin importar
--     si el INSERT vino del trigger genérico o de un INSERT manual— recalcula
--     el valor real siempre. auth.uid() sigue funcionando igual dentro de la
--     ejecución SECURITY DEFINER de registrar_auditoria() (no depende del rol
--     efectivo, lee el claim de sesión), así que un UPDATE de un Super-Admin
--     en soporte sobre paquetes/documentos/subclientes queda correctamente
--     marcado actor_soporte=true en la fila de auditoria que genera el
--     trigger genérico.
--
-- CÓMO VALIDAR (con el MCP, después de aplicar):
--   - list_tables: auditoria con la columna actor_soporte (boolean, not null,
--     default false).
--   - Como un Admin de tenant real (no Super-Admin) haciendo un UPDATE
--     auditado: la fila de auditoria resultante tiene actor_soporte = false
--     (sin cambios respecto de antes).
--   - Como Super-Admin CON selección activa en super_admin_tenant_activo,
--     haciendo el mismo tipo de UPDATE sobre el tenant seleccionado: la fila
--     de auditoria resultante tiene actor_id = auth.uid() del Super-Admin,
--     actor_tipo = 'usuario', actor_soporte = true.
--   - Un INSERT manual a auditoria (política auditoria_insertar_mismo_tenant)
--     con actor_soporte = true en el payload, hecho por un usuario que NO es
--     Super-Admin en soporte: la fila queda igual con actor_soporte = false
--     (el trigger lo recalcula, ignora el payload).
--   - Correr la suite pgTAP
--     supabase/tests/database/20260714_super_admin_soporte.test.sql, y
--     re-correr supabase/tests/database/20260713_auditoria.test.sql (debe
--     seguir pasando igual: ninguna aserción existente depende de
--     actor_soporte, y todas las filas que genera esa suite son de usuarios
--     sin fila en super_admins).
--
-- PLAN DE REVERSIÓN (pensado, no ejecutado automáticamente):
--   -- Re-crear forzar_actor_auditoria() tal como quedó en 20260713091500
--   -- (sin la línea de actor_soporte), y:
--   alter table public.auditoria drop column actor_soporte;
-- =============================================================================

alter table public.auditoria
  add column actor_soporte boolean not null default false;

comment on column public.auditoria.actor_soporte is
  'true si actor_id actuó en MODO SOPORTE (Super-Admin de plataforma operando '
  'dentro de este tenant vía super_admin_tenant_activo, 20260714220000) en '
  'vez de como miembro real del tenant. Forzado SIEMPRE por '
  'public.forzar_actor_auditoria() desde private.tenant_soporte_activo() — '
  'nunca confiar en el valor del payload de un INSERT manual (regla dura '
  '#13). actor_id sigue siendo auth.uid() en ambos casos (siempre '
  'actor_tipo=usuario, esta columna es un eje ortogonal, no un tercer valor '
  'de actor_tipo).';

create or replace function public.forzar_actor_auditoria()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null then
    NEW.actor_id := (select auth.uid());
    NEW.actor_tipo := 'usuario';
  end if;

  -- Se recalcula SIEMPRE (no solo dentro del `if` de arriba): un intento de
  -- INSERT manual con actor_soporte=true en el payload, hecho por alguien que
  -- NO es Super-Admin en soporte, queda igual de imposible que falsificar
  -- actor_id — el trigger nunca respeta lo que venga en NEW antes de correr.
  -- Sin sesión (service_role/proceso de confianza), tenant_soporte_activo()
  -- da NULL de inmediato (depende de auth.uid()), así que actor_soporte
  -- siempre queda false para procesos de sistema.
  NEW.actor_soporte := (select private.tenant_soporte_activo()) is not null;

  return NEW;
end;
$$;

comment on function public.forzar_actor_auditoria() is
  'Trigger BEFORE INSERT: si hay sesión, fuerza auditoria.actor_id = '
  'auth.uid() y actor_tipo = usuario, ignorando el payload (nunca confiar '
  'en la identidad declarada por el cliente — regla dura #13). Desde '
  '20260714222000 también fuerza SIEMPRE actor_soporte = (el usuario '
  'autenticado tiene selección activa de modo soporte, '
  'private.tenant_soporte_activo() is not null) — ignorando igual el '
  'payload. Sin sesión (service_role/procesos de confianza) respeta el valor '
  'explícito de actor_id/actor_tipo, y actor_soporte queda false (no hay '
  '"soporte" sin una sesión de Super-Admin real detrás). Idempotente con '
  'registrar_auditoria(), que no setea actor_soporte al construir su INSERT '
  '(deja el default false; este trigger recalcula el valor real después, '
  'para cualquier origen del INSERT).';
