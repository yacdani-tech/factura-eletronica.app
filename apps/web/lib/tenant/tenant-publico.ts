import { headers } from "next/headers";

import { createAdminClient } from "@/lib/supabase/admin";
import { TENANT_SUBDOMAIN_HEADER } from "@/lib/tenant/subdominio";

/**
 * Lookup MÍNIMO de "existencia de tenant" por subdominio, para el gate
 * server-side de los layouts (`lib/tenant/gate-subdominio.ts`).
 *
 * SIEMPRE por SUBDOMINIO (regla dura #1) — el subdominio sale del header
 * interno que escribe `middleware.ts` (`TENANT_SUBDOMAIN_HEADER`), nunca de un
 * id/param que mande el cliente.
 *
 * Usa el cliente `service_role` (`createAdminClient`, protegido por su propio
 * `import "server-only"`) porque un request SIN sesión (o con sesión de OTRO
 * tenant) no puede leer `public.tenants` vía RLS — la misma imposibilidad
 * estructural que documenta `lib/supabase/admin.ts`. Este módulo es un lector
 * angosto: solo resuelve "¿existe un tenant con este subdominio, y está
 * activo?", nada más.
 */

export type ResultadoTenantPublico =
  | { tenant: { tenantId: string; nombre: string; logoUrl: string | null } }
  | { error: "sin_subdominio" | "no_encontrado" | "bloqueado" | "error_servidor" };

interface FilaTenantPublico {
  id: string;
  nombre: string;
  logo_url: string | null;
  estado: "activo" | "bloqueado";
}

export async function resolverTenantPublicoPorSubdominio(subdominio: string): Promise<ResultadoTenantPublico> {
  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch (err) {
    console.error(
      "[tenant] no se pudo crear el cliente admin (¿falta SUPABASE_SERVICE_ROLE_KEY?):",
      err instanceof Error ? err.message : err,
    );
    return { error: "error_servidor" };
  }

  const { data, error } = await admin
    .from("tenants")
    .select("id, nombre, logo_url, estado")
    .eq("subdominio", subdominio)
    .maybeSingle<FilaTenantPublico>();

  if (error) {
    console.error("[tenant] error resolviendo tenant por subdominio:", error.message);
    return { error: "error_servidor" };
  }
  if (!data) return { error: "no_encontrado" };
  if (data.estado !== "activo") return { error: "bloqueado" };

  return { tenant: { tenantId: data.id, nombre: data.nombre, logoUrl: data.logo_url } };
}

/**
 * Punto de entrada REAL para Server Components/Actions: lee el subdominio
 * SIEMPRE del header interno de la request actual (regla dura #1). No acepta
 * ningún argumento a propósito.
 */
export async function resolverTenantPublicoDesdeRequest(): Promise<ResultadoTenantPublico> {
  const encabezados = await headers();
  const subdominio = encabezados.get(TENANT_SUBDOMAIN_HEADER);
  if (!subdominio) return { error: "sin_subdominio" };
  return resolverTenantPublicoPorSubdominio(subdominio);
}
