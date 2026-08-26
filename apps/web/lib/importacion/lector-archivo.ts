import { parsearCsv } from "@/lib/importacion/csv-parser";
import { textosImportacion } from "@/lib/textos/importacion";
import {
  elegirHoja,
  esOle2,
  esZip,
  leerLibroXlsx,
  ole2ContienePaqueteEncriptado,
  tamanoDescomprimidoZip,
  zipContieneWorkbookXlsx,
} from "@/lib/importacion/xlsx-sheetjs";
import { recuperarCsvEnUnaColumna } from "@/lib/importacion/csv-embebido-en-columna";
import { corregirMojibakeFilas } from "@/lib/importacion/mojibake";
import { SEPARADORES_CANDIDATOS, contarOcurrenciasFueraDeComillas, type SeparadorCsv } from "@/lib/importacion/separador-csv";

/**
 * Lector ÚNICO de archivos de importación (CSV/`.xlsx`/`.xls`) — punto de
 * entrada compartido por AMBOS dominios que ingieren un archivo subido por el
 * tenant: carga masiva de subclientes (`lib/subclientes/carga-masiva.ts`) e
 * ingesta de consolidados (`lib/consolidados/importar.ts`). Contrato completo
 * (motivo de la revisión de librería, división de responsabilidades, y por
 * qué la detección de fila de encabezado NO vive acá) en
 * `docs/arquitectura/contratos-transversales.md` §d.
 *
 * PRINCIPIO RECTOR (Yac, 2026-08-04): "Tolerante al recibir, específico al
 * fallar." Se acepta toda variante VÁLIDA de CSV/Excel antes de rechazar
 * nada, y cuando algo falla, el mensaje SIEMPRE indica causa probable +
 * siguiente paso (ver `lib/textos/importacion.ts`) — nunca un genérico ni la
 * palabra "dañado" como cajón de sastre.
 *
 * DETECCIÓN POR CONTENIDO (magic bytes), no por extensión/nombre/MIME del
 * `File`: se leen los primeros bytes reales del archivo para decidir qué
 * rama aplica — esto caza archivos MAL RENOMBRADOS (un `.numbers` guardado
 * como `.xlsx`, un `.xls` binario con extensión `.xlsx`, un CSV renombrado a
 * `.xlsx`) sin depender de lo que el usuario/navegador haya puesto en el
 * nombre. Tres firmas posibles:
 *   - ZIP (`PK`): puede ser un `.xlsx`/OOXML real (si contiene
 *     `xl/workbook.xml`) o cualquier OTRO contenedor ZIP (`.numbers`, `.ods`,
 *     etc. — error específico, nunca el genérico).
 *   - OLE2/CFBF: un `.xls` binario (BIFF8) real, O un paquete OOXML
 *     ENCRIPTADO (MS-OFFCRYPTO envuelve el `.xlsx` real dentro de un
 *     contenedor OLE2 cuando lleva contraseña). Se distinguen buscando los
 *     streams `EncryptedPackage`/`EncryptionInfo`.
 *   - Cualquier otra cosa (texto plano, u otro binario no reconocido): se
 *     trata como CSV — SheetJS/`.xlsx` nunca aplica acá, y `parsearCsv` nunca
 *     lanza, así que esta rama siempre resuelve en algo (aunque termine
 *     fallando río abajo con un error más específico, ej. columna no
 *     encontrada).
 *
 * DECISIÓN de `.xls` (BIFF8, OLE2 no encriptado) — DIVERGE del ejemplo
 * literal del brief original (que agrupaba `.xls` con "rechazar y avisar"):
 * por el principio rector de arriba, se INTENTA leerlo con SheetJS (que sí
 * sabe leer BIFF8) antes de rendirse — es más útil para el tenant que
 * rechazar un archivo que quizás sí se puede leer. Solo si esa lectura
 * tolerante falla de verdad, se muestra el mensaje de ".xls antiguo no
 * reconocido". Vetable con un cambio de una línea (invertir el orden:
 * intentar vs. rechazar directo) si Yac prefiere el comportamiento original.
 */

