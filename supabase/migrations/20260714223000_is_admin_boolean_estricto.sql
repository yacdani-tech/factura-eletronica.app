-- =============================================================================
-- Migración: private.is_admin() nunca devuelve NULL (coalesce a false)
-- -----------------------------------------------------------------------------
-- IMPACTO: solo el cuerpo de private.is_admin() (create or replace, misma
-- firma — conserva grants/revokes). Cero cambios de esquema/columnas/políticas.
-- ES DESTRUCTIVA: no.
--
-- POR QUÉ: `is_admin()` está declarada `returns boolean` pero podía devolver
-- NULL — su última rama era `return (select private.current_rol()) = 'admin'`,
-- y `current_rol()` es NULL para un usuario sin membresía activa (incluido un
-- Super-Admin de plataforma sin selección de soporte y sin membresía propia),
-- así que `NULL = 'admin'` evalúa a NULL, no a false. Es un comportamiento
-- PREEXISTENTE (venía desde 20260714201000, sin cambiar en 20260714221000),
-- detectado en la corrida real de la suite pgTAP del modo soporte
-- (20260714_super_admin_soporte.test.sql, aserción "Super-Admin sin selección:
-- is_admin() false": esperaba false, encontró NULL).
--
-- Por qué importa aunque en RLS "no cambie nada": en un `USING (... and
-- is_admin())` / `with check (... and is_admin())`, NULL y false denegan
-- IGUAL (three-valued logic: `x AND NULL` nunca es true), así que ninguna
-- política actual se comporta distinto — por eso NO es un bug de seguridad
-- vigente. PERO una función `returns boolean` que devuelve NULL es un footgun
-- latente: el día que ALGUNA política o código de app use `not is_admin()` o
-- `is_admin() = false`, un NULL daría el resultado contrario al esperado
-- (`NOT NULL` = NULL, no true; `NULL = false` = NULL, no true). Se cierra
-- ahora, mientras la feature todavía no está commiteada, en vez de dejar la
-- deuda.
--
-- FIX: `coalesce(..., false)` alrededor de la comparación de rol. La rama de
-- modo soporte (return true si tenant_soporte_activo() no es null) queda
-- idéntica. Contrato nuevo y honesto: is_admin() SIEMPRE devuelve true o
-- false, nunca NULL.
--
-- CÓMO VALIDAR (con el MCP, después de aplicar):
--   - Super-Admin sin selección y sin membresía: is_admin() = false (antes NULL).
--   - Cualquier usuario sin membresía activa: is_admin() = false (antes NULL).
--   - Admin real: is_admin() = true (sin cambios). Operador/Contador: false
--     (sin cambios). Super-Admin con selección: true (sin cambios).
--   - Correr la suite pgTAP 20260714_super_admin_soporte.test.sql (la aserción
--     "is_admin() false" ahora pasa) + las de regresión de RLS/auth.
--
-- PLAN DE REVERSIÓN (pensado, no ejecutado automáticamente): re-crear
-- private.is_admin() tal como quedó en 20260714221000 (sin el coalesce) — no
-- recomendado, reintroduce el NULL.
-- =============================================================================

create or replace function private.is_admin()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select private.tenant_soporte_activo()) is not null then
    return true;
  end if;

  return coalesce((select private.current_rol()) = 'admin', false);
end;
$$;

comment on function private.is_admin() is
  'true si (a) el usuario autenticado es Super-Admin con selección activa en '
  'super_admin_tenant_activo (modo soporte — acceso total = nivel Admin), o '
  '(b) tiene membresía ACTIVA con rol=admin. SIEMPRE devuelve true/false, '
  'nunca NULL (coalesce, 20260714223000): una función returns boolean no debe '
  'filtrar NULL — evita que un futuro `not is_admin()` se rompa por '
  'three-valued logic. NOTA: current_rol() NO se modifica y sigue devolviendo '
  'NULL para un Super-Admin en soporte (no tiene membresía real) — código de '
  'app que necesite "es admin" debe usar is_admin(), no current_rol() directo.';
