import * as XLSX from "xlsx";

/**
 * Motor SheetJS aislado — NUNCA se expone directo a los consumidores
 * (`lib/subclientes/carga-masiva.ts`, `lib/consolidados/archivo.ts`/
 * `importar.ts`): el único punto de entrada público es
 * `leerFilasDeArchivo` (`lib/importacion/lector-archivo.ts`). Mismo criterio
 * de aislamiento que ya tenía `lib/subclientes/xlsx.ts` frente a
 * `read-excel-file` (ver `docs/arquitectura/contratos-transversales.md` §d).
 *
 * Sin `import "server-only"` a propósito (mismo motivo que documentaba
 * `xlsx.ts`): este módulo usa `Buffer` de Node, que ya rompe la compilación
 * si un Client Component intentara importarlo — no depende solo del
 * marcador, y el marcador rompería Vitest (no aplica la condición
 * `react-server` de Next).
 */

// -----------------------------------------------------------------------------
// Detección de firma binaria (magic bytes) — por CONTENIDO, nunca por
// extensión/MIME del archivo (principio "tolerante al recibir, específico al
// fallar", Yac 2026-08-04).
// -----------------------------------------------------------------------------

const FIRMA_ZIP = [0x50, 0x4b]; // "PK" — ZIP local file header (0x03 0x04), central dir vacío (0x05 0x06), spanned (0x07 0x08).
const FIRMA_OLE2 = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]; // Compound File Binary Format (.xls binario, o un OOXML encriptado).

function bufferComienzaCon(buffer: Buffer, firma: number[]): boolean {
  if (buffer.length < firma.length) return false;
  for (let i = 0; i < firma.length; i++) {
    if (buffer[i] !== firma[i]) return false;
  }
  return true;
}

/** ZIP genérico (incluye `.xlsx`/OOXML real, pero también `.numbers`/`.ods`/`.docx`/cualquier otro contenedor ZIP). */
export function esZip(buffer: Buffer): boolean {
  return bufferComienzaCon(buffer, FIRMA_ZIP);
}

/** Compound File Binary Format — `.xls` binario (BIFF8) o un paquete OOXML encriptado (MS-OFFCRYPTO). */
export function esOle2(buffer: Buffer): boolean {
  return bufferComienzaCon(buffer, FIRMA_OLE2);
}

const MARCADOR_WORKBOOK_XLSX = Buffer.from("xl/workbook.xml", "ascii");

/**
 * Un ZIP contiene `xl/workbook.xml` cuando (y solo cuando) es un libro
 * OOXML real (`.xlsx`/`.xlsm`) — el nombre de archivo dentro de un ZIP se
 * guarda SIEMPRE como bytes literales (nunca comprimidos) en el header local,
 * así que buscarlo directo en el buffer crudo es confiable sin necesitar un
 * parser de ZIP completo. Un `.numbers` (Apple, usa `Index/...`) o un `.ods`
 * (OpenDocument, usa `content.xml` en la raíz) NUNCA traen esta entrada.
 */
export function zipContieneWorkbookXlsx(buffer: Buffer): boolean {
  return buffer.includes(MARCADOR_WORKBOOK_XLSX);
}

/**
 * Codifica un texto ASCII a UTF-16LE — los nombres de stream/storage de un
 * Compound File Binary Format (OLE2) se guardan en UTF-16LE en su
 * directorio. Buscar la codificación UTF-16LE de nombres conocidos
 * directamente en el buffer crudo es una heurística práctica (evita
 * implementar un parser de CFBF completo solo para esta detección) — mismo
 * criterio pragmático que `zipContieneWorkbookXlsx` usa para ZIP.
 */
function utf16LeDeAscii(texto: string): Buffer {
  const bytes = Buffer.alloc(texto.length * 2);
  for (let i = 0; i < texto.length; i++) bytes.writeUInt16LE(texto.charCodeAt(i), i * 2);
  return bytes;
}

const MARCADOR_ENCRYPTED_PACKAGE = utf16LeDeAscii("EncryptedPackage");
const MARCADOR_ENCRYPTION_INFO = utf16LeDeAscii("EncryptionInfo");

/**
 * Un OLE2 con alguno de estos streams es un paquete OOXML protegido con
 * contraseña (MS-OFFCRYPTO: el `.xlsx` real queda envuelto, encriptado,
 * dentro de un contenedor OLE2 — por eso un archivo "protegido" moderno NO
 * trae la firma ZIP, sino la de OLE2). Sin la contraseña, no hay forma de
 * leerlo — nunca se intenta.
 */
