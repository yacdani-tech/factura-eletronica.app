-- =============================================================================
-- Migración: public.datos_invitacion(p_token text) — SECURITY DEFINER,
-- ejecutable por anon, para la página pública de invitación (REG-1)
-- -----------------------------------------------------------------------------
-- IMPACTO: una función nueva. Cero cambios de esquema/columnas/políticas/datos
-- en `invitaciones`/`tenants`. No toca `aceptar_invitacion()` ni ninguna RLS
-- existente. Parte de la decisión de Yac de cerrar el /registro público de
-- staff: la creación de cuenta pasa a ocurrir SOLO desde el enlace de
-- invitación, y esa página (sin sesión todavía) necesita poder mostrarle al
-- invitado a qué correo/courier/rol corresponde su enlace ANTES de que inicie
-- sesión o cree su cuenta (para fijar el correo en el formulario y mostrar el
-- nombre del courier).
-- ES DESTRUCTIVA: no.
--
-- CONTRATO:
--   - Recibe el token (texto plano de la URL de invitación; único). Busca
--     SOLO por token exacto — nunca por email ni por tenant (ver "no
--     enumeración" más abajo).
--   - Devuelve 0 o 1 fila con: email, tenant_nombre (de tenants, por el
--     tenant_id de la invitación), rol (rol_usuario), vigente (boolean:
--     estado='pendiente' AND expira_en > now() — mismo criterio de
--     vencimiento DERIVADO que ya usa aceptar_invitacion(), nunca lee un
--     'expirada' materializado, ver 20260714210000).
--   - Token inexistente -> 0 filas (RETURNS TABLE vacío; el llamador via
--     PostgREST recibe `[]`). Token existente pero cancelada/aceptada/vencida
--     -> 1 fila con vigente=false (mismos datos de esa invitación: email,
--     tenant_nombre, rol). La UI decide el mensaje ("este enlace ya se usó/
--     venció") a partir de `vigente`, no de un código de error — mismo
--     patrón de "0 filas = no existe / no autorizado" que ya usa RLS en el
--     resto del proyecto.
--   - Tipo de retorno: `returns table (email text, tenant_nombre text, rol
--     public.rol_usuario, vigente boolean)`. Se eligió TABLE (no un
--     composite con CREATE TYPE aparte, ni un solo record) porque: (a) es
--     exactamente lo que PostgREST necesita para exponer una fila plana en el
--     RPC sin type adicional que mantener; (b) 0 filas para "no existe" es
--     más idiomático que NULL en cada columna de una sola fila, y evita que
--     el cliente tenga que distinguir "fila con todos NULL" de "no hay
--     invitación" — con TABLE, "no hay fila" es inequívoco.
--
-- QUÉ SE EXPONE Y POR QUÉ ES SEGURO (mismo criterio que aceptar_invitacion(),
-- que ya opera sobre el token sin exigir sesión):
--   - El TOKEN ES EL SECRETO que autoriza ver esto: son 32 bytes aleatorios
--     (`encode(gen_random_bytes(32), 'hex')`, columna `token` con constraint
--     UNIQUE) — no adivinable por fuerza bruta ni enumerable. Quien lo tiene
--     (llegó por el enlace que el Admin envió a ESE correo) ya está
--     autorizado a saber a qué correo/courier/rol corresponde SU PROPIA
--     invitación — es la misma información que ya iba a ver en la página de
--     aceptación.
--   - Se expone: email, tenant_nombre, rol, vigente — de ESA invitación
--     únicamente (JOIN por `i.token = p_token`, nunca por email/tenant
--     sueltos). NO se expone: el propio `token` (no está en el SELECT ni en
--     el tipo de retorno — ver test "no expone el token" más abajo), ninguna
--     otra fila de `invitaciones` (no hay forma de pedir "todas las
--     pendientes de tenant X" ni "la invitación de email Y" — la función
--     solo acepta `p_token text`, un solo argumento), ni nada de
--     `usuarios`/`usuarios_tenants`/`super_admins`.
--   - NO enumeración: la función no acepta email ni tenant_id como parámetro
--     — physically no hay forma de sondear "¿existe una invitación para
--     fulano@dominio.com?" sin ya tener el token de ESA invitación. Un token
--     inexistente y uno cancelado son indistinguibles en cuanto a "no te dejo
--     avanzar" desde la UI (0 filas vs. 1 fila con vigente=false); ninguno de
--     los dos casos permite deducir si el email/tenant existen para OTRO
--     token que no se tiene.
--
-- GRANTS (a propósito, DISTINTO de aceptar_invitacion()/current_rol()/
-- is_admin(), que revocan execute de anon): esta función SÍ la llama un
-- usuario SIN sesión — es el punto del feature (REG-1: la página de
-- invitación se ve antes de loguearse/crear cuenta). Seguro porque: (1) es
-- SECURITY DEFINER de solo LECTURA (no muta nada); (2) el único "poder" que
-- da es leer una invitación puntual por su propio secreto (no hay
-- enumeración, ver arriba); (3) no depende de current_tenant_id()/is_admin()
-- (esas devuelven NULL/false para anon de cualquier forma) — la función lee
-- `invitaciones`/`tenants` directo, bypasseando su RLS por diseño, igual que
-- aceptar_invitacion(). `search_path = ''` (mismo patrón del proyecto);
-- `stable` (solo lectura, sin efectos secundarios, ayuda al planner).
--
-- OJO no-recursión / no-RLS-loop: SECURITY DEFINER, no depende de
-- current_tenant_id()/is_admin() (que en el caso de anon serían NULL/false de
-- todas formas). No hay trigger ni política que dispare esta función — es de
-- solo lectura, invocada directo desde la app.
--
-- CÓMO VALIDAR (con el MCP, después de aplicar):
--   - Token de una invitación pendiente y vigente -> 1 fila, email/
--     tenant_nombre/rol correctos, vigente=true.
--   - Token de una invitación pendiente pero con expira_en pasado -> 1 fila,
--     mismos datos, vigente=false.
--   - Token de una invitación cancelada -> 1 fila, vigente=false.
--   - Token de una invitación ya aceptada -> 1 fila, vigente=false.
--   - Token inexistente -> 0 filas.
--   - `select token from public.datos_invitacion('<token>')` -> error 42703
--     (columna "token" no existe en el tipo de retorno): confirma que el
--     token no se re-expone en la respuesta.
--   - Como `anon` (sin `set request.jwt.claims`, rol de sesión `anon`):
--     `select * from public.datos_invitacion('<token>')` funciona sin 42501.
--   - Correr la suite pgTAP
--     supabase/tests/database/20260714_datos_invitacion.test.sql.
--
-- PLAN DE REVERSIÓN (pensado, no ejecutado automáticamente):
--   drop function if exists public.datos_invitacion(text);
-- =============================================================================

create or replace function public.datos_invitacion(p_token text)
returns table (
  email         text,
  tenant_nombre text,
  rol           public.rol_usuario,
  vigente       boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return query
  select
    i.email,
    t.nombre as tenant_nombre,
    i.rol,
    (i.estado = 'pendiente' and i.expira_en > now()) as vigente
  from public.invitaciones i
  join public.tenants t on t.id = i.tenant_id
  where i.token = p_token;
end;
$$;

comment on function public.datos_invitacion(text) is
  'Lectura pública (REG-1, SECURITY DEFINER) de una invitación por su token: '
  'para que la página de invitación (sin sesión todavía) muestre a qué '
  'correo/courier/rol corresponde el enlace, antes de crear la cuenta. Busca '
  'SOLO por token exacto (secreto de 32 bytes, no enumerable) — no acepta '
  'email ni tenant_id como parámetro. 0 filas = token inexistente; 1 fila con '
  'vigente=false = token existente pero cancelada/aceptada/vencida (mismo '
  'criterio de vencimiento DERIVADO que aceptar_invitacion(), expira_en > '
  'now(), nunca lee un estado "expirada" materializado — ver 20260714210000). '
  'NO expone la columna token ni ninguna otra fila/invitación. Ejecutable por '
  'anon a propósito (a diferencia de aceptar_invitacion()/current_rol()/'
  'is_admin(), que la revocan): es de solo lectura, sin enumeración posible, y '
  'no depende de current_tenant_id()/is_admin(). Ver nota de diseño completa '
  'en 20260714230000.';

revoke all on function public.datos_invitacion(text) from public;
grant execute on function public.datos_invitacion(text) to anon;
grant execute on function public.datos_invitacion(text) to authenticated;
