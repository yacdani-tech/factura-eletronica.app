import { createClient } from "@factura/db/supabase/server";

export type EstadoTenant = "activo" | "bloqueado";

export interface TenantConsola {
  id: string;
  nombre: string;
  subdominio: string;
  estado: EstadoTenant;
  planNombre: string | null;
  creadoEn: string;
}

export interface ResultadoListaTenants {
  tenants: TenantConsola[];
  error: boolean;
}

interface FilaTenantLista {
  id: string;
  nombre: string;
  subdominio: string;
  estado: EstadoTenant;
  plan_id: string | null;
  creado_en: string;
}

interface FilaPlan {
  id: string;
  nombre: string;
}

/**
 * Lista de cuentas (tenants) para la consola de plataforma (super-admin). RLS
 * (`tenants_ver_propio_o_super_admin`) ya deja ver TODOS los tenants a un
 * super-admin; para cualquier otro rol devolvería como mucho el propio, así
 * que esta función no re-valida el rol (la página que la llama ya exige
 * `esSuperAdmin` antes de renderizar la consola).
 *
 * El nombre del plan se resuelve con un segundo `select` en memoria (sin embed
 * de PostgREST) para no acoplarse a la forma exacta del schema.
 */
export async function listarTenants(): Promise<ResultadoListaTenants> {
  const supabase = await createClient();

  const tenantsResp = await supabase
    .from("tenants")
    .select("id, nombre, subdominio, estado, plan_id, creado_en")
    .order("creado_en", { ascending: false })
    .order("id", { ascending: true });

  if (tenantsResp.error) {
    console.error("[plataforma] listarTenants: error leyendo tenants:", tenantsResp.error.message);
    return { tenants: [], error: true };
  }

  const filas = (tenantsResp.data ?? []) as FilaTenantLista[];
  const planIds = Array.from(new Set(filas.map((f) => f.plan_id).filter((id): id is string => id !== null)));

  let planesPorId = new Map<string, string>();
  if (planIds.length > 0) {
    const planesResp = await supabase.from("planes").select("id, nombre").in("id", planIds);
    if (planesResp.error) {
      console.error("[plataforma] listarTenants: error leyendo planes:", planesResp.error.message);
    } else {
      planesPorId = new Map(((planesResp.data ?? []) as FilaPlan[]).map((p) => [p.id, p.nombre]));
    }
  }

  const tenants: TenantConsola[] = filas.map((f) => ({
    id: f.id,
    nombre: f.nombre,
    subdominio: f.subdominio,
    estado: f.estado,
    planNombre: f.plan_id ? planesPorId.get(f.plan_id) ?? null : null,
    creadoEn: f.creado_en,
  }));

  return { tenants, error: false };
}
