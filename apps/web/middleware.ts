import { NextResponse, type NextRequest } from "next/server";

// NOTA (deploy Vercel): imports RELATIVOS a propósito, no el alias `@/`. El
// bundler del Edge Runtime que compila el middleware en Vercel (monorepo con
// Root Directory en `apps/web`) no resuelve los `paths` del tsconfig y falla con
// "The Edge Function 'middleware' is referencing unsupported modules". Las
// páginas sí resuelven `@/` (se compilan aparte), pero el middleware NO — por eso
// acá van relativos. Sus dependencias no usan `@/`, así que el grafo Edge cierra.
import { updateSession } from "@factura/db/supabase/middleware";
import { TENANT_SUBDOMAIN_HEADER, obtenerDominioRaiz, resolverSubdominio } from "@factura/core/tenant/subdominio";
import { isMaintenanceMode } from "@factura/core/maintenance";
import { PATHNAME_HEADER } from "./lib/servidor/pathname-header";

const RUTA_MANTENIMIENTO = "/mantenimiento";

/**
 * Rutas de auth accesibles SIN sesión. Con sesión activa, redirigen a
 * `/dashboard` (no tiene sentido loguearse/registrarse dos veces).
 */
const RUTAS_AUTH_PUBLICAS = ["/login", "/registro"];

/**
 * Rutas que SIEMPRE pasan, con o sin sesión, sin rebotar en ningún sentido:
 * - `/auth/callback`: el callback de OAuth/confirmación de correo (todavía no
 *   hay sesión en el primer tramo del flujo).
 * - `/invitacion`: el enlace de invitación (REG-2) es el ÚNICO punto de
 *   creación de cuenta de staff. Un invitado SIN cuenta debe poder llegar acá
 *   sin sesión (crea su cuenta con el correo fijado a la invitación); uno CON
 *   sesión ve el botón de aceptar (o el aviso de "otro correo"). Por eso NO se
 *   rebota a `/login` sin sesión NI a `/dashboard` con sesión — la propia
 *   página resuelve los 4 estados. (Antes de REG-2 esta ruta exigía sesión y
 *   rebotaba a `/login?next=`; ese rebote rompía el flujo de invitado nuevo.)
 * - `/robots.txt`: bug preexistente detectado al agregar el modo mantenimiento
 *   — sin esta excepción, un crawler anónimo caía en el paso 4 (requiere
 *   sesión) y recibía un 307 a `/login?next=/robots.txt` en vez del archivo
 *   real, sin importar el modo mantenimiento.
 */
const RUTAS_SIEMPRE_PUBLICAS = ["/auth/callback", "/robots.txt"];

/**
 * Rutas públicas de NEGOCIO sin sesión (pasan con o sin sesión, sin rebote en
 * ningún sentido, pero SÍ sujetas al modo mantenimiento). Vacío en el
 * esqueleto — cada producto que use esta base agrega las suyas (ej. un
 * registro público, un enlace de capability URL). Se resuelven por SUBDOMINIO
 * (regla dura #1).
 */
const RUTAS_PUBLICAS_SIN_SESION: string[] = [];

/** Rutas que deben responder igual, mantenimiento o no (nunca muestran la página de mantenimiento). */
const RUTAS_EXENTAS_DE_MANTENIMIENTO = [RUTA_MANTENIMIENTO, ...RUTAS_SIEMPRE_PUBLICAS];

function coincideRuta(pathname: string, ruta: string): boolean {
  return pathname === ruta || pathname.startsWith(`${ruta}/`);
}

