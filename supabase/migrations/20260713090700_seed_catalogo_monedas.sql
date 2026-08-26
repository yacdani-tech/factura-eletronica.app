-- =============================================================================
-- Migración: seed del catálogo global de monedas (USD + CRC)
-- -----------------------------------------------------------------------------
-- IMPACTO: INSERTa 2 filas en public.monedas (catálogo global, sin
-- tenant_id). NO inserta datos de ningún tenant ni de prueba. Idempotente
-- (ON CONFLICT DO UPDATE), segura de re-ejecutar.
-- ES DESTRUCTIVA: no.
-- CÓMO VALIDAR: `select * from public.monedas order by codigo;` debe listar
-- exactamente CRC (0 decimales, símbolo ₡) y USD (2 decimales, símbolo $).
-- Agregar una moneda nueva en el futuro (MXN, DOP...) = un INSERT igual a
-- estos en una migración nueva, nunca editando esta.
-- PLAN DE REVERSIÓN: delete from public.monedas where codigo in ('USD','CRC');
-- (seguro solo si ningún tenant/documento las referencia todavía).
-- =============================================================================

insert into public.monedas (codigo, nombre, simbolo, decimales, activa)
values
  ('USD', 'Dólar estadounidense', '$', 2, true),
  ('CRC', 'Colón costarricense', '₡', 0, true)
on conflict (codigo) do update
  set nombre = excluded.nombre,
      simbolo = excluded.simbolo,
      decimales = excluded.decimales,
      activa = excluded.activa;
