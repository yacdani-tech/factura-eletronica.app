/**
 * Validación de `next=` como ruta interna segura (anti open-redirect).
 * Extraído a un módulo propio para no duplicar la lógica entre
 * `lib/auth/acciones.ts` (Server Actions, recibe `FormDataEntryValue`) y
 * `app/auth/callback/route.ts` (Route Handler, recibe `string | null` de la
 * query string) — ambos necesitan exactamente el mismo criterio de
 * seguridad, así que vivía duplicada (con un bug: ver abajo) en dos lugares.
 *
 * El chequeo NO puede ser un simple `startsWith("//")` / `includes("://")`
 * sobre el valor crudo: los navegadores (spec WHATWG URL, "basic URL parser")
 * hacen dos normalizaciones ANTES de resolver la URL relativa:
 *   1. Eliminan cualquier tab/salto de línea (U+0009, U+000A, U+000D) en
 *      CUALQUIER posición del string (no solo al principio/final).
 *   2. Para esquemas "especiales" (http/https entre otros), reemplazan CADA
 *      backslash `\` por `/`.
 * Como consecuencia, valores como `"/\\evil.com"`, `"/\\/evil.com"` o
 * `"/\t/evil.com"` NO empiezan literalmente con `"//"` ni contienen
 * `"://"`, pero el navegador los normaliza a un `//evil.com` protocol-relative
 * y termina navegando a un origen externo. Confirmado con
 * `new URL(valor, "https://factura-eletronica.app").href` en Node (mismo parser).
 *
 * POLÍTICA (conservadora a propósito, ronda de QA 2026-07-14): en vez de
 * normalizar-y-validar, cualquier valor que CONTENGA backslash o tab/CR/LF se
 * rechaza directamente. Ningún `next=` legítimo de esta app lleva esos
 * caracteres (las rutas internas son ASCII simple: `/dashboard`,
 * `/invitacion/<hex>`, etc.), y rechazar de plano elimina toda la clase de
 * bypasses por normalización divergente entre este chequeo y el parser real
 * del navegador. El costo es benigno: un valor raro cae al default
 * (`/dashboard`) en vez de respetarse.
 */
const CARACTERES_PROHIBIDOS = /[\\\t\n\r]/;

/**
 * `null` si `valor` no es una ruta interna segura: no es string, no empieza
 * con "/", es protocol-relative ("//..."), contiene "://", o contiene
 * backslash / caracteres de control (tab, CR, LF) en cualquier posición.
 * Si es segura, devuelve el valor original tal cual.
 */
export function rutaInternaSegura(valor: unknown): string | null {
  if (typeof valor !== "string" || valor.length === 0) return null;

  if (CARACTERES_PROHIBIDOS.test(valor)) return null;
  if (!valor.startsWith("/")) return null;
  if (valor.startsWith("//")) return null;
  if (valor.includes("://")) return null;

  return valor;
}

/** Igual que `rutaInternaSegura`, pero con un valor por defecto si no es segura/no viene. */
export function rutaInternaSeguraODefecto(valor: unknown, porDefecto: string): string {
  return rutaInternaSegura(valor) ?? porDefecto;
}
