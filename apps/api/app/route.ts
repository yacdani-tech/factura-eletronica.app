/**
 * Ruta raíz de la superficie API. Existe para que Next tenga ≥1 ruta y para
 * un chequeo de identidad simple del servicio. App solo-rutas: sin páginas ni
 * layout (no hay UI).
 */
export function GET(): Response {
  return Response.json({ service: "factura-electronica-api", ok: true });
}
