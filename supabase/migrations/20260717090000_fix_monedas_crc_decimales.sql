-- =============================================================================
-- Migración: re-asienta el catálogo de monedas — CRC volvió a 0 decimales
-- -----------------------------------------------------------------------------
-- IMPACTO: corrige un DRIFT DE DATOS detectado el 2026-07-17 en el proyecto
-- remoto de desarrollo: `public.monedas` tenía CRC con `decimales = 2`,
-- contradiciendo la regla dura #5 de CLAUDE.md ("CRC = 0 decimales, USD = 2")
-- y el propio seed original (20260713090700, que insertó CRC con 0 — correcto).
-- El origen del drift es DESCONOCIDO: `monedas` es un catálogo global sin
-- trigger de auditoría (la colecta automática cubre solo tablas de datos de
-- tenant), así que no hay pista de quién/cuándo lo cambió. Efecto visible que
-- lo destapó: la pantalla nueva de Configuración > Rutas y zonas (tarea 2.2,
-- fase 3) mostraba "₡0,00" en vez de "₡0" — el código de la app estaba bien
-- (símbolo/decimales salen del catálogo), el DATO estaba mal.
--
-- Se re-ejecuta el MISMO upsert del seed original (idempotente): si el drift
-- vuelve a aparecer, esta migración re-aplicada en cualquier ambiente lo
-- corrige. Si algún día se decide auditar/proteger los catálogos globales
-- contra UPDATEs manuales, es una decisión aparte (anotada en PROGRESO como
-- seguimiento, no bloquea esta corrección).
--
-- ES DESTRUCTIVA: no (upsert de 2 filas de catálogo a sus valores canónicos).
-- CÓMO VALIDAR: `select codigo, simbolo, decimales from public.monedas order
-- by codigo;` -> CRC ₡ 0, USD $ 2. La pantalla /configuracion/rutas muestra
-- "₡0" para "Recoger en sitio" en un courier CRC.
-- PLAN DE REVERSIÓN: no aplica (los valores canónicos SON el estado correcto;
-- revertir sería restaurar el bug).
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
