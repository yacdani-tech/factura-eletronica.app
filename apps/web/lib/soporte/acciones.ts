"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { exigirSuperAdmin } from "@/lib/auth/exigir-super-admin";
import { primerErrorZod, idSchema } from "@/lib/validaciones/auth";
import { textosSoporte } from "@/lib/textos/soporte";
import { RUTA_CONSOLA_SOPORTE } from "@/lib/soporte/rutas";

/**
 * Sale del modo soporte: borra la fila PROPIA del super-admin en
 * `super_admin_tenant_activo` y vuelve a la consola de plataforma.
 *
 * Regla dura #1: nunca recibe un `tenantId`/`usuario_id` de parámetro — el
 * DELETE va siempre por `eq("usuario_id", user.id)` (la sesión); la RLS
 * garantiza además que solo puede borrar su propia fila.
 */
export async function salirDeSoporte(): Promise<void> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { error } = await supabase.from("super_admin_tenant_activo").delete().eq("usuario_id", user.id);

  if (error) {
    console.error("[soporte] salirDeSoporte: error al borrar la selección:", error.message);
  }

  revalidatePath("/", "layout");
  redirect(RUTA_CONSOLA_SOPORTE);
}

/** Resultado de una acción de plataforma cuando NO redirige (fallo controlado). */
export interface ErrorAccionSoporte {
  error: string;
}

/**
 * Entra en modo soporte dentro de `tenantId`: upsert de la PROPIA fila en
 * `super_admin_tenant_activo`, pisando cualquier selección anterior.
 *
 * EXCEPCIÓN documentada a la regla dura #1: `tenantId` viene del cliente (el
 * botón "Entrar" de la lista), pero solo para ELEGIR entre los tenants que el
 * super-admin ya puede ver por RLS — el trigger de BD revalida que quien hace
 * el upsert sea un super-admin real. Orden: auth SIEMPRE primero, luego forma,
 * luego existencia, luego el upsert.
 */
export async function entrarASoporte(tenantId: string): Promise<ErrorAccionSoporte | void> {
  const resultado = await exigirSuperAdmin();
  if (!resultado.autorizado) {
    if (resultado.motivo === "sin_sesion") {
      redirect("/login");
    }
    return { error: resultado.error };
  }

  const parsedTenantId = idSchema.safeParse(tenantId);
  if (!parsedTenantId.success) {
    return { error: primerErrorZod(parsedTenantId.error) };
  }

  const supabase = await createClient();

  const { data: tenant, error: errorTenant } = await supabase
    .from("tenants")
    .select("id")
    .eq("id", parsedTenantId.data)
    .maybeSingle();

  if (errorTenant) {
    console.error("[soporte] entrarASoporte: error leyendo tenants:", errorTenant.message);
    return { error: textosSoporte.errores.errorVerificandoTenant };
  }
  if (!tenant) {
    return { error: textosSoporte.errores.tenantNoEncontrado };
  }

  const { error } = await supabase
    .from("super_admin_tenant_activo")
    .upsert(
      { usuario_id: resultado.contexto.usuario.id, tenant_id: parsedTenantId.data },
      { onConflict: "usuario_id" },
    );

  if (error) {
    console.error("[soporte] entrarASoporte: error al seleccionar el tenant:", error.message);
    return { error: textosSoporte.errores.errorAlSeleccionar };
  }

  revalidatePath("/", "layout");
  redirect("/dashboard");
}

/**
 * Cambia el estado de una cuenta (tenant) a bloqueado/activo — decisión manual
 * del super-admin. Generaliza el `bloquearCourier` del producto original.
 *
 * La columna `tenants.estado` está protegida por un guard column-level en BD
 * que rechaza cambios salvo super-admin/`service_role`; acá igual se exige
 * `exigirSuperAdmin` como capa de UX + defensa en profundidad (regla dura #3).
 */
async function cambiarEstadoTenant(
  tenantId: string,
  estado: "activo" | "bloqueado",
): Promise<ErrorAccionSoporte | void> {
  const resultado = await exigirSuperAdmin();
  if (!resultado.autorizado) {
    if (resultado.motivo === "sin_sesion") {
      redirect("/login");
    }
    return { error: resultado.error };
  }

  const parsedTenantId = idSchema.safeParse(tenantId);
  if (!parsedTenantId.success) {
    return { error: primerErrorZod(parsedTenantId.error) };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("tenants").update({ estado }).eq("id", parsedTenantId.data);

  if (error) {
    console.error("[soporte] cambiarEstadoTenant: error al actualizar estado:", error.message);
    return { error: textosSoporte.errores.errorAlBloquear };
  }

  revalidatePath("/", "layout");
}

export async function bloquearTenant(tenantId: string): Promise<ErrorAccionSoporte | void> {
  return cambiarEstadoTenant(tenantId, "bloqueado");
}

export async function desbloquearTenant(tenantId: string): Promise<ErrorAccionSoporte | void> {
  return cambiarEstadoTenant(tenantId, "activo");
}
