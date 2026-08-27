/**
 * Tipos del dominio de facturación electrónica de Costa Rica (Hacienda v4.4).
 *
 * STUB: contratos tipados. La implementación real (armado de XML, firma
 * XAdES-EPES, OAuth y envío a Hacienda) se difiere — requiere la especificación
 * técnica v4.4, el certificado de firma del emisor y las credenciales del IDP.
 */

/** Tipo de comprobante electrónico (Hacienda v4.4). */
export type TipoComprobante =
  | "factura_electronica"
  | "nota_credito_electronica"
  | "nota_debito_electronica"
  | "tiquete_electronico"
  | "factura_electronica_compra"
  | "factura_electronica_exportacion"
  | "mensaje_receptor";

/** Ambiente de Hacienda. */
export type AmbienteHacienda = "sandbox" | "produccion";

/** Condición de venta (catálogo Hacienda). */
export type CondicionVenta = "contado" | "credito" | "consignacion" | "apartado" | "otros";

/** Identificación (cédula) del emisor/receptor. */
export interface Identificacion {
  /** Tipo: 01 física, 02 jurídica, 03 DIMEX, 04 NITE. */
  tipo: "01" | "02" | "03" | "04";
  numero: string;
}

export interface Emisor {
  nombre: string;
  identificacion: Identificacion;
  nombreComercial?: string;
  ubicacion: { provincia: string; canton: string; distrito: string; otrasSenas?: string };
  correo: string;
  telefono?: { codigoPais: string; numero: string };
}

export interface Receptor {
  nombre: string;
  identificacion?: Identificacion;
  correo?: string;
}

export interface LineaDetalle {
  numeroLinea: number;
  codigoCabys: string; // CABYS (13 dígitos)
  cantidad: number;
  unidadMedida: string; // catálogo UNECE (ej. "Unid", "Sp")
  detalle: string;
  precioUnitario: number;
  montoTotal: number;
  descuento?: number;
  subTotal: number;
  impuesto?: LineaImpuesto[];
  montoTotalLinea: number;
}

export interface LineaImpuesto {
  codigo: string; // ej. "01" IVA
  codigoTarifa?: string;
  tarifa: number; // %
  monto: number;
}

/** Datos de negocio para construir un comprobante (independiente de Hacienda). */
export interface DatosComprobante {
  tipo: TipoComprobante;
  ambiente: AmbienteHacienda;
  consecutivo: string; // consecutivo de 20 dígitos del emisor
  fechaEmision: string; // ISO 8601
  condicionVenta: CondicionVenta;
  moneda: string; // ISO 4217 (ej. "CRC", "USD")
  tipoCambio?: number;
  emisor: Emisor;
  receptor?: Receptor;
  lineas: LineaDetalle[];
  totalComprobante: number;
}

/** Clave numérica de 50 dígitos + info derivada. */
export interface ClaveNumerica {
  clave: string; // 50 dígitos
  codigoSeguridad: string; // 8 dígitos
  consecutivo: string; // 20 dígitos
}

/** Credenciales del IDP de Hacienda (OAuth). */
export interface CredencialesHacienda {
  ambiente: AmbienteHacienda;
  usuario: string; // usuario del ATV / API
  clave: string;
  clientId: string; // "api-stag" | "api-prod"
}

export interface TokenHacienda {
  accessToken: string;
  refreshToken: string;
  expiraEn: number; // epoch ms
}

/** Certificado de firma del emisor (.p12) + su PIN. */
export interface CertificadoFirma {
  p12: Uint8Array; // contenido del .p12
  pin: string;
}

export type EstadoComprobante = "recibido" | "procesando" | "aceptado" | "rechazado" | "error";

export interface RespuestaEnvio {
  clave: string;
  estado: EstadoComprobante;
  /** XML de respuesta (mensaje-hacienda) cuando ya está resuelto. */
  respuestaXml?: string;
  mensaje?: string;
}
