import type { ClaveNumerica, DatosComprobante } from "./tipos";

const NO_IMPLEMENTADO =
  "hacienda-adapter STUB: implementación pendiente (requiere spec Hacienda v4.4).";

/**
 * Construye el XML del comprobante electrónico (Hacienda v4.4), SIN firmar.
 *
 * TODO(real): serializar el XML del namespace correspondiente al `tipo`
 * (FacturaElectronica / NotaCredito / Tiquete / etc.), incluyendo Clave,
 * NumeroConsecutivo, FechaEmision, Emisor, Receptor, CondicionVenta,
 * DetalleServicio (líneas + CABYS + impuestos) y ResumenFactura. Usar un builder
 * de XML (ej. xmlbuilder2) y validar contra el XSD oficial.
 */
export function construirXmlFactura(_datos: DatosComprobante, _clave: ClaveNumerica): string {
  throw new Error(NO_IMPLEMENTADO);
}