export function ole2ContienePaqueteEncriptado(buffer: Buffer): boolean {
  return buffer.includes(MARCADOR_ENCRYPTED_PACKAGE) || buffer.includes(MARCADOR_ENCRYPTION_INFO);
}

// -----------------------------------------------------------------------------
// Lectura del libro + extracción de filas.
// -----------------------------------------------------------------------------

/** Puede lanzar (archivo corrupto/formato no reconocido por SheetJS) — el caller (`lector-archivo.ts`) SIEMPRE la envuelve en un `try/catch` con el mensaje accionable que corresponda según la rama (ZIP/OLE2). */
export function leerLibroXlsx(buffer: Buffer): XLSX.WorkBook {
  return XLSX.read(buffer, { type: "buffer" });
}

// -----------------------------------------------------------------------------
// Mitigación de zip-bomb (hallazgo del revisor, 2026-08-04): el tope de
// tamaño de `lector-archivo.ts` aplica sobre el archivo COMPRIMIDO, y el tope
// de filas se aplica DESPUÉS de que `XLSX.read` ya infló todo el ZIP en
// memoria — un `.xlsx` chico con ratio de compresión extremo podía
// expandirse a cientos de MB antes de que cualquiera de esos dos topes
// rechazara nada. `tamanoDescomprimidoZip` lee el tamaño DESCOMPRIMIDO real
// directo de los headers del ZIP (directorio central) SIN inflar ningún
// contenido, para que el caller pueda rechazar el archivo ANTES de llamar a
// `leerLibroXlsx`/`XLSX.read`.
// -----------------------------------------------------------------------------

const FIRMA_FIN_DIRECTORIO_CENTRAL = 0x06054b50; // "PK\x05\x06"
const FIRMA_HEADER_DIRECTORIO_CENTRAL = 0x02014b50; // "PK\x01\x02"
const TAMANO_MIN_FIN_DIRECTORIO_CENTRAL = 22;
const TAMANO_MAX_COMENTARIO_ZIP = 65535; // el comentario del ZIP (variable) puede desplazar el EOCD hasta este tope respecto al final del archivo.
const TAMANO_HEADER_DIRECTORIO_CENTRAL = 46; // tamaño FIJO de cada entrada del directorio central (sin contar nombre/extra/comentario).

/** Ubica el offset del "End Of Central Directory" (EOCD) buscando su firma desde el final del buffer hacia atrás (el comentario variable de longitud puede desplazarlo). `null` si no aparece (ZIP truncado/corrupto — el caller deja que SheetJS decida). */
function encontrarFinDeDirectorioCentral(buffer: Buffer): number | null {
  const desde = Math.max(0, buffer.length - TAMANO_MIN_FIN_DIRECTORIO_CENTRAL - TAMANO_MAX_COMENTARIO_ZIP);
  for (let i = buffer.length - TAMANO_MIN_FIN_DIRECTORIO_CENTRAL; i >= desde; i--) {
    if (i >= 0 && i + 4 <= buffer.length && buffer.readUInt32LE(i) === FIRMA_FIN_DIRECTORIO_CENTRAL) return i;
  }
  return null;
}

/**
 * Suma el campo "uncompressed size" (tamaño DESCOMPRIMIDO real) de CADA
 * entrada del directorio central de un ZIP, leído directo de los headers
 * (nunca se infla ningún contenido). Devuelve `null` si la estructura del ZIP
 * no se puede leer con confianza (EOCD ausente, directorio central
 * truncado/con una firma inesperada) — en ese caso el caller NO bloquea nada:
 * deja que `XLSX.read` decida (si de verdad está corrupto, falla con su
 * propio mensaje de "archivo dañado"; esto no es una vía para esconder un
 * zip-bomb real, que SIEMPRE trae un directorio central bien formado — es lo
 * único que un lector ZIP puede usar para saber dónde está cada entrada).
 *
 * Sentinel ZIP64 (`0xFFFFFFFF`, tamaño real en el extra field, no parseado
 * acá — un `.xlsx` real de subclientes/consolidado nunca se acerca a ese
 * tamaño): sumarlo TAL CUAL ya dispara el rechazo por exceder cualquier cota
 * razonable — fail-safe, nunca fail-open.
 */
