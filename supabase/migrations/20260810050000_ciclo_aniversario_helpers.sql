-- =============================================================================
-- Migración: helpers puros de fecha para la facturación por ciclo de
-- ANIVERSARIO — `private.hoy_en_costa_rica()` y
-- `private.calcular_ciclo_consumo_vigente(date, date)`.
-- -----------------------------------------------------------------------------
-- NOTA DE EXTRACCIÓN (factura-eletronica): funciones adaptadas del proyecto
-- factura-eletronica.app (donde nacieron para el consumo del plan, MED-1). Son
-- helpers GENÉRICOS de fecha, sin dependencia de ninguna tabla de negocio, y
-- la generación de facturas de suscripción (más adelante en este set) las
-- necesita para resolver el ciclo vigente de cada tenant. El proyecto derivado
-- que quiera otra zona horaria puede ajustar el offset de `hoy_en_costa_rica`.
-- -----------------------------------------------------------------------------
-- IMPACTO: crea DOS funciones nuevas en el schema `private`, sin efecto sobre
-- ninguna tabla:
--   - `private.hoy_en_costa_rica()` (stable): HOY como fecha calendario con
--     offset FIJO UTC-6 (Costa Rica no observa horario de verano), por
--     aritmética directa (`now() at time zone 'utc' - interval '6 hours'`) —
--     no depende del nombre de zona 'America/Costa_Rica' de la tzdata del
--     servidor.
--   - `private.calcular_ciclo_consumo_vigente(p_fecha_alta date,
--     p_fecha_referencia date) returns table (ciclo_inicio date, ciclo_fin
--     date)` (immutable): dado el ancla (`tenants.fecha_alta`) y una fecha de
--     referencia, calcula el ciclo mensual de aniversario [ciclo_inicio,
--     ciclo_fin) que la contiene, con clamping al último día del mes cuando el
--     día ancla no existe en el mes de cierre (ej. alta 31-ene -> feb).
-- ES DESTRUCTIVA: no. Dos funciones nuevas, ninguna tabla/columna tocada.
-- =============================================================================

create or replace function private.hoy_en_costa_rica()
returns date
language sql
stable
set search_path = ''
as $fn$
  select ((now() at time zone 'utc') - interval '6 hours')::date;
$fn$;

comment on function private.hoy_en_costa_rica() is
  'HOY como fecha calendario con offset FIJO UTC-6 (no observa horario de '
  'verano). Usada para resolver el ciclo de aniversario vigente de un tenant.';

create or replace function private.calcular_ciclo_consumo_vigente(
  p_fecha_alta date,
  p_fecha_referencia date
)
returns table (ciclo_inicio date, ciclo_fin date)
language plpgsql
immutable
set search_path = ''
as $fn$
declare
  v_n0        integer;
  v_n         integer;
  v_intentos  integer := 0;
  v_inicio    date;
  v_fin       date;
begin
  if p_fecha_alta is null or p_fecha_referencia is null then
    raise exception
      'calcular_ciclo_consumo_vigente requiere fecha_alta y fecha_referencia no nulas.';
  end if;

  -- Estimación cruda del índice de ciclo (diferencia de año/mes, ignorando
  -- el día) — el día real puede correrla ±1, se corrige abajo.
  v_n0 := (extract(year from p_fecha_referencia)::int - extract(year from p_fecha_alta)::int) * 12
        + (extract(month from p_fecha_referencia)::int - extract(month from p_fecha_alta)::int);

  v_n := v_n0 - 2;

  loop
    v_intentos := v_intentos + 1;
    if v_intentos > 8 then
      raise exception
        'calcular_ciclo_consumo_vigente no pudo resolver el ciclo (fecha_alta=%, referencia=%) tras % intentos.',
        p_fecha_alta, p_fecha_referencia, v_intentos;
    end if;

    -- SIEMPRE desde el ancla original p_fecha_alta (nunca encadenado), para
    -- que el clamping de cada límite dependa solo del mes de destino de ESE
    -- límite, nunca de un límite previo ya clampeado.
    v_inicio := (p_fecha_alta + (v_n || ' months')::interval)::date;
    v_fin    := (p_fecha_alta + ((v_n + 1) || ' months')::interval)::date;

    if v_inicio <= p_fecha_referencia and p_fecha_referencia < v_fin then
      ciclo_inicio := v_inicio;
      ciclo_fin := v_fin;
      return next;
      return;
    end if;

    v_n := v_n + 1;
  end loop;
end;
$fn$;

comment on function private.calcular_ciclo_consumo_vigente(date, date) is
  'Ciclo mensual de aniversario [ciclo_inicio, ciclo_fin) anclado a '
  'p_fecha_alta que contiene a p_fecha_referencia. Clamping al último día del '
  'mes cuando el día ancla no existe en el mes de cierre. IMMUTABLE.';

revoke all on function private.hoy_en_costa_rica() from public;
revoke execute on function private.hoy_en_costa_rica() from anon;
grant execute on function private.hoy_en_costa_rica() to authenticated;

revoke all on function private.calcular_ciclo_consumo_vigente(date, date) from public;
revoke execute on function private.calcular_ciclo_consumo_vigente(date, date) from anon;
grant execute on function private.calcular_ciclo_consumo_vigente(date, date) to authenticated;
