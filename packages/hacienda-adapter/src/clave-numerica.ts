import type { ClaveNumerica, DatosComprobante } from "./tipos";

const NO_IMPLEMENTADO =
  "hacienda-adapter STUB: implementación pendiente (requiere spec Hacienda v4.4).";

/**
 * Genera la CLAVE NUMÉRICA de 50 dígitos (Hacienda v4.4).
 *
 * Estructura (50): país(3=506) · día(2) mes(2) año(2) · cédula emisor(12) ·
 * consecutivo(20) · situación(1) · código de seguridad(8).
 *
 * TODO(real): armar cada segmento con padding, derivar día/mes/año de
 * `fechaEmision`, cédula con ceros a la izquierda, y `codigoSeguridad` aleatorio
 * de 8 dígitos. El `consecutivo` (20) ya viene en `datos.consecutivo`.
 */
export function generarClaveNumerica(_datos: DatosComprobante): ClaveNumerica {
  throw new Error(NO_IMPLEMENTADO);
}
