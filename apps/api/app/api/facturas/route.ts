import { NextResponse } from "next/server";

import {
  generarClaveNumerica,
  construirXmlFactura,
  firmarXadesEpes,
  obtenerTokenHacienda,
  enviarAHacienda,
  type DatosComprobante,
  type CertificadoFirma,
  type CredencialesHacienda,
} from "@factura/hacienda-adapter";

/**
 * STUB de emisión de factura electrónica (Hacienda CR).
 *
 * Aquí vivirá el FLUJO REAL: clave numérica → XML v4.4 → firma XAdES-EPES →
 * token OAuth del IDP → envío a recepción de Hacienda → consulta de estado.
 * Es exclusivo de `apps/api` porque es la única superficie autorizada a usar
 * `service_role` y las llaves de firma (`.p12` + PIN) / credenciales del IDP.
 *
 * Hoy `@factura/hacienda-adapter` es un STUB tipado: cada paso lanza
 * "no implementado". Envolvemos las llamadas para que la respuesta sea un 501
 * EXPLÍCITO en vez de un throw sin capturar.
 */
export const dynamic = "force-dynamic";

export async function POST(): Promise<NextResponse> {
  // Placeholders: el request real proveerá estos datos (validados con Zod).
  const datos = {} as DatosComprobante;
  const certificado = {} as CertificadoFirma;
  const credenciales = {} as CredencialesHacienda;

  try {
    const clave = generarClaveNumerica(datos);
    const xml = construirXmlFactura(datos, clave);
    const xmlFirmado = await firmarXadesEpes(xml, certificado);
    const token = await obtenerTokenHacienda(credenciales);
    await enviarAHacienda(xmlFirmado, token);
  } catch {
    // El stub siempre cae aquí. Cuando el adaptador esté implementado, este
    // catch pasará a mapear errores reales de Hacienda a respuestas HTTP.
  }

  return NextResponse.json(
    { error: "no implementado", detalle: "hacienda-adapter es stub" },
    { status: 501 },
  );
}
