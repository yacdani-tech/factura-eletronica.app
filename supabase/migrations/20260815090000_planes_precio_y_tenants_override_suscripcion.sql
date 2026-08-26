-- =============================================================================
-- Migración: precio de suscripción — `planes.precio_mensual_usd` (por plan) +
-- `tenants.precio_suscripcion_usd` (override por tenant). Primer paso de la
-- feature "cobro de la suscripción a los couriers" (greenfield en BD,
-- aprobada por Yac 2026-08-15).
-- -----------------------------------------------------------------------------
-- IMPACTO: agrega 1 columna nullable a `public.planes` y 1 columna nullable a
-- `public.tenants`, MÁS 1 función y 1 trigger BEFORE UPDATE nuevos sobre
-- `public.tenants` (guard column-level de `precio_suscripcion_usd`, ver
-- DECISIÓN DE SEGURIDAD más abajo — agregado tras corrección del coordinador,
-- no en la versión original de esta migración). Ninguna fila existente
-- cambia de valor (ambas columnas nacen NULL para todas las filas actuales —
-- sin seed de precios reales, Yac los fija por UI más adelante). No se crea
-- RLS nueva: ambas tablas ya tienen política de UPDATE reservada a
-- super-admin (`planes_actualizar_super_admin`, 20260713090100) o a "propio
-- tenant o super-admin" (`tenants_editar_propio_o_super_admin`/`tenants_
-- editar_propio_admin`, 20260713090200/20260714201000) — el trigger nuevo es
-- defensa EN PROFUNDIDAD sobre esa segunda política, no un reemplazo de RLS.
-- ES DESTRUCTIVA: no. Dos `alter table add column` nullable (sin default
-- distinto de NULL, sin backfill) + 1 función/trigger puramente aditivos.
--
-- DISEÑO (decisión de Yac 2026-08-15, fija):
--   - Precio EFECTIVO de la suscripción de un tenant = `coalesce(tenants.
--     precio_suscripcion_usd, planes.precio_mensual_usd, 0)` — el override
--     por tenant gana si existe; si no, el precio del plan asignado; si el
--     tenant no tiene plan o el plan no tiene precio, 0 (evita romper la
--     generación de facturas de suscripción cuando falta configurar precios,
--     en vez de fallar la RPC de generación — ver
--     `20260815094000_suscripcion_rpcs_generacion.sql`).
--   - Moneda: USD únicamente (regla dura #5 — la suscripción de la
--     plataforma no tiene moneda local ni tipo de cambio, a diferencia de las
--     facturas del courier a sus subclientes).
--   - `numeric` (nunca float), CHECK >= 0 en ambas columnas (nulo = "sin
--     precio definido", nunca un precio negativo).
--
-- DECISIÓN DE SEGURIDAD — guard column-level de `precio_suscripcion_usd`
-- (corrección del coordinador tras revisión, 2026-08-15; NO estaba en la
-- primera versión de esta migración): `tenants_editar_propio_o_super_admin`/
-- `tenants_editar_propio_admin` (20260713090200/20260714201000) son políticas
-- de UPDATE a nivel de FILA, no de columna — el Admin del propio tenant YA
-- puede editar CUALQUIER columna de su propia fila de `tenants` hoy
-- (unidad_entrada, minimo_cobro, plan_id, incluso `estado`) vía un PATCH
-- directo a PostgREST. Para `precio_suscripcion_usd` eso es un agujero de
-- dinero real (un Admin podría ponerse `precio_suscripcion_usd = 0` y anular
-- su propio cobro de plataforma) — a diferencia de `estado`/`plan_id`, que SÍ
-- tienen el mismo agujero pero quedan FUERA de alcance de esta migración
-- puntual (gap preexistente, señalado aparte al coordinador/Yac).
--
-- SÍ existe precedente exacto en el proyecto para cerrar esto a nivel de BD:
-- `public.proteger_email_usuario()` (20260713090200, líneas ~121-144) —
-- trigger BEFORE UPDATE sobre `usuarios.email` que rechaza el cambio salvo
-- `current_user = 'service_role'`, "defensa en profundidad ante una policy de
-- UPDATE amplia". Este guard replica ESE patrón: `public.
-- proteger_precio_suscripcion_tenant()` rechaza cualquier cambio de
-- `precio_suscripcion_usd` salvo que la sesión sea super-admin
-- (`private.is_super_admin()`) o el rol activo sea `service_role`.
--
-- RAZONAMIENTO VERIFICADO (por qué la RPC `public.
-- actualizar_precio_suscripcion_tenant`, SECURITY DEFINER, SIGUE pasando este
-- guard): dentro de una función SECURITY DEFINER, `current_user` pasa a ser
-- el DUEÑO de la función (postgres) durante TODA la ejecución, incluidos los
-- triggers disparados por sus propias sentencias DML — por eso este guard NO
-- puede depender de `current_user` para reconocer a la RPC. Pero
-- `private.is_super_admin()` resuelve vía `auth.uid()`, que lee la GUC de
-- sesión `request.jwt.claims` — una GUC NO cambia al entrar a una función
-- SECURITY DEFINER (mismo mecanismo ya documentado para `private.
-- current_tenant_id()`/`private.is_super_admin()` en el aprendizaje de
-- arquitecto-db 2026-07-17 sobre `siguiente_contador()`). Como la propia RPC
-- ya exige `is_super_admin()` ANTES de ejecutar el UPDATE, el trigger, al
-- evaluar `private.is_super_admin()` en ese mismo UPDATE, ve la MISMA sesión
-- real (el super-admin que invocó la RPC) y también da `true` — el guard deja
-- pasar el UPDATE de la RPC sin fricción, aunque `current_user` dentro de ese
-- UPDATE sea `postgres`, no `service_role`.
--
-- CÓMO VALIDAR (con `supabase db query --linked`, después de aplicar):
--   - `information_schema.columns`: `planes.precio_mensual_usd` y `tenants.
--     precio_suscripcion_usd` existen, tipo `numeric`, nullable.
--   - `insert/update` con un valor negativo en cualquiera de las 2 falla con
--     23514 (CHECK).
--   - Ninguna fila existente de `planes`/`tenants` tiene el valor alterado
--     (siguen en NULL, salvo que alguien ya las haya seteado manualmente
--     antes de esta migración, lo cual no aplica en greenfield).
--   - `pg_trigger`: `trg_tenants_proteger_precio_suscripcion` existe (BEFORE
--     UPDATE) sobre `public.tenants`.
--   - Como Admin autenticado de un tenant (no super-admin): `update tenants
--     set precio_suscripcion_usd = 0 where id = <su propio tenant>` falla con
--     P0001 (rechazado por el trigger, aunque la RLS de fila lo dejaría
--     pasar).
--   - Como super-admin: el mismo UPDATE directo SÍ pasa; y `select public.
--     actualizar_precio_suscripcion_tenant(<tenant>, <precio>)` también pasa
--     (RPC SECURITY DEFINER, ver RAZONAMIENTO VERIFICADO arriba).
--   - Correr `supabase/tests/database/20260815_suscripcion_facturas.test.sql`
--     (cubre el `coalesce` de precio efectivo indirectamente, vía las RPC de
--     generación, y el guard column-level nuevo).
-- PLAN DE REVERSIÓN (pensado, no ejecutado automáticamente):
--   drop trigger if exists trg_tenants_proteger_precio_suscripcion on public.tenants;
--   drop function if exists public.proteger_precio_suscripcion_tenant();
--   alter table public.tenants drop column if exists precio_suscripcion_usd;
--   alter table public.planes drop column if exists precio_mensual_usd;
-- =============================================================================

alter table public.planes
  add column precio_mensual_usd numeric
    check (precio_mensual_usd is null or precio_mensual_usd >= 0);

comment on column public.planes.precio_mensual_usd is
  'Precio mensual en USD del plan (regla dura #5: numeric, USD, sin moneda '
  'local ni tipo de cambio — la suscripción de la plataforma es un cobro '
  'aparte del cobro del courier a sus subclientes). NULL = sin precio '
  'definido (el efectivo del tenant cae a 0 vía coalesce si tampoco tiene '
  'override). Editable solo por super-admin (RLS ya existente '
  'planes_actualizar_super_admin, 20260713090100). Sin seed de valores '
  'reales: Yac los fija por UI.';

alter table public.tenants
  add column precio_suscripcion_usd numeric
    check (precio_suscripcion_usd is null or precio_suscripcion_usd >= 0);

comment on column public.tenants.precio_suscripcion_usd is
  'Override en USD del precio de suscripción de ESTE tenant, por encima del '
  'precio de su plan (planes.precio_mensual_usd). NULL = "usar el precio del '
  'plan" (sin override). Precio EFECTIVO = coalesce(tenants.'
  'precio_suscripcion_usd, planes.precio_mensual_usd, 0), calculado en '
  'public.asegurar_facturas_suscripcion (20260815094000). Mutable vía '
  'public.actualizar_precio_suscripcion_tenant (super-admin, '
  '20260815096000) O directo por UPDATE si la sesión es super-admin/'
  'service_role — cualquier otro intento de cambiarla (incluido el propio '
  'Admin del tenant, vía la RLS de fila que sí permite editar el resto de '
  'la fila) es rechazado por el trigger trg_tenants_proteger_precio_'
  'suscripcion (ver DECISIÓN DE SEGURIDAD en el header de esta migración).';

-- -----------------------------------------------------------------------------
-- Guard column-level de precio_suscripcion_usd (defensa en profundidad sobre
-- la RLS de fila tenants_editar_propio_o_super_admin/tenants_editar_propio_
-- admin, que NO restringe por columna) — mismo patrón EXACTO que
-- public.proteger_email_usuario() (20260713090200): rechaza el cambio salvo
-- super-admin o service_role. Ver DECISIÓN DE SEGURIDAD y RAZONAMIENTO
-- VERIFICADO en el header de esta migración.
-- -----------------------------------------------------------------------------
create or replace function public.proteger_precio_suscripcion_tenant()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if NEW.precio_suscripcion_usd is distinct from OLD.precio_suscripcion_usd
     and not (select private.is_super_admin())
     and current_user <> 'service_role' then
    raise exception
      'El precio de suscripción del tenant % solo lo ajusta la plataforma (super-admin), vía public.actualizar_precio_suscripcion_tenant.',
      OLD.id;
  end if;
  return NEW;
end;
$fn$;

comment on function public.proteger_precio_suscripcion_tenant() is
  'Trigger BEFORE UPDATE (defensa en profundidad, mismo patrón que '
  'proteger_email_usuario, 20260713090200): rechaza cambios de tenants.'
  'precio_suscripcion_usd salvo cuando la sesión es super-admin (private.'
  'is_super_admin(), vía auth.uid()/GUC de sesión -- NO cambia al entrar a '
  'una función SECURITY DEFINER, por eso public.actualizar_precio_'
  'suscripcion_tenant sigue pasando este guard aunque corra con '
  'current_user=postgres) o cuando el rol activo es service_role (backend '
  'de confianza). Sin este guard, tenants_editar_propio_o_super_admin/'
  'tenants_editar_propio_admin (políticas de fila, no de columna) '
  'permitirían a cualquier Admin de tenant auto-asignarse un '
  'precio_suscripcion_usd arbitrario (incluido 0) vía PostgREST directo.';

create trigger trg_tenants_proteger_precio_suscripcion
  before update on public.tenants
  for each row
  execute function public.proteger_precio_suscripcion_tenant();

-- Nota: SIN revoke de EXECUTE sobre proteger_precio_suscripcion_tenant() —
-- `returns trigger` (no SECURITY DEFINER, no invocable fuera de un contexto
-- de trigger): mismo criterio que proteger_email_usuario/
-- proteger_inmutabilidad_documento/proteger_inmutabilidad_suscripcion_
-- factura, ninguna de las cuales lleva revoke tampoco.
