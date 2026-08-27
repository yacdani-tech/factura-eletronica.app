import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Cliente de Supabase con la llave `service_role` — bypassea RLS por
 * completo. Regla dura #1 del proyecto (`CLAUDE.md`): **este cliente vive
 * SOLO en `apps/api` — jamás en `apps/web`**, aunque el módulo en sí resida
 * en este paquete compartido (`packages/db`) porque `apps/api` lo consume
 * como dependencia de workspace igual que cualquier otro helper de `@factura/db`.
 *
 * `import "server-only"` (paquete oficial de Next.js): hace fallar el BUILD
 * si este módulo se importa alguna vez desde un Client Component, en vez de
 * depender únicamente de la disciplina de no hacerlo.
 *
 * CALL SITES PERMITIDOS — la lista autoritativa (con la justificación puntual
 * de cada uno) vive en `docs/arquitectura/contratos-transversales.md` §b;
 * leer ahí antes de agregar uno nuevo y sumarlo a esa tabla en el mismo
 * commit que lo introduce. Hoy (2026-08-26) el único call site real es:
 *
 * (1) `apps/api/app/api/cron/generar-suscripciones/route.ts` — Cron de
 * Vercel protegido por `CRON_SECRET` (sin cookie de sesión) que invoca la RPC
 * de sistema `public.asegurar_facturas_suscripcion_sistema()` (otorgada
 * exclusivamente a `service_role`) para generar, para TODOS los tenants, las
 * facturas de suscripción de plataforma pendientes (regla dura #9).
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "createAdminClient: faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el entorno del servidor.",
    );
  }

  return createSupabaseClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