/** Cota de tamaño de ENTRADA — aplica de forma UNIFORME a ambas ramas (CSV y `.xlsx`). Para CSV es una defensa en profundidad nueva pero inocua (el caller ya rechaza archivos sobre-tamaño antes de invocar el lector). */
const TAMANO_MAX_BYTES_DEFECTO = 2 * 1024 * 1024;

/**
 * Cota de filas TOTALES (rama `.xlsx` únicamente) — subida de 500 a 10.000
 * (encargo "lector robusto de archivos", 2026-08-04): el tope existe para
 * defenderse del "used range" inflado de Excel (formato/bordes aplicados
 * mucho más allá de los datos reales), no para limitar volumen real de
 * negocio — 10.000 da mucho más margen antes de rechazar un archivo legítimo
 * grande. CSV no tiene tope propio a nivel de lector (igual que siempre).
 */
const FILAS_MAX_DEFECTO_XLSX = 10_000;

/**
 * Cota de tamaño DESCOMPRIMIDO del ZIP (rama `.xlsx` únicamente) — mitigación
 * de zip-bomb (hallazgo del revisor, 2026-08-04): `TAMANO_MAX_BYTES_DEFECTO`
 * de arriba aplica sobre el archivo COMPRIMIDO, y el tope de filas
 * (`FILAS_MAX_DEFECTO_XLSX`) se aplica DESPUÉS de que `XLSX.read` ya infló
 * todo el ZIP en memoria — un `.xlsx` con ratio de compresión extremo podía
 * expandirse a cientos de MB antes de que cualquiera de esos dos topes
 * rechazara nada. 50 MB es generoso: un `.xlsx` real de subclientes/
 * consolidado ronda pocos MB descomprimido. Se verifica leyendo el tamaño
 * declarado en el directorio central del ZIP (`tamanoDescomprimidoZip`),
 * SIN inflar ningún contenido — ver ese módulo para el detalle.
 */
const TAMANO_MAX_DESCOMPRIMIDO_ZIP_DEFECTO = 50 * 1024 * 1024;

export interface OpcionesLectorArchivo {
  /** Ver `TAMANO_MAX_BYTES_DEFECTO`. */
  tamanoMaxBytes?: number;
  /** Ver `FILAS_MAX_DEFECTO_XLSX`. Aplica SOLO a la rama `.xlsx` (no-op para CSV). */
  filasMax?: number;
  /** Ver `TAMANO_MAX_DESCOMPRIMIDO_ZIP_DEFECTO`. Aplica SOLO a la rama ZIP/`.xlsx` (no-op para CSV/OLE2). */
  tamanoMaxDescomprimidoBytes?: number;
  /**
   * `false` (por defecto): descarta filas 100% vacías ANTES de devolver el
   * resultado (rama `.xlsx` únicamente). En `true`, preserva TODAS las
   * filas de la hoja en su POSICIÓN real — requerido por
   * `lib/consolidados/parser.ts`, que numera cada fila por su posición
   * dentro del `string[][]` recibido (ver el contrato §d). NO-OP para CSV:
   * `parsearCsv` YA preserva todas las filas incondicionalmente.
   */
  conservarFilasVacias?: boolean;
  /**
   * Encabezados esperados (valores del mapeo de columnas del consumidor,
   * ej. `["Nombre", "Teléfono", "Correo"]`) — usados SOLO para elegir la
   * hoja correcta cuando el libro `.xlsx` tiene MÁS de una hoja (ver
   * `elegirHoja`, `lib/importacion/xlsx-sheetjs.ts`). Sin este parámetro (o
   * con un libro de 1 sola hoja), se usa siempre la primera hoja del libro
   * — mismo criterio que la versión anterior de este lector. No aplica a
   * CSV (no existe el concepto de "hoja").
   */
  columnasEsperadas?: string[];
}

