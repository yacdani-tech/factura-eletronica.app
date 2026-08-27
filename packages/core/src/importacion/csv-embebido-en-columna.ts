import { parsearCsv } from "./csv-parser";
import { SEPARADORES_CANDIDATOS, type SeparadorCsv } from "./separador-csv";
import { textosImportacion } from "../textos/importacion";

/**
 * Recuperación de "CSV volcado dentro de una sola columna de un `.xlsx`/
 * `.xls`" — encargo de Yac 2026-08-05, hallazgo real:
 * `testingfiles/Clientes/clientes-prueba-plataforma.xlsx` (12 encabezados
 * separados por coma pegados TODOS en la celda A1, y cada fila de datos
 * repite el mismo patrón — el archivo nunca tuvo columnas reales, alguien
 * pegó/exportó el CSV completo dentro de UNA celda por fila).
 *
 * Vive en la rama `.xlsx`/`.xls` ÚNICAMENTE (`leerConSheetJs`,
 * `lector-archivo.ts`) — un `.csv` real NUNCA pasa por acá: su separador ya
 * se detecta y aplica ANTES de llamar a `parsearCsv` (`detectarSeparadorCsv`
 * en `lector-archivo.ts`), así que un CSV normal jamás llega a este módulo
 * con todo su contenido embutido en una sola columna.
 *
 * TOLERANCIA A PREÁMBULO (fix 2026-08-05, defecto reportado por qa-tests):
 * un consolidado real (`lib/consolidados/parser.ts`) casi siempre trae una
 * fila de TÍTULO/preámbulo del tenant ANTES del encabezado real — si esa
 * primera fila no vacía fuera tratada ciegamente como "el encabezado" (como
 * hacía la versión anterior de este módulo), nunca contendría un separador
 * y la recuperación abortaría de entrada, aunque el encabezado real (fila
 * siguiente) y los datos SÍ estén embebidos en una columna con separador.
 * Por eso la búsqueda del "encabezado candidato" ESCANEA hasta
 * `MAX_FILAS_CANDIDATAS_ENCABEZADO` filas no vacías, EN ORDEN, probando cada
 * una como posible encabezado — la primera que (a) contenga un separador
 * candidato que la parta en ≥2 campos Y (b) tenga un conteo de campos
 * CONSISTENTE con la mayoría de las filas que vienen DESPUÉS de ella, se
 * adopta como el encabezado real; las filas anteriores (preámbulo) se
 * saltan para efectos de DETECCIÓN — pero al RECUPERAR se reparten
 * IGUAL que cualquier otra fila (una fila de título sin separador
 * simplemente da un único campo, que es su valor tal cual en la primera
 * columna — el consumidor de consolidados hace su PROPIA detección de
 * encabezado/preámbulo después, sobre las filas ya recuperadas).
 *
 * HEURÍSTICA TIGHT a propósito (evitar falsos positivos con un archivo
 * LEGÍTIMO de una sola columna, ej. una lista de "Nombre" a secas) — TODAS
 * las condiciones siguientes deben cumplirse para intentar la recuperación:
 *
 *   1. La hoja tiene efectivamente UNA sola columna con datos: el margen de
 *      filas con contenido fuera de la columna 0 ("desborde") es pequeño
 *      (`UMBRAL_FILAS_CON_DESBORDE`) sobre el TOTAL de filas no vacías —
 *      cubre el caso real observado: una fila con contenido malformado que
 *      terminó partido en 2-3 celdas por quien generó el archivo original,
 *      sin que eso invalide el patrón claro del resto del archivo. Una fila
 *      con desborde nunca se considera candidata a encabezado (ver más
 *      abajo) aunque sí cuenta para este ratio general.
 *   2. Al escanear candidatos (ver arriba), alguna fila contiene AL MENOS
 *      UNO de los separadores candidatos (`,` `;` TAB) en su texto — sin
 *      esto en NINGUNA de las filas escaneadas, NO se considera este el
 *      caso degenerado en absoluto: un archivo de una sola columna legítima
 *      (ej. "Nombre" a secas) pasa INTACTO, nunca se fuerza un error.
 *   3. Esa fila candidata, parseada (respetando comillas, reusando
 *      `parsearCsv`) con alguno de los separadores candidatos EN ORDEN DE
 *      PRIORIDAD, da ≥2 campos — el primero que lo logre se adopta como el
 *      separador real del archivo.
 *   4. El conteo de campos resultante es CONSISTENTE en la MAYORÍA
 *      (`UMBRAL_CONSISTENCIA_CAMPOS`) de las filas NO vacías que vienen
 *      DESPUÉS de la candidata — si una candidata falla esta consistencia,
 *      se prueba la SIGUIENTE fila candidata (podría ser preámbulo); si
 *      NINGUNA candidata escaneada logra 2+3+4 pero AL MENOS UNA sí cumplió
 *      2+3 (parecía encabezado pero no calzó con los datos) → error
 *      específico (nunca se adivina una división ambigua).
 */

