import { NextResponse } from "next/server";

// === DIAGNÓSTICO: middleware MÍNIMO (sin Supabase, Edge por defecto) ===
// Si esto responde 200/redirect (funciona), el crash venía de Supabase en el
// bundle. Si esto TAMBIÉN da MIDDLEWARE_INVOCATION_FAILED, el problema es de
// configuración del proyecto en Vercel, no del código.
export function middleware() {
  return NextResponse.next({ headers: { "x-mw-min": "1" } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
