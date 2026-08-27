/**
 * Health check de la superficie API. `ts` se computa DENTRO del handler (nunca
 * a nivel de módulo) para que refleje el momento de la request y no el del build.
 */
export const dynamic = "force-dynamic";

export function GET(): Response {
  return Response.json({ ok: true, ts: new Date().toISOString() });
}
