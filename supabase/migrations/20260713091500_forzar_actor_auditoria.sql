-- =============================================================================
-- Migración: forzar actor_id/actor_tipo de auditoria desde auth.uid()
-- -----------------------------------------------------------------------------
-- IMPACTO: un trigger BEFORE INSERT nuevo sobre `auditoria`. Cero cambios de
-- esquema, políticas o comportamiento del trigger genérico. Hallazgo
-- BLOQUEANTE del revisor pre-merge (2026-07-13).
--
-- PROBLEMA: la política auditoria_insertar_mismo_tenant (20260713091000, R1)
-- permite el INSERT manual a `authenticated` con el único with check de
-- tenant propio. Nada forzaba actor_id/actor_tipo en ESE camino: un usuario
-- autenticado podía firmar un evento manual con el uuid de CUALQUIER otro
-- usuario (el FK a usuarios no chequea tenant) o disfrazarlo de
-- actor_tipo='sistema' — en la tabla cuyo propósito es ser la bitácora
-- confiable de "quién hizo qué". El mismo día se había cerrado este mismo
-- hueco para documentos.creado_por (forzar_creado_por_documentos,
-- 20260713091200); este trigger aplica el criterio idéntico a auditoria.
--
-- DISEÑO: si hay sesión (auth.uid() no NULL), se PISA actor_id/actor_tipo
-- con la identidad real, ignore lo que diga el payload. Si no hay sesión
-- (service_role/postgres/procesos de confianza), se respeta el valor
-- explícito — mismo contrato que forzar_creado_por_documentos. Es
-- IDEMPOTENTE con registrar_auditoria() (SECURITY DEFINER): esa función ya
-- calcula actor desde auth.uid(), así que cuando su INSERT pasa por este
-- trigger los valores no cambian. `origen` NO se fuerza: es una etiqueta de
-- canal sin peso de identidad, y una server action legítima puede setearla
-- explícita en un INSERT manual (la vía normal sigue siendo la GUC
-- app.origen que lee el trigger genérico).
-- ES DESTRUCTIVA: no.
-- CÓMO VALIDAR: como usuario autenticado A, `insert into auditoria (...,
-- actor_id = <uuid de otro usuario>, actor_tipo = 'usuario')` y también
-- `(..., actor_id = null, actor_tipo = 'sistema')` — ambas filas deben
-- quedar con actor_id = auth.uid() de A y actor_tipo = 'usuario' (cubierto
-- por la suite pgTAP 20260713_auditoria.test.sql).
-- PLAN DE REVERSIÓN:
--   drop trigger trg_auditoria_forzar_actor on public.auditoria;
--   drop function if exists public.forzar_actor_auditoria();
-- =============================================================================

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
  return NEW;
end;
$$;

comment on function public.forzar_actor_auditoria() is
  'Trigger BEFORE INSERT: si hay sesión, fuerza auditoria.actor_id = '
  'auth.uid() y actor_tipo = usuario, ignorando el payload (nunca confiar '
  'en la identidad declarada por el cliente — regla dura #13). Sin sesión '
  '(service_role/procesos de confianza) respeta el valor explícito. '
  'Idempotente con registrar_auditoria(), que ya calcula el actor igual.';

create trigger trg_auditoria_forzar_actor
  before insert on public.auditoria
  for each row
  execute function public.forzar_actor_auditoria();