const UMBRAL_FILAS_CON_DESBORDE = 0.1; // hasta 10% de las filas de datos pueden tener contenido fuera de la col. 0 sin invalidar la detección.
const UMBRAL_CONSISTENCIA_CAMPOS = 0.8; // ≥80% de las filas de datos deben coincidir con el conteo de campos del encabezado candidato.
const MAX_FILAS_CANDIDATAS_ENCABEZADO = 5; // hasta 5 filas NO VACÍAS se prueban como posible encabezado, tolerando preámbulo por encima.

function filaEstaVacia(fila: string[]): boolean {
  return fila.every((celda) => celda.trim() === "");
}

/** `true` si `fila` tiene contenido en alguna columna DISTINTA de la 0. */
function filaTieneDesborde(fila: string[]): boolean {
  return fila.slice(1).some((celda) => celda.trim() !== "");
}

/**
 * Condición 1: la hoja tiene forma de "una sola columna con datos", con
 * tolerancia acotada a desborde sobre el TOTAL de filas no vacías (sin
 * distinguir cuál sería "el encabezado" — eso lo decide por separado el
 * escaneo de candidatos, que además exige que la fila candidata en sí no
 * tenga desborde).
 */
function tieneFormaDeUnaSolaColumna(filas: string[][]): boolean {
  if (filas.length === 0) return false;
  const anchoMax = Math.max(...filas.map((f) => f.length));
  if (anchoMax <= 1) return true; // ya es 1 sola columna real -- nada que tolerar.

  let filasNoVacias = 0;
  let filasConDesborde = 0;
  for (const fila of filas) {
    if (filaEstaVacia(fila)) continue;
    filasNoVacias++;
    if (filaTieneDesborde(fila)) filasConDesborde++;
  }
  if (filasNoVacias === 0) return false;
  return filasConDesborde / filasNoVacias <= UMBRAL_FILAS_CON_DESBORDE;
}

/**
 * Condiciones 2-3 para UNA fila candidata: prueba los separadores candidatos
 * en orden de prioridad contra su texto (columna 0) — el primero que
 * produzca ≥2 campos (respetando comillas) gana. `null` si esta fila no
 * contiene NINGÚN separador candidato, o si contiene alguno pero ninguno
 * logra partirla en ≥2 campos con confianza — en cualquiera de los dos
 * casos, esta fila NO sirve como encabezado (el caller sigue escaneando).
 */
function elegirSeparadorPorFilaCandidata(textoFila: string): SeparadorCsv | null {
  const tieneAlgunSeparador = SEPARADORES_CANDIDATOS.some((s) => textoFila.includes(s));
  if (!tieneAlgunSeparador) return null;

  for (const candidato of SEPARADORES_CANDIDATOS) {
    const campos = parsearCsv(textoFila, candidato)[0] ?? [];
    if (campos.length >= 2) return candidato;
  }
  return null;
}

/** Reparsea el texto de UNA celda (una línea CSV completa) con el separador ya elegido. `[]` para texto vacío. */
function reparsearCelda(textoCelda: string, separador: SeparadorCsv): string[] {
  return parsearCsv(textoCelda, separador)[0] ?? [];
}

/** `true` si la MAYORÍA (`UMBRAL_CONSISTENCIA_CAMPOS`) de las filas no vacías DESPUÉS de `desdeIndice` (exclusive) tienen el mismo conteo de campos que `cantidadCampos`, parseando con `separador`. Sin filas después -> se considera consistente (nada que contradiga). */
function esConsistenteConFilasSiguientes(
  filas: string[][],
  desdeIndice: number,
  separador: SeparadorCsv,
  cantidadCampos: number,
): boolean {
  let noVacias = 0;
  let consistentes = 0;
  for (let j = desdeIndice + 1; j < filas.length; j++) {
    if (filaEstaVacia(filas[j])) continue;
    noVacias++;
    if (reparsearCelda(filas[j][0] ?? "", separador).length === cantidadCampos) consistentes++;
  }
  return noVacias === 0 || consistentes / noVacias >= UMBRAL_CONSISTENCIA_CAMPOS;
}

