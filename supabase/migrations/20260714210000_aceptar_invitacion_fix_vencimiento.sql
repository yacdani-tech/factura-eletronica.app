-- =============================================================================
-- Migración: fix de aceptar_invitacion() — el UPDATE a 'expirada' era código
-- muerto que nunca persiste (RAISE EXCEPTION revierte TODA la transacción)
-- -----------------------------------------------------------------------------
-- IMPACTO: solo el cuerpo de public.aceptar_invitacion(text) (create or
-- replace) + sus comentarios (función y tabla invitaciones). Cero cambios de
-- esquema/columnas/políticas/permisos. `public.aceptar_invitacion(text)` YA
-- fue aplicada a la BD remota por 20260714202000 (bloqueante encontrado en la
-- primera corrida real de la suite pgTAP contra el proyecto real: 48/56, ver
-- hallazgo 4 del pase de validación 2026-07-14); esta migración corrige la
-- función IN PLACE. 20260714202000 NO se edita (ya fue aplicada con ese
-- contenido; historia local y remota deben contar la misma historia).
-- ES DESTRUCTIVA: no. Ninguna fila de `invitaciones` existente cambia de
-- estado con esta migración (solo cambia el comportamiento de la función
-- hacia adelante).
--
-- BUG REAL (no era un artefacto de la suite de test): el diseño original
-- hacía, dentro de la misma función, "UPDATE invitaciones SET estado =
-- 'expirada' ... ; RAISE EXCEPTION ..." para el caso "pendiente pero vencida".
-- Eso es imposible en Postgres/PL-pgSQL: un RAISE EXCEPTION no capturado
-- revierte TODOS los efectos de la transacción de la llamada — incluido el
-- UPDATE que se acababa de ejecutar unas líneas antes, en la MISMA
-- transacción. El UPDATE nunca sobrevivía ni siquiera en producción real
-- (una llamada RPC de PostgREST abre una transacción por request; si la
-- función termina con una excepción no atrapada, PostgREST hace ROLLBACK de
-- esa transacción completa) — no era un efecto de que pgTAP envuelva la
-- prueba en un savepoint. Detectado en la corrida real contra la BD remota
-- (test "la invitación vencida quedó marcada expirada": esperaba 'expirada',
-- encontró 'pendiente').
--
-- FIX: se elimina el UPDATE muerto. La función sigue rechazando con el mismo
-- mensaje de vencimiento (RAISE, sin cambios de UX/mensaje), pero YA NO
-- INTENTA persistir 'expirada' — ese INTENTO era el bug. Consecuencia
-- aceptada, documentada explícitamente en los comentarios de la función y de
-- la tabla: una invitación vencida queda en estado 'pendiente' en BD para
-- siempre (a menos que algo MÁS la marque expirada explícitamente, en su
-- propia transacción separada); su condición de "vencida" es DERIVADA —
-- se calcula comparando expira_en <= now(), nunca leyendo el estado
-- persistido. El valor 'expirada' del enum estado_invitacion NO se elimina
-- (sigue siendo válido/consultable) y queda disponible para que un flujo
-- FUERA de aceptar_invitacion() lo materialice si hace falta (ej. un query o
-- job de backoffice que liste/limpie invitaciones vencidas — candidato para
-- una tarea de Fase 4, fuera del alcance de esta migración).
--
-- CÓMO VALIDAR (con el MCP, después de aplicar):
--   - Invitación pendiente con expira_en en el pasado -> aceptar_invitacion()
--     sigue fallando P0001 con el mensaje de vencimiento, PERO
--     invitaciones.estado sigue siendo 'pendiente' después del intento (no
--     'expirada').
--   - Reintentar la misma invitación vencida una segunda vez -> sigue
--     fallando con el MISMO mensaje de vencimiento (el chequeo es por
--     expira_en <= now(), no depende de que algo la haya marcado antes).
--   - El resto de los caminos de aceptar_invitacion() (token inexistente,
--     estado no-pendiente ya materializado -aceptada/cancelada-, email
--     distinto, ya con membresía, camino feliz) quedan IDÉNTICOS — no se
--     tocó ninguna otra rama de la función.
--   - Correr la suite pgTAP actualizada
--     supabase/tests/database/20260714_auth_roles_y_rls_admin.test.sql.
--
-- PLAN DE REVERSIÓN (pensado, no ejecutado automáticamente): re-aplicar el
-- cuerpo de la función tal como quedó en 20260714202000 (create or replace
-- con el UPDATE + RAISE original) — no recomendado, reintroduce el bug.
-- =============================================================================