/** Copia las cookies (ya refrescadas por Supabase) de una respuesta a otra antes de redirigir. */
function redirigirConservandoCookies(url: URL, origen: NextResponse): NextResponse {
  const destino = NextResponse.redirect(url);
  origen.cookies.getAll().forEach((cookie) => destino.cookies.set(cookie));
  return destino;
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // -1) Rutas de CRON `/api/cron/*` (PRIMERA agregada 2026-08-17:
  // `/api/cron/flush-suscripcion-facturada`, ver
  // `docs/arquitectura/contratos-transversales.md` §t): pasan SIN resolución de
  // tenant/sesión/mantenimiento. No son parte del app shell — son
  // infraestructura (ej. un Cron de Vercel pegándole con `Authorization:
  // Bearer`, sin ninguna cookie de sesión de Supabase) y cada una implementa su
  // PROPIA autenticación por secreto (ver el comentario de la ruta en
  // cuestión). Dejar que siguieran el camino normal del middleware las haría
  // rebotar SIEMPRE a `/login` (paso 4, "sin sesión -> /login") antes de que el
  // handler de la ruta llegue a evaluar su propio secreto — un 307 en vez del
  // 401/200 JSON esperado por el llamador.
  //
  // ACOTADO A PROPÓSITO a `/api/cron/*` (decisión de Yac 2026-08-17), NO a todo
  // `/api/*`: una futura ruta `/api` que NO sea de cron NO hereda este bypass
  // por accidente — sigue el camino normal del middleware salvo que se agregue
  // acá explícitamente. Una ruta `/api` que necesite sesión de usuario valida
  // `auth.uid()` ella misma (con `createClient()` de servidor), sin
  // reintroducir el acoplamiento a este middleware.
  if (pathname === "/api/cron" || pathname.startsWith("/api/cron/")) {
    return NextResponse.next();
  }

  // 0) Modo mantenimiento (env var + redeploy, sin tocar código — mismo
  // patrón que apps/landing): corta ANTES de resolver tenant/sesión, para
  // que ninguna ruta (ni siquiera subdominios de tenant) muestre la app real
  // mientras está activo.
  if (isMaintenanceMode() && !RUTAS_EXENTAS_DE_MANTENIMIENTO.includes(pathname)) {
    return NextResponse.rewrite(new URL(RUTA_MANTENIMIENTO, request.url));
  }

  // 1) Tenant por SUBDOMINIO (regla dura #1): se deriva del header Host,
  // NUNCA de algo que mande el cliente en body/query. Se expone a la app vía
  // un header interno; la resolución BD real (¿existe ese tenant? ¿está
  // bloqueado?) se hace server-side en layouts/helpers con RLS, no acá.
  const subdominio = resolverSubdominio(request.headers.get("host"), obtenerDominioRaiz());

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(TENANT_SUBDOMAIN_HEADER, subdominio ?? "");
  // Pathname expuesto para Server Components (ej. `app/(app)/layout.tsx`,
  // tarea 2.1): decide si un Super-Admin sin tenant seleccionado puede
  // igual renderizar la consola de soporte (`/soporte` y sub-rutas) en vez
  // de ser redirigido — ver `lib/soporte/rutas.ts`.
  requestHeaders.set(PATHNAME_HEADER, pathname);

  // 2) Sesión: refresca el token y sincroniza cookies (Supabase SSR).
  const { response, user } = await updateSession(request, requestHeaders);
  response.headers.set(TENANT_SUBDOMAIN_HEADER, subdominio ?? "");

  // 3) Rutas que siempre pasan (callback de auth, enlace de invitación): sin
  // evaluar sesión y sin rebotar en ningún sentido (ver RUTAS_SIEMPRE_PUBLICAS).
  if (RUTAS_SIEMPRE_PUBLICAS.some((ruta) => coincideRuta(pathname, ruta))) {
    return response;
  }

  // Registro público de subclientes: sin sesión, sin rebote en ningún
  // sentido (ver comentario de RUTAS_PUBLICAS_SIN_SESION) — pero SÍ pasó ya
  // por el chequeo de mantenimiento de arriba, a diferencia de las rutas
  // "siempre públicas".
  if (RUTAS_PUBLICAS_SIN_SESION.some((ruta) => coincideRuta(pathname, ruta))) {
    return response;
  }

  const esRutaAuthPublica = RUTAS_AUTH_PUBLICAS.some((ruta) => coincideRuta(pathname, ruta));

  if (esRutaAuthPublica) {
    if (user) {
      const url = request.nextUrl.clone();
      url.pathname = "/dashboard";
      url.search = "";
      return redirigirConservandoCookies(url, response);
    }
    return response;
  }

  // 4) Cualquier otra ruta del app shell requiere sesión. Sin sesión ->
  // /login, preservando `next` para volver adonde el usuario iba.
  if (!user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("next", pathname + search);
    return redirigirConservandoCookies(url, response);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Todas las rutas excepto:
     * - _next/static, _next/image
     * - favicon y archivos estáticos comunes
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
