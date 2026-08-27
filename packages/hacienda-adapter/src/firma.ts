import type { CertificadoFirma } from "./tipos";

const NO_IMPLEMENTADO =
  "hacienda-adapter STUB: implementación pendiente (requiere certificado de firma).";

/**
 * Firma el XML del comprobante con XAdES-EPES (perfil exigido por Hacienda CR).
 *
 * TODO(real): cargar el .p12 (`certificado.p12` + `certificado.pin`), generar la
 * firma XML enveloped con las propiedades XAdES-EPES (SigningTime,
 * SigningCertificate, SignaturePolicyIdentifier con el OID de la política de
 * Hacienda) y devolver el XML firmado. Correr SOLO en runtime Node (no Edge);
 * las llaves viven exclusivamente en `apps/api`.
 */
export function firmarXadesEpes(_xml: string, _certificado: CertificadoFirma): Promise<string> {
  return Promise.reject(new Error(NO_IMPLEMENTADO));
}
