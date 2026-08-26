-- =============================================================================
-- Migración: seed del catálogo global de planes (COU-5, placeholder provisorio)
-- -----------------------------------------------------------------------------
-- IMPACTO: INSERTa 4 filas en public.planes (catálogo global, sin tenant_id;
-- no toca ningún dato de tenant). Idempotente (`on conflict (codigo) do
-- nothing`; `codigo` ya es `unique not null` desde 20260713090100 — ver nota
-- al final de este header, no se re-verifica en DDL).
--
-- DECISIÓN DE YAC (2026-07-16): nombres y topes son PLACEHOLDER GENÉRICO
-- hasta que se defina el pricing real — "Plan 1".."Plan 4", con topes de
-- documentos/mes 100, 250, 500 y 1000. NO representan el pricing final;
-- queda explícito también en la columna `descripcion` de cada fila para que
-- se vea desde la propia BD (consola/soporte), no solo en este comentario.
--
-- ES DESTRUCTIVA: no.
-- CÓMO VALIDAR: `select codigo, nombre, tope_documentos_mes from public.planes
--   order by tope_documentos_mes;` debe listar exactamente 4 filas
--   (plan-1..plan-4, topes 100/250/500/1000). Volver a correr esta migración
--   no debe duplicar filas (on conflict do nothing) ni pisar una fila que
--   Yac ya haya editado a mano con el pricing real (por eso NO es
--   `do update`, a diferencia del seed de monedas: una vez que exista
--   pricing real, esta migración no debe volver a sobreescribirlo).
-- PLAN DE REVERSIÓN: `delete from public.planes where codigo in
--   ('plan-1','plan-2','plan-3','plan-4');` — seguro solo si ningún tenant
--   referencia todavía esos planes vía `tenants.plan_id`.
--
-- CÓMO REEMPLAZAR ESTOS 4 PLANES CUANDO YAC DEFINA EL PRICING REAL: un
-- `UPDATE public.planes SET nombre = ..., tope_documentos_mes = ...,
-- descripcion = ... WHERE codigo = 'plan-1'` (uno por fila) en una migración
-- nueva — nunca un INSERT nuevo con otro código (rompería cualquier
-- `tenants.plan_id` ya asignado a estos 4 códigos) ni un DELETE+INSERT.
--
-- NOTA sobre el ON CONFLICT: `codigo` ya es `unique not null` desde
-- 20260713090100 (verificado contra el esquema real antes de escribir este
-- seed) — no se repite esa verificación acá; si algún día dejara de serlo,
-- el propio `on conflict (codigo)` fallaría alto y claro (42P10, "there is no
-- unique or exclusion constraint matching the ON CONFLICT specification"),
-- que ya es un fallo fuerte y no silencioso.
-- =============================================================================

insert into public.planes (codigo, nombre, tope_documentos_mes, descripcion, activo)
values
  ('plan-1', 'Plan 1', 100,
   'PROVISORIO: nombre y tope placeholder hasta definir pricing real (decisión de Yac, 2026-07-16). No usar en comunicación con couriers.',
   true),
  ('plan-2', 'Plan 2', 250,
   'PROVISORIO: nombre y tope placeholder hasta definir pricing real (decisión de Yac, 2026-07-16). No usar en comunicación con couriers.',
   true),
  ('plan-3', 'Plan 3', 500,
   'PROVISORIO: nombre y tope placeholder hasta definir pricing real (decisión de Yac, 2026-07-16). No usar en comunicación con couriers.',
   true),
  ('plan-4', 'Plan 4', 1000,
   'PROVISORIO: nombre y tope placeholder hasta definir pricing real (decisión de Yac, 2026-07-16). No usar en comunicación con couriers.',
   true)
on conflict (codigo) do nothing;
