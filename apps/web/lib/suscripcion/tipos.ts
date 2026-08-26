/**
 * Tipos PUROS de la suscripción de la plataforma a sus tenants (sin imports de
 * Next/Supabase — seguro de importar desde componentes `"use client"`).
 *
 * Espeja el enum de BD `public.estado_suscripcion_factura` (migración
 * `20260815091000`): pendiente -> reportado -> pagado.
 */
export type EstadoSuscripcionFactura = "pendiente" | "reportado" | "pagado";