export function tamanoDescomprimidoZip(buffer: Buffer): number | null {
  const finDirectorioCentral = encontrarFinDeDirectorioCentral(buffer);
  if (finDirectorioCentral === null || finDirectorioCentral + 20 > buffer.length) return null;

  const cantidadEntradas = buffer.readUInt16LE(finDirectorioCentral + 10);
  const offsetDirectorioCentral = buffer.readUInt32LE(finDirectorioCentral + 16);

  let cursor = offsetDirectorioCentral;
  let total = 0;
  for (let i = 0; i < cantidadEntradas; i++) {
    if (cursor < 0 || cursor + TAMANO_HEADER_DIRECTORIO_CENTRAL > buffer.length) return null;
    if (buffer.readUInt32LE(cursor) !== FIRMA_HEADER_DIRECTORIO_CENTRAL) return null;

    total += buffer.readUInt32LE(cursor + 24); // offset 24 del header: uncompressed size.
    const largoNombre = buffer.readUInt16LE(cursor + 28);
    const largoExtra = buffer.readUInt16LE(cursor + 30);
    const largoComentario = buffer.readUInt16LE(cursor + 32);
    cursor += TAMANO_HEADER_DIRECTORIO_CENTRAL + largoNombre + largoExtra + largoComentario;
  }

  return total;
}

/**
 * Celda -> `string`, con `trim()`. `sheet_to_json` con `raw: false` ya
 * devuelve el TEXTO FORMATEADO de la celda (`cell.w` si existe) en vez del
 * valor crudo — esto PRESERVA ceros a la izquierda de celdas formateadas
 * como TEXTO (cédulas/teléfonos guardados como `t="s"`/`inlineStr`), a
 * diferencia de `raw: true`. `defval: ""` ya cubre celdas ausentes/vacías,
 * pero se normaliza igual por si SheetJS devuelve `null`/`undefined` en algún
 * borde.
 *
 * OJO: para celdas NUMÉRICAS grandes, `raw: false` NO preserva precisión —
 * devuelve el display de Excel, que para un entero largo con formato General
 * es NOTACIÓN CIENTÍFICA con pérdida (`"8.012E+11"` en vez de
 * `801200000000`). Esa recuperación la hace `reformatearNumerosCientificos`
 * ANTES de `sheet_to_json` (ver abajo).
 */
function celdaATextoTrim(valor: unknown): string {
  if (valor === null || valor === undefined) return "";
  return String(valor).trim();
}

/** ¿El display de una celda saldría en notación científica/exponencial? (p.ej. `"8.012E+11"`, `"1.5e-7"`). */
const RE_NOTACION_CIENTIFICA = /[eE][+-]?\d/;

/**
 * Recupera los dígitos completos de las celdas NUMÉRICAS que Excel muestra en
 * NOTACIÓN CIENTÍFICA (bug reportado por Yac 2026-08-09: teléfonos guardados
 * como número largo — p.ej. `8,012E+11` — llegaban truncados al importar).
 *
 * `sheet_to_json({ raw: false })` toma el texto formateado `cell.w`; para un
 * entero grande con formato General ese texto ya es la cadena científica CON
 * PÉRDIDA, aunque el valor real completo sigue intacto en `cell.v`. Este
 * pre-paso reescribe `cell.w` al entero completo (`BigInt(cell.v).toString()`)
 * para las celdas afectadas, de modo que `sheet_to_json` recoja el valor
 * corregido sin cambiar nada más del flujo.
 *
 * Muy acotado a propósito (sin regresiones):
 * - Solo celdas `t === "n"` con `cell.v` numérico ENTERO. Un decimal no entero
 *   (`1.5`, pesos/tarifas) se deja igual — no se muestra científico y además
 *   `BigInt` lanzaría; los enteros son los teléfonos/tracking/WR grandes.
 * - Solo si el display REAL saldría exponencial (gate `RE_NOTACION_CIENTIFICA`
 *   sobre `cell.w` o, si falta, sobre `XLSX.utils.format_cell`). Las FECHAS son
 *   numéricas pero su display (`"8/9/2026"`) no es exponencial → no se tocan;
 *   los enteros chicos (`"206160588"`) tampoco → no se tocan.
 * - Mutar `cell.w` es local y seguro: el workbook lo crea `XLSX.read` fresco
 *   por archivo, no se comparte.
 *
 * NO recuperable acá: un teléfono exportado como TEXTO literal científico
 * (`cell.t === "s"` con `"8,012E+11"`) ya perdió los dígitos en origen (quedan
 * ~4 cifras); se conserva el comportamiento tolerante actual del importador
 * (se guarda con advertencia `revisar_telefono`). Ídem un número de MÁS de
 * ~15-16 dígitos significativos (algún tracking/WR muy largo): Excel lo guarda
 * en `cell.v` como double IEEE-754 y ya redondea ANTES de que este código
 * corra — `BigInt(cell.v)` reconstruye exacto lo que quede, sin agravar la
 * pérdida, pero no puede recuperar dígitos que Excel nunca almacenó.
 */