type ResultadoBusquedaEncabezado =
  | { encontrado: true; indice: number; separador: SeparadorCsv }
  | { encontrado: false; huboCandidatoConSeparador: boolean };

/**
 * Escanea hasta `MAX_FILAS_CANDIDATAS_ENCABEZADO` filas NO VACÍAS de `filas`,
 * en orden, buscando la PRIMERA que sirva como encabezado real: separador
 * utilizable (condiciones 2-3) Y consistencia con la mayoría de las filas
 * que la siguen (condición 4). Las filas anteriores que no califican
 * (típicamente preámbulo/título del tenant) se saltan sin más.
 *
 * `huboCandidatoConSeparador` distingue, cuando NINGUNA fila califica, entre
 * "ninguna fila escaneada tenía separador en absoluto" (archivo de una sola
 * columna LEGÍTIMA -> el caller debe pasar intacto, sin error) y "alguna
 * fila parecía encabezado pero ninguna calzó con los datos" (caso AMBIGUO ->
 * el caller debe devolver el error específico, nunca adivinar).
 */
function buscarFilaEncabezado(filas: string[][]): ResultadoBusquedaEncabezado {
  let huboCandidatoConSeparador = false;
  let candidatasExaminadas = 0;

  for (let i = 0; i < filas.length && candidatasExaminadas < MAX_FILAS_CANDIDATAS_ENCABEZADO; i++) {
    const fila = filas[i];
    if (filaEstaVacia(fila)) continue; // no cuenta para el límite de N -- ni preámbulo ni dato.
    candidatasExaminadas++;

    if (filaTieneDesborde(fila)) continue; // fila sucia -- no es una candidata confiable para leer el separador.

    const separador = elegirSeparadorPorFilaCandidata(fila[0] ?? "");
    if (separador === null) continue; // sin separador utilizable en ESTA fila -- podría ser preámbulo, seguir buscando.
    huboCandidatoConSeparador = true;

    const cantidadCampos = reparsearCelda(fila[0] ?? "", separador).length;
    if (esConsistenteConFilasSiguientes(filas, i, separador, cantidadCampos)) {
      return { encontrado: true, indice: i, separador };
    }
    // Esta candidata "parecía" encabezado pero no calza con lo que viene
    // después -- probablemente preámbulo con una coma suelta; seguir
    // escaneando la siguiente fila no vacía.
  }

  return { encontrado: false, huboCandidatoConSeparador };
}

export type ResultadoCsvEnUnaColumna =
  | { aplico: true; filas: string[][] }
  | { aplico: false }
  | { error: string };

/**
 * Intenta recuperar el caso "CSV embebido en una sola columna" sobre `filas`
 * (`string[][]` ya extraído de la hoja, EN SU ORDEN/POSICIÓN original —
 * nunca se agregan ni quitan filas, solo se reparte el contenido de la
 * columna 0 de cada fila en columnas reales). Ver docstring del módulo para
 * las 4 condiciones evaluadas y la tolerancia a preámbulo.
 */
export function recuperarCsvEnUnaColumna(filas: string[][]): ResultadoCsvEnUnaColumna {
  if (!tieneFormaDeUnaSolaColumna(filas)) return { aplico: false };

  const resultado = buscarFilaEncabezado(filas);
  if (!resultado.encontrado) {
    // Ninguna fila candidata (dentro del margen escaneado) sirvió de
    // encabezado: si al menos una tenía separador utilizable pero no
    // calzó con los datos que la siguen, es un caso AMBIGUO (no se
    // adivina); si ninguna tenía separador en absoluto, es un archivo de
    // una sola columna LEGÍTIMA -> pasar intacto.
    if (resultado.huboCandidatoConSeparador) {
      return { error: textosImportacion.errores.csvEnUnaColumnaInconsistente };
    }
    return { aplico: false };
  }

  const { separador } = resultado;
  // Repartir TODAS las filas (incluido cualquier preámbulo por encima del
  // encabezado elegido) con el MISMO separador — una fila de título sin
  // separador simplemente da un único campo (su valor tal cual en la
  // primera columna); el consumidor de consolidados hace su propia
  // detección de encabezado/preámbulo después, sobre las filas ya
  // recuperadas (ver `lib/consolidados/parser.ts`).
  const filasRecuperadas = filas.map((fila) =>
    filaEstaVacia(fila) ? fila : reparsearCelda(fila[0] ?? "", separador),
  );

  return { aplico: true, filas: filasRecuperadas };
}
