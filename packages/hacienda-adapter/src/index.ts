/**
 * @factura/hacienda-adapter — adaptador de facturación electrónica de Costa Rica.
 *
 * STUB tipado: define el contrato completo del flujo (clave numérica → XML →
 * firma XAdES-EPES → OAuth → envío/consulta a Hacienda). La implementación real
 * se difiere y vive SOLO en `apps/api` (llaves de firma y credenciales nunca en web).
 */
export * from "./tipos";
export { generarClaveNumerica } from "./clave-numerica";
export { construirXmlFactura } from "./xml";
export { firmarXadesEpes } from "./firma";
export {
  obtenerTokenHacienda,
  enviarAHacienda,
  consultarEstadoHacienda,
} from "./hacienda-api";
