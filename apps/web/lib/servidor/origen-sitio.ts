import { headers } from "next/headers";

/**
 * Origen (protocolo + host) del sitio para armar URLs absolutas server-side
 * (`emailRedirectTo`, `redirectTo` de OAuth, enlaces de invitación, etc.).
 * Deriva SIEMPRE del header `Host` de la request actual primero (dev: http
 * para localhost/127.0.0.1; cualquier otro host, incluida cada preview de
 * Vercel, https) — así cada entorno vuelve a sí mismo sin configuración
 * manual. `NEXT_PUBLIC_SITE_URL` es solo un fallback explícito para el caso
 * (raro) de no poder leer el header Host.
 *
 * (Corregido 2026-07-15 #1: antes priorizaba `NEXT_PUBLIC_SITE_URL` por
 * encima del host real — si esa env var quedaba seteada en Vercel con el
 * valor de `.env.local`, TODO login con Google en producción volvía a
 * localhost:3000 en vez de a `web.factura-eletronica.app`.)
 *
 * (Corregido 2026-07-15 #2: `host.startsWith("localhost")` no cubre
 * subdominios de tenant en dev, ej. `demo.localhost:3000` — ese host NO
 * empieza con "localhost", así que caía al `else` y devolvía `https://
 * demo.localhost:3000`. Con protocolo `https` en un dev server que sirve por
 * `http`, el `redirectTo` de OAuth dejaba de matchear cualquier entrada
 * `http://*.localhost:3000/**` de Supabase — no era un problema de
 * configuración, era el protocolo mal calculado acá. Confirmado inspeccionando
 * el `redirect_to` real en Network tab, no por suposición.)
 *
 * Extraído de `lib/auth/acciones.ts` (Fase 2) para reusarlo también en
 * `lib/staff/acciones.ts` (Fase 4) sin duplicar la lógica.
 */
function esHostLocal(host: string): boolean {
  return /^(.*\.)?localhost(:\d+)?$/.test(host) || host.startsWith("127.0.0.1");
}

export async function origenSitio(): Promise<string> {
  const encabezados = await headers();
  const host = encabezados.get("host");

  if (host) {
    const protocolo = esHostLocal(host) ? "http" : "https";
    return `${protocolo}://${host}`;
  }

  return process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
}
