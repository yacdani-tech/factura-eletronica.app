import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@factura/db/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Route handler de CIERRE DE SESIÓN por navegación (GET), FUERA del grupo
 * `(app)` (no pasa por su layout: si estuviera dentro, el propio layout que
 * dispara la expulsión lo volvería a redirigir acá en un loop).
 *
 * Motivo de existir (feature "bloquear courier expulsa a sus usuarios", regla
 * dura #15): cuando el layout del app shell detecta un miembro de un tenant
 * bloqueado (`decidirVistaAppShell` -> `"courier_bloqueado"`), NO puede cerrar
 * la sesión en su propio render — un Server Component no puede mutar cookies
 * durante el render. La forma correcta es delegar a un route handler que SÍ
 * puede escribir cookies: acá se hace `signOut()` (borra la cookie de sesión)
 * y recién entonces se redirige a `/login`. Limpiar la sesión ANTES de caer en
 * `/login` es lo que evita el loop `/login -> /dashboard -> /(app) layout ->
 * /salir` (con sesión viva, `/login` rebotearía de vuelta al área privada).
 *
 * Mismo efecto que la Server Action `cerrarSesion` (`lib/auth/acciones.ts`),
 * pero invocable por un `redirect()` (GET) desde un Server Component.
 *
 * `motivo` (opcional) se propaga a `/login` como query string para que la
 * página de login muestre el aviso correspondiente (ej.
 * `?motivo=courier_bloqueado`). Es un valor de PRESENTACIÓN, no de seguridad:
 * el login solo lo usa para elegir un texto de un catálogo fijo (nunca lo
 * renderiza crudo), así que no hace falta validarlo como ruta ni escaparlo más
 * allá de `encodeURIComponent`. Sin `motivo`, se comporta como un logout
 * normal.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const motivo = searchParams.get("motivo");

  const supabase = await createClient();
  await supabase.auth.signOut();

  const destino = motivo
    ? `${origin}/login?motivo=${encodeURIComponent(motivo)}`
    : `${origin}/login`;

  return NextResponse.redirect(destino);
}
