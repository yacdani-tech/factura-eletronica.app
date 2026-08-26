-- =============================================================================
-- Migración: invitaciones — el SELECT también pasa a exigir Admin (token
-- dejaba de ser legible por cualquier miembro del tenant)
-- -----------------------------------------------------------------------------
-- IMPACTO: una sola tabla, `public.invitaciones`. Reemplaza la política
-- `invitaciones_ver_mismo_tenant` (creada en 20260714201000) por
-- `invitaciones_ver_admin`. Cero cambios de esquema/columnas/datos; solo
-- estrecha permisos de SELECT (de "cualquier miembro activo del tenant" a
-- "solo Admin activo del propio tenant"). INSERT/UPDATE/DELETE de
-- `invitaciones` NO cambian acá (ya exigían is_admin() desde 20260714201000).
-- ES DESTRUCTIVA: no. Ningún dato existente se pierde ni cambia; un
-- Operador/Contador que hoy lee `invitaciones` vía la API directa (no vía UI,
-- que hasta ahora mostraba la lista igual a los 3 roles) empezará a recibir
-- 0 filas donde antes veía las invitaciones de su tenant — es exactamente el
-- endurecimiento pedido.
--
-- POR QUÉ (hallazgo del revisor, cierre de la tarea 1.2, 2026-07-14):
-- `invitaciones.token` es, en los hechos, LA CREDENCIAL del enlace de
-- invitación (quien lo tiene puede llamar a `aceptar_invitacion(token)` y
-- unirse al tenant con el rol de la invitación). La política
-- `invitaciones_ver_mismo_tenant` (20260714201000, líneas ~248-251) era
-- `for select using (tenant_id = current_tenant_id())` SIN exigir
-- `is_admin()` — a diferencia de INSERT/UPDATE/DELETE de la misma migración,
-- que sí lo exigían. Resultado: cualquier miembro ACTIVO del tenant (un
-- Operador o Contador, no solo el Admin que gestiona staff) podía leer, vía
-- PostgREST, el token de CUALQUIER invitación pendiente de su tenant —
-- incluida una que no fue dirigida a él — y usarlo para aceptarla en nombre
-- del correo real del invitado si además controlara/adivinara esa cuenta, o
-- simplemente enterarse del enlace de invitación de otra persona.
--
-- MITIGACIÓN YA EXISTENTE (por qué esto era deuda, no un exploit directo, y
-- por qué se corrige igual): `aceptar_invitacion()` (20260714202000/210000)
-- exige que el correo del usuario AUTENTICADO coincida (case-insensitive)
-- con `invitaciones.email`, y `usuarios_tenants` es 1:1 por PK — así que
-- filtrar el token de una invitación ajena no le sirve a quien la lee para
-- aceptarla él mismo (su propio correo no matchea). Pero es exactamente el
-- tipo de superficie que NO queremos dejar abierta sin necesidad — decisión
-- explícita de Yac (ver contexto del encargo): no dejarla silenciosa.
--
-- FIX (opción más simple, sin vistas security-definer que ensucien
-- advisors): el SELECT de `invitaciones` pasa a exigir TAMBIÉN
-- `private.is_admin()`, igual que ya lo exigen INSERT/UPDATE/DELETE desde
-- 20260714201000 — las 4 operaciones quedan con el MISMO criterio
-- (tenant_id = current_tenant_id() AND is_admin()). Sin bypass de
-- Super-Admin a propósito (mismo criterio que la política original: ver
-- nota de diseño de 20260714201000, "Plataforma.app no gestiona invitaciones
-- de staff de un courier ajeno en el flujo actual").
--
-- CONSECUENCIA ACEPTADA (decisión de Yac, no un efecto colateral a corregir
-- después sin avisar): Operador y Contador dejan de VER la lista de
-- invitaciones pendientes de su equipo. El spec (AUTH-3) describe las
-- invitaciones como flujo del Admin, así que esto es una lectura razonable,
-- no una regresión de un caso de uso documentado. En la app
-- (`apps/web/lib/staff/datos.ts` -> `obtenerEquipo()`), el SELECT de
-- `invitaciones` con el cliente del usuario simplemente devuelve `[]` para
-- un no-admin (RLS filtra filas, no lanza error) — `TablaInvitaciones`
-- (`apps/web/components/staff/tabla-invitaciones.tsx`) ya maneja el arreglo
-- vacío mostrando el texto `textosStaff.equipo.sinInvitaciones` ("No hay
-- invitaciones pendientes."), así que NO rompe tipos ni render; el único
-- efecto de UX es que ese mensaje será técnicamente impreciso para un
-- Operador/Contador con invitaciones pendientes reales (verán "no hay"
-- cuando sí las hay, simplemente no puede verlas) — aceptado por Yac como
-- fácil de relajar después (ej. una vista sin `token` si algún día se quiere
-- que no-admin vea la lista sin el secreto). El comentario de
-- `obtenerEquipo()` en ese archivo todavía describe la visibilidad VIEJA
-- ("la RLS de invitaciones ya lo expone a CUALQUIER miembro del tenant") —
-- queda desactualizado tras esta migración; no se edita en esta migración
-- (fuera del alcance de un cambio de esquema/RLS puro) pero se deja
-- señalado acá para que backend-app lo actualice en su próximo toque de ese
-- archivo. Ninguna Server Action de `apps/web/lib/staff/acciones.ts`
-- (crearInvitacion/reenviarInvitacion/cancelarInvitacion) se ve afectada:
-- las 3 arrancan con `exigirPermiso("staff:gestionar")`, que ya es
-- exclusivo de Admin (`apps/web/lib/permisos/index.ts`) — sus lecturas de
-- `invitaciones` con el cliente del usuario ya corrían (y seguirán
-- corriendo) como Admin.
--
-- NO ROMPE `aceptar_invitacion()`: es SECURITY DEFINER (20260714202000/
-- 210000), con `set search_path = ''` y sin bypass de rol declarado en la
-- función misma — el privilegio real de saltar RLS lo aporta el OWNER de la
-- función (el rol que corre las migraciones, típicamente `postgres` en
-- Supabase, con atributo BYPASSRLS — documentado y confirmado contra la BD
-- remota real en 20260714211000/202000). Esta migración no toca el owner ni
-- el cuerpo de esa función: el invitado, que todavía no tiene membresía ni
-- `current_tenant_id()` propio (y por lo tanto tampoco `is_admin()`), sigue
-- pudiendo leer y bloquear (`for update`) su propia invitación por `token` y
-- crear su membresía, exactamente igual que antes de este cambio.
--
-- CÓMO VALIDAR (con el MCP, después de aplicar):
--   - list_tables / políticas: `invitaciones` debe tener 4 políticas
--     (`invitaciones_ver_admin`, `invitaciones_insertar_admin`,
--     `invitaciones_actualizar_admin`, `invitaciones_eliminar_admin`), ya NO
--     `invitaciones_ver_mismo_tenant`.
--   - Como Operador o Contador (rol≠admin) autenticado, con invitaciones
--     pendientes reales en su tenant: `select * from public.invitaciones`
--     debe devolver 0 filas (no error, RLS filtra).
--   - Como Admin activo de su propio tenant: `select * from
--     public.invitaciones` sigue devolviendo las invitaciones de su tenant,
--     sin cambios.
--   - Como Admin de un tenant leyendo invitaciones de OTRO tenant: sigue
--     devolviendo 0 filas (tenant_id no coincide) — sin cambios.
--   - `aceptar_invitacion('<token>')` como el usuario invitado (sin
--     membresía, por lo tanto sin is_admin()) sigue funcionando igual que
--     antes (camino feliz, vencida, email distinto, ya con membresía, token
--     inexistente) — la función es SECURITY DEFINER y no pasa por esta RLS.
--   - Correr la suite pgTAP actualizada
--     supabase/tests/database/20260714_auth_roles_y_rls_admin.test.sql.
--
-- PLAN DE REVERSIÓN (pensado, no ejecutado automáticamente):
--   drop policy invitaciones_ver_admin on public.invitaciones;
--   create policy invitaciones_ver_mismo_tenant on public.invitaciones
--     for select
--     to authenticated
--     using (tenant_id = (select private.current_tenant_id()));
--   -- (no recomendado: reabre el hallazgo del revisor — invitaciones.token
--   -- volvería a ser legible por cualquier miembro activo del tenant.)
-- =============================================================================

drop policy invitaciones_ver_mismo_tenant on public.invitaciones;

create policy invitaciones_ver_admin on public.invitaciones
  for select
  to authenticated
  using (
    tenant_id = (select private.current_tenant_id())
    and (select private.is_admin())
  );

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
  'RLS.';