export type ResultadoLectorArchivo =
  | {
      /** `string[][]` — primera fila = encabezados (salvo preámbulo, que NO detecta este lector — ver contrato §d), celdas trim, vacías = `""`. */
      filas: string[][];
      tipoDetectado: "csv" | "xlsx";
      /** Nombre de la hoja usada cuando `tipoDetectado === "xlsx"`; `null` para CSV (no aplica el concepto de hoja). */
      hojaElegida: string | null;
      /** SIEMPRE un array (puede ser vacío) — nunca `undefined`. No bloqueantes. */
      advertencias: string[];
    }
  | { error: string };

function tamanoMb(bytes: number): number {
  return Math.round((bytes / (1024 * 1024)) * 10) / 10;
}

// -----------------------------------------------------------------------------
// Rama CSV: decodificación de bytes (BOM/UTF-8/Latin-1) + sniff de separador.
// -----------------------------------------------------------------------------

const BOM_UTF8_BYTES = [0xef, 0xbb, 0xbf];

function bufferEmpiezaConBom(buffer: Buffer): boolean {
  return (
    buffer.length >= BOM_UTF8_BYTES.length &&
    buffer[0] === BOM_UTF8_BYTES[0] &&
    buffer[1] === BOM_UTF8_BYTES[1] &&
    buffer[2] === BOM_UTF8_BYTES[2]
  );
}

/**
 * Decodifica bytes crudos de un `.csv` a texto: BOM UTF-8 explícito primero;
 * si no hay BOM, se intenta UTF-8 estricto (`fatal: true` — cualquier
 * secuencia de bytes inválida para UTF-8 lanza); si falla, se asume Latin-1
 * (ISO-8859-1) — un archivo guardado por un Excel/sistema legado en esa
 * codificación tiene tildes/ñ como bytes que NO forman UTF-8 válido, así que
 * el `fatal: true` de arriba los detecta de forma confiable.
 *
 * El decodificador de Latin-1 es MANUAL (no `TextDecoder("latin1")`) a
 * propósito: Latin-1 mapea cada byte 0-255 DIRECTO al mismo code point
 * Unicode (`String.fromCharCode`), así que no hace falta ninguna tabla — y
 * esto evita cualquier dependencia de que el build de Node tenga ICU
 * completo instalado (el `TextDecoder` nativo de codificaciones legadas SÍ
 * depende de eso).
 */
function decodificarTextoCsv(buffer: Buffer): string {
  if (bufferEmpiezaConBom(buffer)) {
    return new TextDecoder("utf-8").decode(buffer.subarray(3));
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return decodificarLatin1(buffer);
  }
}

function decodificarLatin1(buffer: Buffer): string {
  let resultado = "";
  for (let i = 0; i < buffer.length; i++) resultado += String.fromCharCode(buffer[i]);
  return resultado;
}

const MAX_CHARS_SNIFF_SEPARADOR = 8_000;
const MAX_LINEAS_SNIFF_SEPARADOR = 5;

/**
 * Detecta qué separador usa el CSV, mirando SOLO una muestra acotada
 * (primeros ~8000 caracteres, hasta 5 líneas no vacías) — nunca el archivo
 * completo, para mantener el costo constante sin importar el tamaño real.
 *
 * Regla (encargo de Yac 2026-08-04, síntoma real: un archivo separado por
 * `;` se leía como UNA sola columna): para cada candidato, en orden de
 * prioridad (coma, punto y coma, tab — ver `SEPARADORES_CANDIDATOS`), se
 * cuenta su cantidad de ocurrencias por línea; el PRIMER candidato cuya
 * cantidad sea la MISMA (>0) en TODAS las líneas de la muestra gana — es
 * decir, "produce más de una columna de forma CONSISTENTE". Si ninguno
 * cumple (incluido el caso de un archivo de 1 sola columna, sin ningún
 * separador) se usa `,` por defecto, mismo comportamiento que siempre tuvo
 * `parsearCsv`.
 */
