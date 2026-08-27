import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { textosAuth } from "@/lib/textos/auth";
import { rutaInternaSegura } from "@factura/core/validaciones/redireccion";
import { procesarPostLogin } from "@/lib/soporte/despues-de-login";

export const dynamic = "force-dynamic";

/**
 * Callback de OAuth (Google) y de confirmación de correo (signUp con
 * `emailRedirectTo`). Ambos flujos de Supabase Auth llegan acá con un `code`
 * en la query string para intercambiar por sesión.
 *
 * Seguridad: `next` se valida como ruta interna relativa (anti open-redirect
 * — nunca se redirige a una URL arbitraria que venga en la query string).
 * Validación real en `lib/validaciones/redireccion.ts` (compartida con
 * `lib/auth/acciones.ts`).
 *
 * Destino post-login (decisión de Yac 2026-07-17, ronda 2 — "sesión de
 * plataforma fresca"): ver el contrato completo en el comentario de
 * `procesarPostLogin` (`lib/soporte/despues-de-login.ts`). En una sola
 * llamada: (a) resuelve si el usuario es Super-Admin (UNA consulta a
 * `super_admins`), (b) si lo es, borra best-effort su selección activa de
 * soporte para que el login SIEMPRE aterrice en una consola limpia (sin el
 * shell de un tenant "heredado" de una sesión anterior), y (c) calcula el
 * destino final — `/soporte` para Super-Admin (salvo deep-link a la propia
 * consola), `next` o `/dashboard` para cualquier otro usuario.
 */

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const nextExplicito = rutaInternaSegura(searchParams.get("next"));
  const errorDescripcion = searchParams.get("error_description");

  if (errorDescripcion) {
    console.error("[auth] callback recibió error del proveedor:", errorDescripcion);
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(textosAuth.errores.generico)}`,
    );
  }

  if (!code) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(textosAuth.errores.linkInvalido)}`,
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    console.error("[auth] exchangeCodeForSession falló:", error.code ?? error.status, error.message);
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(textosAuth.errores.linkInvalido)}`,
    );
  }

  // Bug 2026-07-16: un Super-Admin sin fila en `super_admin_tenant_activo`
  // caía en el placeholder "Modo plataforma" sin más salida que "Cerrar
  // sesión". Guardia explícita (no delegada solo a un `if (!user)` interno):
  // el tipo de supabase-js garantiza `data.user` no-nulo cuando `error` es
  // null, pero este código NUNCA debe confiar ciegamente en ese contrato de
  // tipos en runtime. Si alguna vez no se cumple, se loguea EXPLÍCITAMENTE
  // acá (caso anómalo, no un silencio) y el redirect sigue exactamente
  // igual — `procesarPostLogin` ya maneja `user: null` sin romperse (ver su
  // comentario), así que no hace falta un `if` que la salte.
  if (!data.user) {
    console.error(
      "[auth] callback: exchangeCodeForSession devolvió error null pero data.user null (caso inesperado) — se omite el post-login, se continúa el redirect",
    );
  }

  // `try/catch` acá es DEFENSA EN PROFUNDIDAD en el caller: `procesarPostLogin`
  // ya nunca lanza por su propio contrato (cada pieza con I/O atrapa sus
  // propios errores), pero si ese contrato alguna vez se rompiera, este
  // callback NO debe fallar por eso — cae al destino mínimo seguro (`next` o
  // `/dashboard`) en vez de un 500. El `NextResponse.redirect(...)` de abajo
  // queda fuera del try/catch a propósito: un Route Handler simplemente
  // RETORNA la respuesta, no lanza (a diferencia de `redirect()` de Server
  // Actions), así que no hay nada que "atrapar accidentalmente" ahí.
  let next: string;
  try {
    next = await procesarPostLogin(supabase, data.user, nextExplicito);
  } catch (postLoginError) {
    console.error(
      "[auth] callback: procesarPostLogin lanzó de forma inesperada (no bloquea el login):",
      postLoginError instanceof Error ? postLoginError.message : postLoginError,
    );
    next = nextExplicito ?? "/dashboard";
  }

  return NextResponse.redirect(`${origin}${next}`);
}
