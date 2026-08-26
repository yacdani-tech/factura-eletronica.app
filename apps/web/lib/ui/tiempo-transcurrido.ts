/**
 * Formateo del tiempo transcurrido para el indicador de actividad de las
 * importaciones y acciones lentas de IA (feature "que se vea que el sistema
 * está trabajando y no se quedó pegado", decisión de Yac 2026-08-18).
 *
 * Función PURA (sin React) para poder testearla directo y reusarla desde el
 * componente `components/ui/indicador-actividad.tsx` y sus tests. Formato de la
 * captura de referencia del indicador de Claude: `"0m 12s"`, `"2m 14s"`.
 */

/**
 * Convierte milisegundos transcurridos en `"Xm Ys"`. Los milisegundos se
 * truncan a segundos enteros (nunca redondea hacia arriba: mostrar "1s" cuando
 * apenas pasaron 200ms se sentiría adelantado). Un valor negativo o NaN se
 * trata como 0 (defensa ante un reloj que retrocede).
 */
export function formatearTiempoTranscurrido(ms: number): string {
  const seguros = Number.isFinite(ms) && ms > 0 ? ms : 0;
  const totalSegundos = Math.floor(seguros / 1000);
  const minutos = Math.floor(totalSegundos / 60);
  const segundos = totalSegundos % 60;
  return `${minutos}m ${segundos}s`;
}
