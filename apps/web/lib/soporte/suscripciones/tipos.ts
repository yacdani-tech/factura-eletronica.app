import type { EstadoTenant } from "@/lib/soporte/plataforma/datos";
import type { EstadoSuscripcionFactura } from "@factura/core/suscripcion/tipos";

/**
 * Tipos PUROS de la consola de suscripciones del super-admin
 * (`/soporte/suscripciones`, regla dura de la plataforma "la plataforma cobra
 * a sus tenants"). Compartidos entre la capa de datos server-only
 * (`./datos.ts`, que importa `lib/supabase/server` -> `next/headers`) y los
 * componentes CLIENTE. CERO imports de Next/Supabase acá — `EstadoTenant`/
 * `EstadoSuscripcionFactura` entran con `import type` (se borran al compilar).
 */

/**
 * Una fila de `public.listar_suscripciones_tenants()` (migración
 * `20260815095000`) — 1 fila POR CADA tenant, con su factura de suscripción
 * VIGENTE (mayor `periodoInicio` ya generado). Las columnas de factura son
 * `null` si el tenant todavía no tiene ninguna generada (nunca desaparece de
 * la lista por eso).
 */
export interface SuscripcionTenantFila {
  tenantId: string;
  nombre: string;
  subdominio: string;
  estadoTenant: EstadoTenant;
  planNombre: string | null;
  /** Snapshot del precio efectivo — STRING (dinero, nunca float), `null` si no hay factura generada todavía. */
  montoUsd: string | null;
  estadoFactura: EstadoSuscripcionFactura | null;
  fechaVencimiento: string | null;
  /** `greatest(0, hoy - fechaVencimiento)` cuando hay factura y no está pagada; `0` si está pagada o no hay factura (ya resuelto por el RPC). */
  diasAtraso: number;
  tieneComprobante: boolean;
  facturaId: string | null;
}

/** Resultado de `listarSuscripcionesTenants` (`./datos.ts`). `error: true` SOLO si el RPC falló. */
export interface SuscripcionesTenantResumen {
  filas: SuscripcionTenantFila[];
  error: boolean;
}

/**
 * Estado compartido por las Server Actions de mutación
 * (`./acciones.ts`) — separado del archivo `"use server"` porque un módulo
 * `"use server"` solo puede exportar funciones async (el tipo Y el valor
 * inicial viven acá).
 */
export interface EstadoAccionSuscripcion {
  error?: string;
}

export const ESTADO_INICIAL_ACCION_SUSCRIPCION: EstadoAccionSuscripcion = {};
