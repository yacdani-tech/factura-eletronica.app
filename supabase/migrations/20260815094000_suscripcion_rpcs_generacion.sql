-- =============================================================================
-- Migración: RPCs de generación de facturas de suscripción de la PLATAFORMA a
-- sus tenants. Núcleo compartido sin guard + 2 RPCs públicas con guard + 1
-- punto de entrada de SISTEMA para el cron HTTP.
-- -----------------------------------------------------------------------------
-- NOTA DE EXTRACCIÓN (factura-eletronica): adaptada del proyecto factura-eletronica.app
-- (RPCs `20260815094000` + refactor a core de `20260816130000`). CAMBIO
-- respecto al original: el disparador diario NO es `pg_cron` (que exige la
-- extensión precargada en el servidor) sino una ruta HTTP de Vercel Cron
-- (`apps/web/app/api/cron/generar-suscripciones/route.ts`, autorizada por
-- `CRON_SECRET`) que invoca vía cliente **service-role** la RPC de sistema
-- `public.asegurar_facturas_suscripcion_sistema()` de más abajo. Por eso esa
-- función vive en `public` (invocable por PostgREST) y se otorga SOLO a
-- `service_role` (nunca a `anon`/`authenticated`).
-- -----------------------------------------------------------------------------
-- IMPACTO: crea 1 función `private` (core sin guard) + 3 funciones `public`
-- (`SECURITY DEFINER`): autoservicio/super-admin por tenant, super-admin para
-- todos, y sistema (cron). Todas ESCRIBEN en `public.suscripcion_facturas`
-- (INSERT únicamente, `on conflict do nothing` — nunca UPDATE, regla dura #6).
-- ES DESTRUCTIVA: no. Sus efectos (filas nuevas) son idempotentes por diseño.
--
-- PRECIO EFECTIVO congelado al generar = `coalesce(tenants.
-- precio_suscripcion_usd, planes.precio_mensual_usd, 0)`. Ciclo vigente vía
-- `private.calcular_ciclo_consumo_vigente(tenants.fecha_alta, private.
-- hoy_en_costa_rica())`. Generación LAZY "de aquí en adelante" (sin backfill:
-- la primera factura de un tenant es la del ciclo vigente); con facturas
-- previas, rellena hacia adelante los ciclos faltantes. `fecha_emision =
-- fecha_vencimiento = periodo_inicio` ("vence al inicio del ciclo").
--
-- SEGURIDAD: el core (`private`) NO valida auth (recibe un tenant_id ya
-- confiable) y está revocado de public/anon/authenticated. Las 3 públicas:
--   - `asegurar_facturas_suscripcion(uuid)`: NULL = autoservicio
--     (private.current_tenant_id()); explícito = requiere is_super_admin().
--   - `asegurar_facturas_suscripcion_todos()`: requiere is_super_admin().
--   - `asegurar_facturas_suscripcion_sistema()`: SIN guard de auth (actor de
--     sistema, proceso sin sesión — regla dura #13), otorgada SOLO a
--     service_role: el ÚNICO llamador legítimo es el cron HTTP con la llave
--     service-role. Revocada de anon/authenticated/public.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- (a) Núcleo compartido, SIN guard de auth — recibe un tenant_id ya confiable.
-- -----------------------------------------------------------------------------
create or replace function private.asegurar_facturas_suscripcion_core(p_tenant_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_fecha_alta      date;
  v_plan_id         uuid;
  v_precio_plan     numeric;
  v_precio_override numeric;
  v_precio_efectivo numeric;
  v_hoy             date;
  v_ciclo_inicio    date;
  v_ciclo_fin       date;
  v_ultimo_fin      date;
  v_cursor          date;
  v_paso_inicio     date;
  v_paso_fin        date;
  v_creadas         integer := 0;
  v_intentos        integer := 0;
begin
  select t.fecha_alta, t.plan_id, t.precio_suscripcion_usd
    into v_fecha_alta, v_plan_id, v_precio_override
    from public.tenants t
   where t.id = p_tenant_id;

  if not found then
    raise exception 'asegurar_facturas_suscripcion_core: no se pudo resolver el tenant %.', p_tenant_id;
  end if;

  v_precio_plan := null;
  if v_plan_id is not null then
    select pl.precio_mensual_usd into v_precio_plan
      from public.planes pl
     where pl.id = v_plan_id;
  end if;

  v_precio_efectivo := coalesce(v_precio_override, v_precio_plan, 0);

  v_hoy := private.hoy_en_costa_rica();

  select c.ciclo_inicio, c.ciclo_fin
    into v_ciclo_inicio, v_ciclo_fin
    from private.calcular_ciclo_consumo_vigente(v_fecha_alta, v_hoy) as c;

  select max(sf.periodo_fin) into v_ultimo_fin
    from public.suscripcion_facturas sf
   where sf.tenant_id = p_tenant_id;

  if v_ultimo_fin is null then
    -- Generación LAZY "de aquí en adelante": la primera factura del tenant es
    -- SIEMPRE la del ciclo vigente, sin backfill histórico.
    insert into public.suscripcion_facturas (
      tenant_id, periodo_inicio, periodo_fin, monto_usd, fecha_emision, fecha_vencimiento
    ) values (
      p_tenant_id, v_ciclo_inicio, v_ciclo_fin, v_precio_efectivo, v_ciclo_inicio, v_ciclo_inicio
    )
    on conflict (tenant_id, periodo_inicio) do nothing;

    if found then
      v_creadas := v_creadas + 1;
    end if;
  else
    -- Rellena hacia ADELANTE los ciclos faltantes desde la última periodo_fin
    -- conocida (= periodo_inicio del siguiente ciclo, contiguos por
    -- construcción) hasta el ciclo vigente, inclusive.
    v_cursor := v_ultimo_fin;

    while v_cursor <= v_ciclo_inicio loop
      v_intentos := v_intentos + 1;
      if v_intentos > 240 then
        raise exception
          'asegurar_facturas_suscripcion_core: demasiadas iteraciones rellenando ciclos para el tenant % (posible bug de cómputo de ciclo).',
          p_tenant_id;
      end if;

      select c.ciclo_inicio, c.ciclo_fin
        into v_paso_inicio, v_paso_fin
        from private.calcular_ciclo_consumo_vigente(v_fecha_alta, v_cursor) as c;

      insert into public.suscripcion_facturas (
        tenant_id, periodo_inicio, periodo_fin, monto_usd, fecha_emision, fecha_vencimiento
      ) values (
        p_tenant_id, v_paso_inicio, v_paso_fin, v_precio_efectivo, v_paso_inicio, v_paso_inicio
      )
      on conflict (tenant_id, periodo_inicio) do nothing;

      if found then
        v_creadas := v_creadas + 1;
      end if;

      v_cursor := v_paso_fin;
    end loop;
  end if;

  return v_creadas;
end;
$fn$;

comment on function private.asegurar_facturas_suscripcion_core(uuid) is
  'Núcleo SIN guard de auth de la generación de facturas de suscripción: '
  'recibe un tenant_id ya resuelto/autorizado por el llamador. Revocado de '
  'public/anon/authenticated: no es de cara al cliente.';

revoke all on function private.asegurar_facturas_suscripcion_core(uuid) from public;
revoke execute on function private.asegurar_facturas_suscripcion_core(uuid) from anon;
revoke execute on function private.asegurar_facturas_suscripcion_core(uuid) from authenticated;

-- -----------------------------------------------------------------------------
-- (b) RPC pública de autoservicio/super-admin por tenant.
-- -----------------------------------------------------------------------------
create or replace function public.asegurar_facturas_suscripcion(p_tenant_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_tenant_id uuid;
begin
  if p_tenant_id is null then
    v_tenant_id := (select private.current_tenant_id());
    if v_tenant_id is null then
      raise exception 'Debe iniciar sesión con un tenant válido para generar su factura de suscripción.';
    end if;
  else
    if not (select private.is_super_admin()) then
      raise exception 'No autorizado' using errcode = '42501';
    end if;
    v_tenant_id := p_tenant_id;
  end if;

  return private.asegurar_facturas_suscripcion_core(v_tenant_id);
end;
$fn$;

comment on function public.asegurar_facturas_suscripcion(uuid) is
  'Genera (si faltan) las facturas de suscripción de un tenant hasta su ciclo '
  'vigente. p_tenant_id NULL = autoservicio (private.current_tenant_id()); '
  'explícito = requiere is_super_admin() (42501 si no). Idempotente. Devuelve '
  'la cantidad de facturas NUEVAS insertadas.';

revoke all on function public.asegurar_facturas_suscripcion(uuid) from public;
revoke execute on function public.asegurar_facturas_suscripcion(uuid) from anon;
grant execute on function public.asegurar_facturas_suscripcion(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- (c) RPC pública de super-admin para TODOS los tenants.
-- -----------------------------------------------------------------------------
create or replace function public.asegurar_facturas_suscripcion_todos()
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_tenant record;
  v_total  integer := 0;
begin
  if not (select private.is_super_admin()) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  for v_tenant in select t.id from public.tenants t loop
    v_total := v_total + private.asegurar_facturas_suscripcion_core(v_tenant.id);
  end loop;

  return v_total;
end;
$fn$;

comment on function public.asegurar_facturas_suscripcion_todos() is
  'Super-admin: itera TODOS los tenants y les asegura sus facturas de '
  'suscripción hasta el ciclo vigente. Pensada para invocarse al cargar '
  '/soporte/suscripciones, antes de public.listar_suscripciones_tenants. '
  'Devuelve la SUMA de facturas nuevas insertadas.';

revoke all on function public.asegurar_facturas_suscripcion_todos() from public;
revoke execute on function public.asegurar_facturas_suscripcion_todos() from anon;
grant execute on function public.asegurar_facturas_suscripcion_todos() to authenticated;

-- -----------------------------------------------------------------------------
-- (d) Punto de entrada de SISTEMA (cron HTTP) — SIN guard de auth, otorgado
-- SOLO a service_role. Único llamador legítimo: la ruta de Vercel Cron con la
-- llave service-role (`apps/web/app/api/cron/generar-suscripciones`).
-- -----------------------------------------------------------------------------
create or replace function public.asegurar_facturas_suscripcion_sistema()
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_tenant record;
  v_total  integer := 0;
begin
  for v_tenant in select t.id from public.tenants t loop
    v_total := v_total + private.asegurar_facturas_suscripcion_core(v_tenant.id);
  end loop;

  return v_total;
end;
$fn$;

comment on function public.asegurar_facturas_suscripcion_sistema() is
  'Punto de entrada del cron HTTP diario: SIN guard de auth a propósito (corre '
  'sin sesión, como actor de sistema — regla dura #13). Itera TODOS los '
  'tenants y les asegura sus facturas de suscripción hasta el ciclo vigente. '
  'Otorgada SOLO a service_role (la ruta de Vercel Cron la invoca con la llave '
  'service-role); revocada de public/anon/authenticated.';

revoke all on function public.asegurar_facturas_suscripcion_sistema() from public;
revoke execute on function public.asegurar_facturas_suscripcion_sistema() from anon;
revoke execute on function public.asegurar_facturas_suscripcion_sistema() from authenticated;
grant execute on function public.asegurar_facturas_suscripcion_sistema() to service_role;
