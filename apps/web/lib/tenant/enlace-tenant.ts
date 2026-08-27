import { headers } from "next/headers";

import { obtenerDominioRaiz } from "@factura/core/tenant/subdominio";

/**
 * Construye la URL pública ABSOLUTA de un subdominio de tenant dado (ej. para
 * que el dashboard del courier ofrezca copiar el link de
 * `/registro-cliente` — decisión de Yac 2026-07-10, tarea 2.3 fase 4).
 *
 * A propósito NO reusa `origenSitio()` (`lib/servidor/origen-sitio.ts`) tal
 * cual: ese helper devuelve el origen de la request ACTUAL (protocolo+host
 * literal), útil para redirects de auth donde el visitante YA está en el
 * host correcto. Acá el caso es distinto — un Super-Admin en "modo soporte"
 * (SA-2) puede estar viendo el dashboard de un tenant desde el dominio de
 * PLATAFORMA (`web.factura-eletronica.app`), no desde el subdominio real del
 * courier — el link que se comparte con clientes finales SIEMPRE debe
 * apuntar al subdominio REAL del tenant, sin importar desde dónde lo esté
 * viendo el operador. Por eso esta función arma el host desde el
 * `subdominio` recibido, y usa el header `Host` de la request ÚNICAMENTE
 * para decidir protocolo (local -> `http`) y preservar el puerto de dev.
 *
 * Mismo criterio "host local = http" que `origenSitio()`, y mismo `null`
 * defensivo de `obtenerDominioRaiz()` (fallback a `factura-eletronica.app`).
 *
 * Limitación conocida (igual que `resolverSubdominio`, `lib/tenant/subdominio.ts`):
 * en un preview de Vercel (`*.vercel.app`) no hay forma real de construir un
 * subdominio de tenant — se arma igual con el dominio raíz configurado
 * (`factura-eletronica.app` por defecto), que no resolverá en ese entorno. No es un
 * caso real de producción.
 */
export async function construirUrlPublicaTenant(subdominio: string, ruta: string): Promise<string> {
  const encabezados = await headers();
  const hostCrudo = (encabezados.get("host") ?? "").trim().toLowerCase();
  const { host, puerto } = separarPuerto(hostCrudo);

  const esLocal = host === "localhost" || host === "127.0.0.1" || host.endsWith(".localhost") || host === "";
  const protocolo = esLocal ? "http" : "https";
  const raiz = esLocal ? "localhost" : obtenerDominioRaiz();

  return `${protocolo}://${subdominio}.${raiz}${puerto}${ruta}`;
}

function separarPuerto(host: string): { host: string; puerto: string } {
  if (host.startsWith("[") || host === "") return { host, puerto: "" };
  const idx = host.lastIndexOf(":");
  return idx === -1 ? { host, puerto: "" } : { host: host.slice(0, idx), puerto: host.slice(idx) };
}