function detectarSeparadorCsv(texto: string): SeparadorCsv {
  const muestra = texto.slice(0, MAX_CHARS_SNIFF_SEPARADOR);
  const lineas = muestra
    .split(/\r\n|\r|\n/)
    .filter((l) => l.trim() !== "")
    .slice(0, MAX_LINEAS_SNIFF_SEPARADOR);
  if (lineas.length === 0) return ",";

  for (const candidato of SEPARADORES_CANDIDATOS) {
    const conteos = lineas.map((linea) => contarOcurrenciasFueraDeComillas(linea, candidato));
    const consistente = conteos.every((c) => c === conteos[0]) && conteos[0] > 0;
    if (consistente) return candidato;
  }
  return ",";
}

function leerRamaCsv(buffer: Buffer): ResultadoLectorArchivo {
  const texto = decodificarTextoCsv(buffer);
  const separador = detectarSeparadorCsv(texto);
  return { filas: parsearCsv(texto, separador), tipoDetectado: "csv", hojaElegida: null, advertencias: [] };
}

// -----------------------------------------------------------------------------
// Rama `.xlsx`/`.xls` (SheetJS).
// -----------------------------------------------------------------------------

/**
 * Corre SheetJS sobre `buffer` y arma el resultado final (hoja elegida +
 * cota de filas + `conservarFilasVacias`). `mensajeSiFallaParseo` es
 * inyectado por el caller porque el mensaje correcto ante un fallo real de
 * `XLSX.read` DIFIERE según la rama (ZIP con `xl/workbook.xml` corrupto ->
 * "archivo dañado"; OLE2 que no logró leerse como `.xls` -> "parece un .xls
 * antiguo").
 */
function leerConSheetJs(
  buffer: Buffer,
  opciones: OpcionesLectorArchivo,
  filasMax: number,
  mensajeSiFallaParseo: string,
): ResultadoLectorArchivo {
  let workbook;
  try {
    workbook = leerLibroXlsx(buffer);
  } catch (error) {
    console.error("[importacion] leerFilasDeArchivo: error parseando el archivo con SheetJS:", error);
    return { error: mensajeSiFallaParseo };
  }

  const { nombre, filas: todasLasFilas, advertencia } = elegirHoja(
    workbook,
    opciones.columnasEsperadas,
    textosImportacion.advertencias.multiplesHojas,
  );

  // Recuperación de "CSV volcado dentro de una sola columna" (encargo
  // 2026-08-05, ver `csv-embebido-en-columna.ts`) — ANTES de filtrar filas
  // vacías/aplicar el tope de filas: opera sobre las filas TAL COMO vienen
  // de la hoja, preservando posición (nunca agrega/quita filas, solo reparte
  // el contenido de la columna 0 de cada fila en columnas reales cuando
  // corresponde).
  const recuperacionCsv = recuperarCsvEnUnaColumna(todasLasFilas);
  if ("error" in recuperacionCsv) return { error: recuperacionCsv.error };
  const filasEfectivas = recuperacionCsv.aplico ? recuperacionCsv.filas : todasLasFilas;

  const filasNoVacias = filasEfectivas.filter((fila) => !fila.every((celda) => celda === ""));
  if (filasNoVacias.length > filasMax) {
    return { error: textosImportacion.errores.demasiadasFilas(filasMax) };
  }

  const advertencias = [
    ...(advertencia ? [advertencia] : []),
    ...(recuperacionCsv.aplico ? [textosImportacion.advertencias.csvEnUnaColumnaRecuperado] : []),
  ];

  return {
    filas: opciones.conservarFilasVacias ? filasEfectivas : filasNoVacias,
    tipoDetectado: "xlsx",
    hojaElegida: nombre || null,
    advertencias,
  };
}

