import { NextResponse, type NextRequest } from "next/server";

// === DIAGNÓSTICO TEMPORAL ===
// Envuelve la lógica real (imports dinámicos, para atrapar también errores de
// carga de módulo) y expone el error exacto en el header `x-mw-error`, para
// diagnosticar el MIDDLEWARE_INVOCATION_FAILED de Vercel sin acceso a runtime logs.
export async function middleware(request: NextRequest) {
  try {
    const { updateSession } = await import("./lib/supabase/middleware");
    const { resolverSubdominio, obtenerDominioRaiz, TENANT_SUBDOMAIN_HEADER } =
      await import("./lib/tenant/subdominio");

    const subdominio = resolverSubdominio(request.headers.get("host"), obtenerDominioRaiz());
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set(TENANT_SUBDOMAIN_HEADER, subdominio ?? "");

    const { response } = await updateSession(request, requestHeaders);
    response.headers.set("x-mw-ok", "1");
    return response;
  } catch (e: unknown) {
    const err = e as { stack?: string; message?: string };
    const msg = (err?.stack || err?.message || String(e)).slice(0, 450).replace(/\s+/g, " ");
    return new NextResponse("MW_DIAG", {
      status: 500,
      headers: { "x-mw-error": msg },
    });
  }
}

export const config = {
  runtime: "nodejs",
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
