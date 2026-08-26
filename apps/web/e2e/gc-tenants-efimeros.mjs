#!/usr/bin/env node
// GC de RED DE SEGURIDAD de la infra E2E (aislamiento por-worker): borra
// tenants EFÍMEROS (subdominio prefijo `e2e-ef-`) más viejos que N horas, por
// si una corrida de CI crasheó antes de su teardown normal. El teardown
// por-worker (e2e/fixtures.ts -> eliminarTenantEfimero) ya deja 0 residuales en
// el camino feliz; esto es solo para el caso de un job abortado a la mitad.
// Pensado para correr al INICIO de la corrida de CI (antes de la matriz de
// shards).
//
// Es un `.mjs` plano (raw supabase-js), fuera del grafo de tipos de la app —
// mismo criterio que `seed-tenant-e2e.mjs` — para poder correrlo con `node` sin
// el runner de TS. Duplica a propósito la lógica de
// `limpiarTenantsEfimerosViejos` (infra/tenant-efimero.ts), que es TS y no se
// puede invocar directo desde acá.
//
// SEGURIDAD: solo toca tenants con el prefijo `e2e-ef-` y solo los MÁS VIEJOS
// que `E2E_GC_HORAS` (default 6h), así que jamás pisa un tenant en uso de una
// corrida en curso ni un tenant real. Borra el tenant vía la RPC
// `eliminar_tenant_efimero` (misma que el teardown) y sus auth.users aparte.
//
// Uso: node e2e/gc-tenants-efimeros.mjs   (o `npm run test:e2e:gc`)
// Env requeridas (con fallback a apps/web/.env.local, igual que el seed):
//   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PREFIJO = "e2e-ef";
const HORAS = Number(process.env.E2E_GC_HORAS ?? "6");

function cargarEnvLocalComoFallback() {
  const envLocalPath = path.resolve(__dirname, "..", ".env.local");
  if (!existsSync(envLocalPath)) return;
  for (const lineaCruda of readFileSync(envLocalPath, "utf8").split(/\r?\n/)) {
    const linea = lineaCruda.trim();
    if (!linea || linea.startsWith("#")) continue;
    const idx = linea.indexOf("=");
    if (idx === -1) continue;
    const clave = linea.slice(0, idx).trim();
    let valor = linea.slice(idx + 1).trim();
    if ((valor.startsWith('"') && valor.endsWith('"')) || (valor.startsWith("'") && valor.endsWith("'"))) {
      valor = valor.slice(1, -1);
    }
    if (process.env[clave] === undefined) process.env[clave] = valor;
  }
}

async function main() {
  cargarEnvLocalComoFallback();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    console.log("[gc-e2e] Faltan NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY — se salta el GC (no es fatal).");
    return;
  }

  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const { data: candidatos, error } = await admin
    .from("tenants")
    .select("id, subdominio, creado_en")
    .like("subdominio", `${PREFIJO}-%`);
  if (error) {
    console.log(`[gc-e2e] No se pudo listar tenants efímeros (no fatal): ${error.message}`);
    return;
  }

  const limite = Date.now() - HORAS * 60 * 60 * 1000;
  const viejos = (candidatos ?? []).filter((t) => {
    const creado = typeof t.creado_en === "string" ? Date.parse(t.creado_en) : NaN;
    return Number.isFinite(creado) && creado < limite;
  });

  if (viejos.length === 0) {
    console.log(`[gc-e2e] Sin tenants efímeros más viejos que ${HORAS}h — nada que limpiar.`);
    return;
  }

  let borrados = 0;
  for (const t of viejos) {
    const { data: miembros } = await admin.from("usuarios_tenants").select("usuario_id").eq("tenant_id", t.id);
    const usuarioIds = (miembros ?? []).map((m) => m.usuario_id);

    const { error: errorRpc } = await admin.rpc("eliminar_tenant_efimero", { p_tenant_id: t.id });
    if (errorRpc) {
      console.log(`[gc-e2e] RPC falló para ${t.subdominio} (no fatal): ${errorRpc.message}`);
      continue;
    }
    for (const usuarioId of usuarioIds) {
      await admin.auth.admin.deleteUser(usuarioId).catch(() => {});
    }
    borrados += 1;
  }
  console.log(`[gc-e2e] Limpiados ${borrados}/${viejos.length} tenant(s) efímero(s) más viejos que ${HORAS}h.`);
}

main().catch((e) => {
  // NUNCA fatal: el GC es best-effort, no debe tumbar la corrida de CI.
  console.log("[gc-e2e] Error inesperado (no fatal):", e?.message ?? e);
});
