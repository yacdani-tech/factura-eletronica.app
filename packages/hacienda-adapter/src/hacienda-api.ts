import type {
  CredencialesHacienda,
  RespuestaEnvio,
  TokenHacienda,
} from "./tipos";

const NO_IMPLEMENTADO =
  "hacienda-adapter STUB: implementación pendiente (requiere credenciales del IDP).";

/**
 * Obtiene un token OAuth del IDP de Hacienda (Keycloak).
 * TODO(real): POST al token endpoint del IDP (sandbox/prod) con
 * grant_type=password, `client_id` según ambiente, usuario/clave del emisor.
 */
export function obtenerTokenHacienda(_cred: CredencialesHacienda): Promise<TokenHacienda> {
  return Promise.reject(new Error(NO_IMPLEMENTADO));
}

/**
 * Envía el comprobante firmado a la API de recepción de Hacienda.
 * TODO(real): POST /recepcion con el XML firmado (base64) + metadata (clave,
 * fecha, emisor, receptor, callback). Devuelve estado inicial (recibido).
 */
export function enviarAHacienda(
  _xmlFirmado: string,
  _token: TokenHacienda,
): Promise<RespuestaEnvio> {
  return Promise.reject(new Error(NO_IMPLEMENTADO));
}

/**
 * Consulta el estado de un comprobante ya enviado.
 * TODO(real): GET /recepcion/{clave} con el token; parsear el mensaje-hacienda.
 */
export function consultarEstadoHacienda(
  _clave: string,
  _token: TokenHacienda,
): Promise<RespuestaEnvio> {
  return Promise.reject(new Error(NO_IMPLEMENTADO));
}
