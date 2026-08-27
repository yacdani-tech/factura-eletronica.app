/**
 * Primitivas de detección de separador CSV, compartidas por DOS necesidades
 * distintas dentro de `lib/importacion/`:
 *
 * 1. `lector-archivo.ts` (rama CSV real): sniff del separador de un archivo
 *    `.csv` completo (varias líneas de muestra).
 * 2. `csv-embebido-en-columna.ts` (rama `.xlsx`/`.xls`): sniff del separador
 *    de un `.xlsx` degenerado cuyo contenido CSV quedó volcado dentro de UNA
 *    sola celda por fila (encargo "lector tolerante a CSV embebido en una
 *    columna", Yac 2026-08-05).
 *
 * Extraído a un módulo propio para que AMBOS reusen la MISMA lógica de
 * conteo/candidatos — "reusá, no reimplementes el parser" (encargo explícito
 * de Yac para esta tarea).
 */

/**
 * Candidatos de separador, en orden de PRIORIDAD (se usa el primero que
 * resulte "consistente"): coma (default histórico de `parsearCsv`), punto y
 * coma (config regional CR/español — Excel exporta con `;` porque la coma es
 * el separador DECIMAL de esa configuración) y TAB (export "Texto delimitado
 * por tabulaciones" de Excel/Sheets).
 */
export const SEPARADORES_CANDIDATOS = [",", ";", "\t"] as const;
export type SeparadorCsv = (typeof SEPARADORES_CANDIDATOS)[number];

/**
 * Cuenta ocurrencias de `separador` FUERA de comillas en una línea — sniff
 * simple (no hace falta manejar comillas escapadas `""` acá, solo saber si
 * estamos "dentro" o "fuera" para no contar separadores que son parte del
 * dato). Sin regex: recorrido char a char, cero riesgo de ReDoS.
 */
export function contarOcurrenciasFueraDeComillas(linea: string, separador: string): number {
  let cuenta = 0;
  let dentroDeComillas = false;
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i];
    if (c === '"') {
      dentroDeComillas = !dentroDeComillas;
      continue;
    }
    if (dentroDeComillas) continue;
    if (c === separador) cuenta++;
  }
  return cuenta;
}
