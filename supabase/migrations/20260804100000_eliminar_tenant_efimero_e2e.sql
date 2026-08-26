-- Infra E2E (aislamiento por-worker, decisión de Yac 2026-08-03): función de
-- BORRADO DURO de un tenant EFÍMERO de prueba y todo su árbol de datos.
--
-- POR QUÉ hace falta: el teardown de los tenants efímeros no puede ser un
-- simple `delete from tenants` con cascada. Aunque TODAS las FKs a tenants(id)
-- son ON DELETE CASCADE, varias tablas tienen triggers BEFORE DELETE que
-- PROHÍBEN el borrado físico incluso para roles BYPASSRLS/service_role
-- (`bloquear_delete_modelos_entrega` 20260804090000, `bloquear_delete_subclientes`
-- 20260714053000, append-only de `auditoria`, etc.). Esos guards son correctos
-- para el RUNTIME de la app (inmutabilidad/trazabilidad), pero bloquean la
-- limpieza de datos de PRUEBA. Igual que la infra E2E usa service_role para
-- sembrar, necesita una vía controlada para limpiar.
--
-- CÓMO: SECURITY DEFINER (corre como el owner de la migración) + `SET LOCAL
-- session_replication_role = 'replica'` dentro de la transacción. En replica
-- mode NO disparan ni los triggers de usuario (se saltan los guards) NI los
-- triggers de FK (no hay cascada ni restrict), así que se borra fila por fila
-- de cada tabla con `tenant_id` — en cualquier orden — y al final el tenant.
-- El `SET LOCAL` se revierte solo al terminar la transacción.
--
-- SEGURIDAD (doble): (1) solo actúa sobre tenants cuyo `subdominio` tiene el
-- prefijo de los efímeros (`e2e-ef-`) — jamás puede tocar un tenant real, ni
-- `e2e-qa`; si le pasan otro, LANZA. (2) EXECUTE concedido SOLO a service_role
-- (la infra E2E lo invoca con el cliente admin; ningún cliente de sesión puede
-- llamarla). No borra `auth.users` (viven fuera de public y no cascadean): eso
-- lo hace la infra por admin API tras llamar a esta función.

create or replace function public.eliminar_tenant_efimero(p_tenant_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_subdominio text;
  v_tabla text;
begin
  select subdominio into v_subdominio from public.tenants where id = p_tenant_id;
  if v_subdominio is null then
    return; -- ya no existe: idempotente
  end if;

  if v_subdominio not like 'e2e-ef-%' then
    raise exception
      'eliminar_tenant_efimero: el tenant % (subdominio=%) NO es efímero — abortado por seguridad',
      p_tenant_id, v_subdominio;
  end if;

  -- Bypass de guards de append-only/soft-delete y de las acciones de FK.
  set local session_replication_role = 'replica';

  -- Borra de TODA tabla de public que lleve tenant_id (dinámico: robusto ante
  -- tablas nuevas). En replica mode el orden es irrelevante (FK no se enforcea).
  for v_tabla in
    select c.table_name
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema = 'public'
      and c.column_name = 'tenant_id'
      and t.table_type = 'BASE TABLE' -- excluye vistas (subclientes_listado, etc.)
      and c.table_name <> 'tenants'
  loop
    execute format('delete from public.%I where tenant_id = $1', v_tabla) using p_tenant_id;
  end loop;

  delete from public.tenants where id = p_tenant_id;

  set local session_replication_role = 'origin';
end;
$fn$;

comment on function public.eliminar_tenant_efimero(uuid) is
  'Infra E2E: borrado duro de un tenant EFÍMERO (subdominio prefijo e2e-ef-) y '
  'todo su árbol. SECURITY DEFINER + session_replication_role=replica para '
  'saltar los guards de borrado físico y las acciones de FK. Solo service_role. '
  'No toca auth.users. Ver 20260804100000.';

revoke all on function public.eliminar_tenant_efimero(uuid) from public;
grant execute on function public.eliminar_tenant_efimero(uuid) to service_role;
