/**
 * Textos del lector de archivos compartido de importación
 * (`lib/importacion/lector-archivo.ts`) — usado tanto por la carga masiva de
 * subclientes como por la ingesta de consolidados. Centralizado acá (no en
 * `lib/textos/subclientes.ts`/`lib/textos/consolidados.ts`) porque el lector
 * es transversal a ambos dominios (ver `docs/arquitectura/contratos-transversales.md`
 * §d) y no debe acoplarse a los textos de uno solo.
 *
 * PRINCIPIO RECTOR (Yac, 2026-08-04): "Tolerante al recibir, específico al
 * fallar." Cada mensaje de error sigue la plantilla fija:
 *   "No pudimos [acción]. [Causa probable]. [Qué hacer]."
 * Nunca un genérico ni la palabra "dañado" como cajón de sastre — cada causa
 * tiene su propio mensaje, así el usuario sabe exactamente qué intentar
 * distinto la próxima vez.
 */
export const textosImportacion = {
  errores: {
    /** Archivo de 0 bytes — defensa en profundidad (los callers YA rechazan esto antes de invocar el lector; ver `OpcionesLectorArchivo.tamanoMaxBytes`). */
    archivoVacio: "El archivo está vacío.",

    /** Cota de tamaño — defensa en profundidad (mismo motivo que `archivoVacio`: el caller ya valida `File.size` antes). */
    archivoDemasiadoGrande: (maxMb: number) =>
      `No pudimos leer el archivo. Pesa más de lo permitido (máximo ${maxMb} MB). Guardá una versión más liviana (menos filas o sin imágenes/formato pesado) y subila de nuevo.`,

    /** El `File` no se pudo leer como bytes en absoluto (subida interrumpida/corrupta a nivel de transporte, no de formato). */
    noSePudoLeer:
      "No pudimos leer el archivo. Puede que la subida se haya interrumpido. Volvé a intentar subiéndolo de nuevo.",

    /**
     * Un `.xlsx`/OOXML real (ZIP con `xl/workbook.xml`) que SheetJS no logró
     * parsear igual — corrupción real del contenido, no un problema de
     * formato/extensión.
     */
    archivoDanado:
      "No pudimos leer el archivo. El .xlsx parece dañado o incompleto. Volvé a exportarlo desde el sistema de origen y subilo de nuevo.",

    /**
     * ZIP válido pero SIN `xl/workbook.xml` — típicamente un `.numbers` de
     * Apple (usa `Index/...`) u otro formato de hoja de cálculo que no es
     * Excel/OOXML, simplemente renombrado con extensión `.xlsx`.
     */
    formatoNoSoportadoZip:
      "No pudimos leer el archivo. Parece un formato distinto (Numbers u otro, no Excel). Volvé a guardarlo como .xlsx desde Excel/Google Sheets, o exportalo como CSV.",

    /** OLE2/CFBF que resultó ser un paquete OOXML encriptado (MS-OFFCRYPTO: streams `EncryptedPackage`/`EncryptionInfo`) — nunca vamos a poder leerlo sin la contraseña. */
    archivoProtegidoConContrasena:
      "No pudimos abrir el archivo porque está protegido con contraseña. Quitá la contraseña (Archivo > Información > Proteger libro, en Excel) y volvé a subirlo.",

    /**
     * OLE2/CFBF que SheetJS intentó leer como `.xls` binario (BIFF8) y
     * falló — decisión de Yac (2026-08-04): un `.xls` real SÍ se intenta leer
     * primero (tolerante al recibir); este mensaje solo aparece si esa
     * lectura tolerante falló de verdad.
     */
    pareceXlsAntiguo:
      "No pudimos leer el archivo. Parece un .xls antiguo con un formato que no reconocemos. Volvé a guardarlo como .xlsx desde Excel, o exportalo como CSV.",

    /** Tope de filas (rama `.xlsx`) — mismo espíritu que el resto: causa + acción concretas. */
    demasiadasFilas: (maximo: number) =>
      `No pudimos importar el archivo porque tiene más de ${maximo} filas. Dividilo en archivos más chicos (por ejemplo, por fecha o por lote) y subilos por partes.`,

    /**
     * ZIP con ratio de compresión extremo (mitigación de zip-bomb, hallazgo
     * del revisor 2026-08-04) — detectado ANTES de inflar el contenido,
     * leyendo el tamaño descomprimido declarado en el directorio central del
     * ZIP (`tamanoDescomprimidoZip`, `lib/importacion/xlsx-sheetjs.ts`). Un
     * `.xlsx` real de subclientes/consolidado nunca se acerca a esta cota
     * (pocos MB descomprimido) — verla es señal de un archivo corrupto o
     * manipulado, nunca de un archivo legítimo grande.
     */
    archivoDescomprimidoDemasiadoGrande: (maxMb: number) =>
      `No pudimos leer el archivo. Al descomprimirlo ocupa más de ${maxMb} MB, mucho más de lo esperable para un archivo real. Puede estar dañado o manipulado. Volvé a exportarlo desde Excel/Google Sheets y subilo de nuevo.`,

    /**
     * `.xlsx`/`.xls` cuyo contenido quedó volcado como CSV dentro de UNA
     * sola columna (`lib/importacion/csv-embebido-en-columna.ts`) — el
     * encabezado (o los datos) contienen algún separador candidato (`,` `;`
     * TAB), pero no se pudo reconstruir columnas reales con confianza
     * (encabezado que no separa en ≥2 campos, o conteo de campos
     * inconsistente entre las filas de datos). Nunca se adivina una división
     * ambigua en silencio.
     */
    csvEnUnaColumnaInconsistente:
      "No pudimos separar las columnas del archivo. Parece que el contenido quedó todo pegado en una sola columna (como un CSV mal exportado a Excel), pero no logramos dividirlo con confianza. Volvé a exportarlo respetando columnas reales, o guardalo como CSV separado por comas.",
  },
  advertencias: {
    /** El libro tiene más de una hoja y se usó una en particular — no bloquea, solo informa cuál. */
    multiplesHojas: (cantidad: number, hojaElegida: string) =>
      `El archivo tiene ${cantidad} hojas; se usó «${hojaElegida}». Si no es la hoja correcta, dejá en el archivo solo la hoja con los datos y volvé a subirlo.`,

    /** El lector detectó y recuperó automáticamente el caso "CSV embebido en una sola columna" (ver `csv-embebido-en-columna.ts`) — no bloquea, solo informa que se separaron las columnas por el usuario. */
    csvEnUnaColumnaRecuperado:
      "El archivo tenía todo el contenido pegado en una sola columna (como un CSV mal exportado); se separó automáticamente en columnas reales. Revisá que el resultado se vea correcto.",
  },
};
