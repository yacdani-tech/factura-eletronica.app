import { createClient } from "../supabase/server";

export interface BrandingTenant {
  nombre: string;
  logoUrl: string | null;
}

interface FilaBrandingTenant {
  nombre: string;
  logo_url: string | null;
}

/**
 * Branding mínimo del tenant para el app shell (sidebar): nombre + logo (si
 * existe; `null` = usar el logo default de la plataforma). `tenantId` SIEMPRE
 * viene de la sesión en el caller (regla dura #1 — nunca de la URL/formulario).
 * Degrada a `null` ante error (console.error), nunca revienta el shell.
 */
export async function obtenerBrandingTenant(tenantId: string): Promise<BrandingTenant | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tenants")
    .select("nombre, logo_url")
    .eq("id", tenantId)
    .maybeSingle<FilaBrandingTenant>();

  if (error) {
    console.error("[tenant] obtenerBrandingTenant: error leyendo tenants:", error.message);
  }
  if (!data) return null;

  return { nombre: data.nombre, logoUrl: data.logo_url };
}