create or replace function public.aceptar_invitacion(p_token text)
returns public.usuarios_tenants
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invitacion  public.invitaciones;
  v_email       text;
  v_membresia   public.usuarios_tenants;
begin
  if (select auth.uid()) is null then
    raise exception 'Debe iniciar sesión para aceptar una invitación.';
  end if;

  -- Bloquea la fila para evitar una carrera de doble-aceptación del mismo
  -- token (dos pestañas, doble click, etc.).
  select * into v_invitacion
  from public.invitaciones
  where token = p_token
  for update;

  if not found then
    raise exception 'El enlace de invitación no es válido.';
  end if;

  -- Vencimiento DERIVADO (expira_en <= now()), nunca persistido acá: un
  -- UPDATE seguido de RAISE EXCEPTION en la misma transacción no puede
  -- sobrevivir (el RAISE revierte TODO, incluido ese UPDATE) — ver nota de
  -- diseño de 20260714210000. `invitaciones.estado` queda 'pendiente' para
  -- siempre en este camino; el enum 'expirada' sigue existiendo para que lo
  -- materialice, si hace falta, un flujo FUERA de esta función (ej. listado/
  -- limpieza de backoffice).
  if v_invitacion.estado = 'pendiente' and v_invitacion.expira_en <= now() then
    raise exception
      'Esta invitación venció el %. Solicite una nueva al Admin de su equipo.',
      to_char(v_invitacion.expira_en, 'DD/MM/YYYY HH24:MI');
  end if;

  if v_invitacion.estado <> 'pendiente' then
    raise exception
      'Esta invitación ya está en estado "%" y no se puede aceptar.',
      v_invitacion.estado;
  end if;

  select email into v_email from public.usuarios where id = (select auth.uid());

  if v_email is null then
    raise exception 'No se encontró su usuario. Intente iniciar sesión nuevamente.';
  end if;

  if lower(v_email) <> lower(v_invitacion.email) then
    raise exception
      'Esta invitación fue enviada a otro correo (%). Inicie sesión con ese correo para aceptarla.',
      v_invitacion.email;
  end if;

  if exists (select 1 from public.usuarios_tenants where usuario_id = (select auth.uid())) then
    raise exception
      'Su usuario ya pertenece a un equipo: un usuario solo puede pertenecer '
      'a un tenant (regla 1:1 del MVP). Si necesita cambiarse de equipo, '
      'contacte a soporte.';
  end if;

  begin
    insert into public.usuarios_tenants (usuario_id, tenant_id, rol, estado)
    values ((select auth.uid()), v_invitacion.tenant_id, v_invitacion.rol, 'activo')
    returning * into v_membresia;
  exception when unique_violation then
    raise exception
      'Su usuario ya pertenece a un equipo (aceptación concurrente detectada). '
      'Recargue la página.';
  end;

  update public.invitaciones set estado = 'aceptada' where id = v_invitacion.id;

  return v_membresia;
end;
$$;

comment on function public.aceptar_invitacion(text) is
  'Acepta una invitación de staff (AUTH-3) por su token: valida vigencia '
  '(rechaza si venció — expira_en <= now(), condición DERIVADA, NO persiste '
  '"expirada": un UPDATE previo al RAISE de vencimiento no sobrevive, el '
  'RAISE revierte toda la transacción; ver 20260714210000), que el correo '
  'del autenticado coincida (case-insensitive) y que no tenga membresía '
  'previa (1:1), inserta la membresía con el rol de la invitación y la marca '
  'aceptada — todo atómico. SECURITY DEFINER: el invitado aún no tiene '
  'membresía/tenant propio, así que necesita saltar la RLS de invitaciones/'
  'usuarios_tenants para leer su propia invitación por token y crear su '
  'membresía. Owner esperado: el rol que ejecuta las migraciones en el '
  'proyecto Supabase (típicamente `postgres`), con atributo BYPASSRLS — '
  'documentado como referencia defensiva para entornos futuros (ya probado '
  'contra la BD remota real con ese owner); no implica ningún cambio de '
  'comportamiento.';

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
  'todavía.';
