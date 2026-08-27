/**
 * Des-mojibake: revierte el caso clásico de "UTF-8 decodificado como Latin-1"
 * — texto que ya nació en UTF-8 (ej. "Rodríguez") pero, en algún paso previo
 * a llegar a este sistema (export del tenant, copiar/pegar entre
 * herramientas), sus bytes UTF-8 se reinterpretaron uno a uno como si fueran
 * Latin-1/ISO-8859-1, produciendo texto tipo "RodrÃ­guez" (encargo "lector
 * tolerante a mojibake", Yac 2026-08-05 — hallazgo real:
 * `testingfiles/Clientes/clientes-prueba-plataforma.xlsx`).
 *
 * GATEADO AL PATRÓN a propósito (nunca se aplica "a ciegas" a cualquier
 * string): revertir sin gate arruinaría cualquier celda que YA esté correcta
 * (ej. "José" reinterpretado de vuelta produciría basura). Dos guardarraíles
 * independientes, AMBOS deben cumplirse para aplicar la corrección:
 *
 * 1. El texto debe MATCHEAR el patrón de bytes clásico de esta corrupción:
 *    el byte líder de un carácter multi-byte UTF-8 en el rango Latin-1
 *    Suplement (0xC2/0xC3) reinterpretado como Latin-1 se ve como "Â"/"Ã"
 *    seguido de un carácter de continuación (rango 0x80-0xBF como code
 *    point). Si el texto NO tiene ninguna de estas secuencias, ni se
 *    intenta la reversión — así un nombre normal con tildes correctas
 *    ("José", "Núñez" ya bien decodificado) nunca entra a este camino. (La
 *    puntuación tipográfica de Windows-1252 mal-decodificada, ej. "â€™",
 *    NO está cubierta — ver el comentario junto al patrón, más abajo.)
 * 2. Reencodear como Latin-1 y decodificar como UTF-8 debe dar una cadena
 *    UTF-8 VÁLIDA (sin caracteres de reemplazo, `TextDecoder({fatal:true})`
 *    no lanza) Y distinta del original — si cualquiera de las dos condiciones
 *    falla, se devuelve el valor ORIGINAL sin tocar. Esto cubre, en
 *    particular, el caso de emojis/símbolos fuera del rango Latin-1: esa
 *    corrupción específica (UTF-8 leído como Windows-1252, no Latin-1 puro)
 *    queda FUERA de alcance a propósito — revertirla con Latin-1 puro
 *    produciría basura distinta, así que el guard de "solo caracteres
 *    <= 0xFF" (`contieneSoloLatin1`) descarta ese caso ANTES de intentar
 *    `Buffer.from(valor, "latin1")` (que trunca silenciosamente cualquier
 *    code point > 0xFF a su byte bajo si no se filtra antes).
 */

/**
 * Solo DOS alternativas (no tres) a propósito — hallazgo de qa-tests
 * 2026-08-05: la puntuación tipográfica de Windows-1252 mal-decodificada
 * (comillas curvas, guiones largos — el patrón clásico "â€™"/"â€œ") NUNCA
 * podría revertirse por esta vía: esos bytes se ven, en Latin-1, como "â"
 * seguido de un carácter en el rango 0x80-0x9F que Windows-1252 sí imprime
 * pero Latin-1/ISO-8859-1 mapea a controles C1 invisibles — es decir, para
 * matchear ese patrón el TEXTO tendría que contener el carácter YA
 * IMPRESO por Windows-1252 (ej. "€", U+20AC), que cae fuera de 0x00-0xFF y
 * el guardarraíl `contieneSoloLatin1` (más abajo) lo descarta ANTES de
 * llegar a reencodear — code muerto, no una corrección real. Revertir esa
 * variante (UTF-8 leído como Windows-1252) queda FUERA de alcance de este
 * encargo (sería una función aparte, con su propia tabla de excepciones
 * 0x80-0x9F de cp1252).
 */
const PATRON_MOJIBAKE_UTF8_COMO_LATIN1 = /Ã[\x80-\xBF]|Â[\x80-\xBF]/;

function pareceMojibake(valor: string): boolean {
  return PATRON_MOJIBAKE_UTF8_COMO_LATIN1.test(valor);
}

/** `false` si algún carácter cae fuera del rango Latin-1 (0x00-0xFF) — `Buffer.from(str, "latin1")` trunca esos code points en vez de lanzar, así que hay que filtrarlos ANTES de intentar la reversión (ver docstring del módulo). Itera por CODE POINT (no por unidad UTF-16) para tratar bien un emoji/carácter astral como una sola unidad. */
function contieneSoloLatin1(valor: string): boolean {
  for (const caracter of valor) {
    const cp = caracter.codePointAt(0);
    if (cp !== undefined && cp > 0xff) return false;
  }
  return true;
}

function esUtf8Valido(buffer: Buffer): boolean {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    return true;
  } catch {
    return false;
  }
}

/**
 * Revierte el mojibake de UNA celda si (y solo si) es seguro — ver
 * guardarraíles en el docstring del módulo. Devuelve el valor ORIGINAL sin
 * tocar en cualquier otro caso (nunca lanza, nunca introduce caracteres de
 * reemplazo).
 */
export function corregirMojibakeCelda(valor: string): string {
  if (valor === "" || !pareceMojibake(valor)) return valor;
  if (!contieneSoloLatin1(valor)) return valor;

  const bytesReinterpretados = Buffer.from(valor, "latin1");
  if (!esUtf8Valido(bytesReinterpretados)) return valor;

  const corregido = bytesReinterpretados.toString("utf8");
  return corregido !== valor ? corregido : valor;
}

/** Aplica `corregirMojibakeCelda` a cada celda de `filas`, preservando forma/orden (ninguna fila/columna se agrega ni se quita). */
export function corregirMojibakeFilas(filas: string[][]): string[][] {
  return filas.map((fila) => fila.map(corregirMojibakeCelda));
}
