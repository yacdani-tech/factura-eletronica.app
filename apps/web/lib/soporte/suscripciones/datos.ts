import { createClient } from "@/lib/supabase/server";
import type { EstadoTenant } from "@/lib/soporte/plataforma/datos";
import type { EstadoSuscripcionFactura } from "@/lib/suscripcion/tipos";
import type { SuscripcionTenantFila, SuscripcionesTenantResumen } from "@/lib/soporte/suscripciones/tipos";

/**
 * Capa de datos SERVER-ONLY de la consola de suscripciones del super-admin.
 * Todas las lecturas cross-tenant pasan por RPC `SECURITY DEFINER` con guard
 * interno `private.is_super_admin()` (migración `20260815095000`) — este
 * módulo NO arma queries directas contra `suscripcion_facturas`.
 */

/** Shape crudo (snake_case) de una fila de `listar_suscripciones_tenants()`. */
interface FilaSuscripcionRpc {
  tenant_id: string;
  nombre: string;
  subdominio: string;
  estado_tenant: EstadoTenant;
  plan_nombre: string | null;
  monto_usd: string | number | null;
  estado_factura: EstadoSuscripcionFactura | null;
  fecha_vencimiento: string | null;
  dias_atraso: number | null;
  tiene_comprobante: boolean | null;
  factura_id: string | null;
}

function mapearFila(fila: FilaSuscripcionRpc): SuscripcionTenantFila {
  return {
    tenantId: fila.tenant_id,
    nombre: fila.nombre,
    subdominio: fila.subdominio,
    estadoTenant: fila.estado_tenant,
    planNombre: fila.plan_nombre,
    // Dinero: se conserva como STRING (nunca float). El RPC devuelve numeric,
    // que el driver puede entregar como string o number según la config.
    montoUsd: fila.monto_usd === null ? null : String(fila.monto_usd),
    estadoFactura: fila.estado_factura,
    fechaVencimiento: fila.fecha_vencimiento,
    diasAtraso: fila.dias_atraso ?? 0,
    tieneComprobante: fila.tiene_comprobante ?? false,
    facturaId: fila.factura_id,
  };
}

/**
 * Asegura (genera si faltan) las facturas de suscripción de TODOS los tenants
 * hasta el ciclo vigente, vía RPC de super-admin. Best-effort: un fallo acá NO
 * bloquea la lectura (el listado igual muestra lo que ya exista). Devuelve la
 * cantidad de facturas nuevas insertadas, o `null` ante error.
 */
export async function asegurarFacturasSuscripcionTodos(): Promise<number | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("asegurar_facturas_suscripcion_todos");
  if (error) {
    console.error("[suscripciones] asegurar_facturas_suscripcion_todos falló:", error.message);
    return null;
  }
  return typeof data === "number" ? data : null;
}

/**
 * Lista 1 fila por tenant con su factura de suscripción vigente. Llama primero
 * a la generación idempotente (best-effort) para que el listado refleje el
 * ciclo vigente aunque el cron todavía no haya corrido hoy.
 */
export async function listarSuscripcionesTenants(): Promise<SuscripcionesTenantResumen> {
  await asegurarFacturasSuscripcionTodos();

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("listar_suscripciones_tenants");

  if (error) {
    console.error("[suscripciones] listar_suscripciones_tenants falló:", error.message);
    return { filas: [], error: true };
  }

  const filas = Array.isArray(data) ? (data as FilaSuscripcionRpc[]).map(mapearFila) : [];
  return { filas, error: false };
}
