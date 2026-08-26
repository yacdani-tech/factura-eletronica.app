"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { exigirSuperAdmin } from "@/lib/auth/exigir-super-admin";
import { idSchema, primerErrorZod } from "@/lib/validaciones/auth";

/**
 * Server Actions de mutación del workflow de pago de suscripción. Toda mutación
 * de `suscripcion_facturas` pasa por RPC `SECURITY DEFINER` (migración
 * `20260815096000`) — nunca un UPDATE directo (la tabla no tiene política de
 * UPDATE para ningún rol). El guard `exigirSuperAdmin()` es la capa de UX +
 * defensa en profundidad; la garantía real la da el guard interno de cada RPC
 * (`private.is_super_admin()`) y la RLS.
 */
export interface ErrorAccionSuscripcion {
  error: string;
}

/** Super-admin confirma el pago de una factura de suscripción (estado -> pagado). */
export async function marcarSuscripcionPagada(
  facturaId: string,
  nota?: string,
): Promise<ErrorAccionSuscripcion | void> {
  const guard = await exigirSuperAdmin();
  if (!guard.autorizado) return { error: guard.error };

  const parseo = idSchema.safeParse(facturaId);
  if (!parseo.success) return { error: primerErrorZod(parseo.error) };

  const supabase = await createClient();
  const { error } = await supabase.rpc("marcar_pago_suscripcion", {
    p_factura_id: parseo.data,
    p_nota: nota && nota.trim() !== "" ? nota.trim() : null,
  });
  if (error) return { error: error.message };

  revalidatePath("/soporte/suscripciones");
}

/** Super-admin revierte un marcado de pago erróneo (estado pagado -> pendiente). */
export async function revertirPagoSuscripcion(facturaId: string): Promise<ErrorAccionSuscripcion | void> {
  const guard = await exigirSuperAdmin();
  if (!guard.autorizado) return { error: guard.error };

  const parseo = idSchema.safeParse(facturaId);
  if (!parseo.success) return { error: primerErrorZod(parseo.error) };

  const supabase = await createClient();
  const { error } = await supabase.rpc("revertir_pago_suscripcion", { p_factura_id: parseo.data });
  if (error) return { error: error.message };

  revalidatePath("/soporte/suscripciones");
}

/**
 * El tenant de sesión reporta el pago de UNA de sus facturas (estado ->
 * reportado). La subida real del comprobante al bucket privado
 * `comprobantes-suscripcion` la hace una server action con service-role ANTES
 * de invocar esta acción; acá solo se persiste el path relativo vía RPC. Este
 * es el gancho mínimo — la UI de subida de comprobante del tenant queda para
 * el proyecto derivado.
 */
export async function reportarPagoSuscripcion(
  facturaId: string,
  comprobanteRuta: string,
  referencia?: string,
): Promise<ErrorAccionSuscripcion | void> {
  const parseo = idSchema.safeParse(facturaId);
  if (!parseo.success) return { error: primerErrorZod(parseo.error) };

  const supabase = await createClient();
  const { error } = await supabase.rpc("reportar_pago_suscripcion", {
    p_factura_id: parseo.data,
    p_comprobante_ruta: comprobanteRuta,
    p_referencia: referencia ?? null,
  });
  if (error) return { error: error.message };

  revalidatePath("/soporte/suscripciones");
}
