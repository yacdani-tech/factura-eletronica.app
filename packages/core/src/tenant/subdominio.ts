/**
 * Resolución del tenant por SUBDOMINIO (regla dura #1: el tenant se resuelve
 * SIEMPRE desde el subdominio/sesión, JAMÁS desde un valor que mande el
 * cliente). Este módulo es una función pura sin dependencias de Next.js para
 * que sea trivial de testear (qa-tests) y para poder reutilizarla tanto en
 * `middleware.ts` como en cualquier helper server-side futuro.
 *
 * Convención del proyecto (spec §3, Proyecto 2 — App):
 *   - Dominio raíz (`factura-eletronica.app`) o `web.factura-eletronica.app` -> plataforma
 *     (login/registro de cuenta, dashboard sin tenant todavía resuelto).
 *   - `www.<dominio>` -> tratado igual que el dominio raíz (alias común).
 *   - `<sub>.factura-eletronica.app` -> tenant courier (el subdominio ES el tenant).
 *   - Desarrollo: `localhost:3000` (sin subdominio) = plataforma;
 *     `<sub>.localhost:3000` = tenant `<sub>`, mismo criterio que producción.
 *
 * Importante: esta función SOLO parsea el header Host. No consulta la base de
 * datos (el middleware no debe pagar ese costo en cada request — la
 * resolución real contra `public.tenants` vive server-side en layouts/helpers
 * con RLS, más abajo en el pipeline de request).
 */

/** Nombre del header interno donde el middleware expone el subdominio resuelto. */
export const TENANT_SUBDOMAIN_HEADER = "x-tenant-subdominio";

/**
 * Subdominios que SIEMPRE representan la plataforma (marketing/dashboard sin
 * tenant), nunca un courier. Coincide con la lista de reservados de
 * `tenants_subdominio_no_reservado` (20260713090200) más 'www'.
 *
 * NO confundir con `SUBDOMINIOS_RESERVADOS` (más abajo): esta lista es solo
 * para RESOLUCIÓN de host (¿esta request es de plataforma o de un tenant?),
 * un subconjunto angosto. `SUBDOMINIOS_RESERVADOS` es la lista COMPLETA de
 * palabras prohibidas para el ALTA de un courier nuevo (COU-3) — un
 * subdominio como "admin" o "api" nunca resuelve a un tenant real (por eso
 * ni siquiera está acá), pero tampoco debe poder registrarse como uno.
 */
const SUBDOMINIOS_PLATAFORMA = new Set(["web", "www"]);

/**
 * Palabras reservadas para el ALTA de un courier (COU-3: "palabras reservadas
 * bloqueadas: app, web, api, admin, registro, etc."). Lista AUTORITATIVA y
 * actualizable acá en la app — el CHECK de BD `tenants_subdominio_no_reservado`
 * es solo defensa en profundidad (ver comentario de esa migración); si esta
 * lista crece, actualizar también el CHECK para seguir siendo consistente.
 *
 * Ampliada 2026-08-18 (feature "subdominio inexistente -> 404") con un set
 * curado de palabras de infraestructura/producto/soporte, además de las
 * originales de COU-3 — ningún subdominio de esta lista puede resolver a un
 * tenant real (no existen en BD, así que además de no poder registrarse,
 * caen solos en el 404 de `lib/tenant/gate-subdominio.ts`).
 */
export const SUBDOMINIOS_RESERVADOS = [
  "app",
  "web",
  "api",
  "admin",
  "registro",
  "www",
  "mail",
  "ftp",
  "cdn",
  "static",
  "assets",
  "blog",
  "status",
  "soporte",
  "support",
  "help",
  "ayuda",
  "dashboard",
  "panel",
  "portal",
  "cuenta",
  "account",
  "billing",
  "pagos",
  "auth",
  "login",
  "signup",
  "dev",
  "staging",
  "test",
  "demo",
  "sandbox",
  "root",
  "sistema",
  "system",
  "noreply",
  "info",
  "contacto",
  "superadmin",
] as const;

/** Formato de subdominio (COU-3: "solo a-z 0-9 -"). Espejo de `tenants_subdominio_formato` (20260713090200). */
export const FORMATO_SUBDOMINIO_REGEX = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

/**
 * `true` si `sub` es una palabra reservada — no apto para alta de courier.
 * Normaliza internamente (`trim().toLowerCase()`) para no depender de que el
 * llamador ya lo haya hecho: `esSubdominioReservado("ADMIN ")` y
 * `esSubdominioReservado("admin")` deben dar el mismo resultado, sin importar
 * si el caller es el schema Zod (que sí normaliza antes) u otro código futuro
 * que no lo haga.
 */
export function esSubdominioReservado(sub: string): boolean {
  const normalizado = sub.trim().toLowerCase();
  return (SUBDOMINIOS_RESERVADOS as readonly string[]).includes(normalizado);
}

/** Dominio raíz por defecto si no hay override por env (producción real). */
const DOMINIO_RAIZ_DEFECTO = "factura-eletronica.app";

function quitarPuerto(host: string): string {
  // IPv6 con puerto viene como "[::1]:3000" — no es un caso real de este
  // proyecto (siempre se accede por nombre de host), se deja pasar tal cual
  // si apareciera (no revienta, solo no se le detecta subdominio).
  if (host.startsWith("[")) return host;
  const idx = host.lastIndexOf(":");
  return idx === -1 ? host : host.slice(0, idx);
}

/**
 * Resuelve el subdominio de tenant a partir del header `Host` de la request.
 *
 * @param hostHeader  Valor crudo del header `Host` (puede incluir puerto).
 * @param dominioRaiz Dominio raíz de producción, sin subdominio (override vía
 *                    `NEXT_PUBLIC_APP_ROOT_DOMAIN`, útil si el dominio final
 *                    cambia). Default `factura-eletronica.app`.
 * @returns el subdominio del tenant en minúsculas, o `null` si la request es
 *          de plataforma (dominio raíz, `www.`, `web.`, o localhost sin
 *          subdominio).
 */
export function resolverSubdominio(
  hostHeader: string | null | undefined,
  dominioRaiz: string = DOMINIO_RAIZ_DEFECTO,
): string | null {
  if (!hostHeader) return null;

  const host = quitarPuerto(hostHeader.trim().toLowerCase());
  const raiz = dominioRaiz.trim().toLowerCase();

  // --- Desarrollo: localhost / 127.0.0.1 ------------------------------------
  if (host === "localhost" || host === "127.0.0.1") return null;

  if (host.endsWith(".localhost")) {
    const sub = host.slice(0, -".localhost".length);
    return sub === "" || SUBDOMINIOS_PLATAFORMA.has(sub) ? null : sub;
  }

  // --- Producción: dominio raíz configurado ---------------------------------
  if (host === raiz) return null;

  const sufijo = `.${raiz}`;
  if (host.endsWith(sufijo)) {
    const sub = host.slice(0, -sufijo.length);
    if (sub === "" || SUBDOMINIOS_PLATAFORMA.has(sub)) return null;
    return sub;
  }

  // Host que no coincide con ningún patrón conocido (dominio de preview de
  // Vercel, IP directa, etc.): se trata como plataforma (nunca se inventa un
  // tenant a partir de un host desconocido).
  return null;
}

/** Lee el dominio raíz configurado (env pública) con el fallback del proyecto. */
export function obtenerDominioRaiz(): string {
  return process.env.NEXT_PUBLIC_APP_ROOT_DOMAIN?.trim() || DOMINIO_RAIZ_DEFECTO;
}