function leerRamaZip(buffer: Buffer, opciones: OpcionesLectorArchivo, filasMax: number): ResultadoLectorArchivo {
  if (!zipContieneWorkbookXlsx(buffer)) {
    return { error: textosImportacion.errores.formatoNoSoportadoZip };
  }

  // Mitigación de zip-bomb (ver `TAMANO_MAX_DESCOMPRIMIDO_ZIP_DEFECTO`): se
  // chequea el tamaño DESCOMPRIMIDO real (leído de los headers del ZIP, sin
  // inflar nada) ANTES de invocar `leerConSheetJs`/`XLSX.read`, que sí infla
  // todo el contenido en memoria. `tamanoDescomprimidoZip` devuelve `null`
  // cuando la estructura del ZIP no se puede leer con confianza -> en ese
  // caso NO se bloquea nada acá, se deja que SheetJS decida (ver su docstring).
  const tamanoMaxDescomprimidoBytes = opciones.tamanoMaxDescomprimidoBytes ?? TAMANO_MAX_DESCOMPRIMIDO_ZIP_DEFECTO;
  const tamanoDescomprimido = tamanoDescomprimidoZip(buffer);
  if (tamanoDescomprimido !== null && tamanoDescomprimido > tamanoMaxDescomprimidoBytes) {
    console.error(
      "[importacion] leerFilasDeArchivo: rechazado por tamaño descomprimido excesivo (posible zip-bomb):",
      tamanoDescomprimido,
    );
    return {
      error: textosImportacion.errores.archivoDescomprimidoDemasiadoGrande(tamanoMb(tamanoMaxDescomprimidoBytes)),
    };
  }

  return leerConSheetJs(buffer, opciones, filasMax, textosImportacion.errores.archivoDanado);
}

function leerRamaOle2(buffer: Buffer, opciones: OpcionesLectorArchivo, filasMax: number): ResultadoLectorArchivo {
  if (ole2ContienePaqueteEncriptado(buffer)) {
    return { error: textosImportacion.errores.archivoProtegidoConContrasena };
  }
  // Tolerante al recibir: se intenta leer como `.xls` (BIFF8) real antes de
  // rendirse — SheetJS sí sabe leerlo. Solo si esa lectura falla de verdad
  // se muestra el mensaje de ".xls antiguo no reconocido" (ver docstring del
  // módulo para la justificación completa de esta decisión).
  return leerConSheetJs(buffer, opciones, filasMax, textosImportacion.errores.pareceXlsAntiguo);
}

// -----------------------------------------------------------------------------
// Punto de entrada público.
// -----------------------------------------------------------------------------

export async function leerFilasDeArchivo(
  archivo: File,
  opciones: OpcionesLectorArchivo = {},
): Promise<ResultadoLectorArchivo> {
  const tamanoMaxBytes = opciones.tamanoMaxBytes ?? TAMANO_MAX_BYTES_DEFECTO;
  const filasMax = opciones.filasMax ?? FILAS_MAX_DEFECTO_XLSX;

  if (archivo.size === 0) return { error: textosImportacion.errores.archivoVacio };
  if (archivo.size > tamanoMaxBytes) {
    return { error: textosImportacion.errores.archivoDemasiadoGrande(tamanoMb(tamanoMaxBytes)) };
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(await archivo.arrayBuffer());
  } catch (error) {
    console.error("[importacion] leerFilasDeArchivo: no se pudo leer el archivo como bytes:", error);
    return { error: textosImportacion.errores.noSePudoLeer };
  }

  // Detección por CONTENIDO (magic bytes), nunca por extensión/MIME — ver
  // docstring del módulo para el porqué y el detalle de cada rama.
  if (esZip(buffer)) return aplicarCorreccionMojibake(leerRamaZip(buffer, opciones, filasMax));
  if (esOle2(buffer)) return aplicarCorreccionMojibake(leerRamaOle2(buffer, opciones, filasMax));
  return aplicarCorreccionMojibake(leerRamaCsv(buffer));
}

/**
 * Des-mojibake (encargo 2026-08-05, ver `lib/importacion/mojibake.ts`):
 * aplicado como último paso, sobre el resultado YA armado de cualquier rama
 * (CSV/`.xlsx`/`.xls`) — corrige celdas con el patrón clásico de "UTF-8
 * decodificado como Latin-1" (ej. "RodrÃ­guez" -> "Rodríguez"), gateado al
 * patrón para no tocar strings ya correctos. No-op sobre un `{ error }`.
 */
function aplicarCorreccionMojibake(resultado: ResultadoLectorArchivo): ResultadoLectorArchivo {
  if ("error" in resultado) return resultado;
  return { ...resultado, filas: corregirMojibakeFilas(resultado.filas) };
}