function reformatearNumerosCientificos(hoja: XLSX.WorkSheet): void {
  for (const direccion of Object.keys(hoja)) {
    if (direccion.charCodeAt(0) === 0x21 /* "!" — !ref, !merges, !cols, etc. */) continue;
    const celda = hoja[direccion] as XLSX.CellObject | undefined;
    if (!celda || celda.t !== "n" || typeof celda.v !== "number" || !Number.isInteger(celda.v)) continue;

    const display = typeof celda.w === "string" ? celda.w : XLSX.utils.format_cell(celda);
    if (!RE_NOTACION_CIENTIFICA.test(display)) continue;

    celda.w = BigInt(celda.v).toString();
  }
}

/**
 * Extrae TODAS las filas de una hoja como `string[][]` — primera fila
 * incluida (nunca decide qué fila es el encabezado, eso es responsabilidad
 * EXCLUSIVA del consumidor, ver contrato §d). Celdas combinadas y columnas
 * ocultas no requieren manejo especial: SheetJS ya deja el valor solo en la
 * celda top-left de un merge (el resto queda vacío, sin crashear) y las
 * columnas ocultas igual traen su dato en `sheet_to_json`.
 */
export function hojaAFilas(hoja: XLSX.WorkSheet): string[][] {
  reformatearNumerosCientificos(hoja);
  const filas = XLSX.utils.sheet_to_json<unknown[]>(hoja, { header: 1, raw: false, defval: "" });
  return filas.map((fila) => fila.map(celdaATextoTrim));
}

function normalizarHeaderCelda(valor: string): string {
  return valor.trim().toLowerCase();
}

export interface SeleccionHoja {
  nombre: string;
  filas: string[][];
  /** No-nulo cuando corresponde advertir al usuario (múltiples hojas, sin match claro de `columnasEsperadas`). */
  advertencia: string | null;
}

/**
 * Elige QUÉ hoja del libro usar y devuelve sus filas ya convertidas.
 *
 * - Libro de 1 sola hoja: esa, sin advertencia (caso normal, sin ambigüedad).
 * - Libro con 2+ hojas y `columnasEsperadas` provisto: se compara la primera
 *   fila NO VACÍA de cada hoja contra `columnasEsperadas` (match normalizado,
 *   trim + minúsculas) y se elige la hoja con MÁS coincidencias. Si NINGUNA
 *   hoja matchea ni un solo encabezado esperado, cae al caso de abajo.
 * - Libro con 2+ hojas sin `columnasEsperadas`, o sin ningún match: se usa la
 *   PRIMERA hoja del libro (mismo criterio que la versión anterior de este
 *   lector, `parsearXlsx`/`lib/subclientes/xlsx.ts`) y se agrega una
 *   advertencia no bloqueante.
 */
export function elegirHoja(
  workbook: XLSX.WorkBook,
  columnasEsperadas: string[] | undefined,
  advertenciaMultiplesHojas: (cantidad: number, hojaElegida: string) => string,
): SeleccionHoja {
  const nombres = workbook.SheetNames;
  if (nombres.length === 0) return { nombre: "", filas: [], advertencia: null };

  if (nombres.length === 1) {
    return { nombre: nombres[0], filas: hojaAFilas(workbook.Sheets[nombres[0]]), advertencia: null };
  }

  if (columnasEsperadas && columnasEsperadas.length > 0) {
    const esperadasNorm = columnasEsperadas.map(normalizarHeaderCelda).filter((c) => c !== "");
    let mejor: { nombre: string; filas: string[][]; puntaje: number } | null = null;

    for (const nombre of nombres) {
      const filas = hojaAFilas(workbook.Sheets[nombre]);
      const primeraNoVacia = filas.find((fila) => !fila.every((celda) => celda === ""));
      if (!primeraNoVacia) continue;
      const headerNorm = new Set(primeraNoVacia.map(normalizarHeaderCelda));
      const puntaje = esperadasNorm.filter((esperada) => headerNorm.has(esperada)).length;
      if (!mejor || puntaje > mejor.puntaje) mejor = { nombre, filas, puntaje };
    }

    if (mejor && mejor.puntaje > 0) {
      return { nombre: mejor.nombre, filas: mejor.filas, advertencia: null };
    }
  }

  const primerNombre = nombres[0];
  return {
    nombre: primerNombre,
    filas: hojaAFilas(workbook.Sheets[primerNombre]),
    advertencia: advertenciaMultiplesHojas(nombres.length, primerNombre),
  };
}
