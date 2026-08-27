import { NextResponse, type NextRequest } from "next/server";

import { createAdminClient } from "@factura/db/supabase/admin";

/**
 * Ruta de Vercel Cron protegida por `CRON_SECRET` — dispara la generación
 * DIARIA de facturas de suscripción de la plataforma. Un Cron de Vercel
 * (`apps/api/vercel.json`) pega acá una vez al día e invoca, con el cliente
 * **service-role**, la RPC de sistema `public.asegurar_facturas_suscripcion_sistema()`
 * (SIN guard de auth, otorgada SOLO a `service_role`, migración `20260815094000`).
 *
 * Vive en `apps/api` (no en `apps/web`): esta es la ÚNICA superficie autorizada
 * a usar `service_role`.
 *
 * AUTENTICACIÓN: header `Authorization: Bearer ${CRON_SECRET}` — comparación
 * directa (valor fijo de infraestructura, rotable en Vercel; no protege una
 * cuenta de usuario). Si `CRON_SECRET` no está configurado, `autorizado()`
 * devuelve `false` incondicionalmente (fail-closed: NUNCA corre sin secreto).
 *
 * SIN sesión de usuario, SIN tenant (regla dura #1 no aplica: no opera sobre
 * datos de UN tenant, genera para TODOS).
 *
 * `force-dynamic`: nunca cachear (cada corrida debe generar en vivo).
 */
export const dynamic = "force-dynamic";

function autorizado(request: NextRequest): boolean {
  const secreto = process.env.CRON_SECRET;
  if (!secreto) return false;

  const encabezado = request.headers.get("authorization") ?? "";
  return encabezado === `Bearer ${secreto}`;
}

async function manejar(request: NextRequest): Promise<NextResponse> {
  if (!autorizado(request)) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("asegurar_facturas_suscripcion_sistema");

  if (error) {
    console.error("[api/cron/generar-suscripciones] la RPC de generación falló:", error.message);
    return NextResponse.json({ error: "No se pudo generar las facturas de suscripción." }, { status: 500 });
  }

  const creadas = typeof data === "number" ? data : 0;
  console.info("[api/cron/generar-suscripciones] facturas nuevas generadas:", creadas);
  return NextResponse.json({ ok: true, creadas }, { status: 200 });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  return manejar(request);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return manejar(request);
}
