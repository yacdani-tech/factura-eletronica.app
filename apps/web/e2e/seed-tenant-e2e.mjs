#!/usr/bin/env node
// Seed IDEMPOTENTE del tenant + usuario Admin FIJOS de la infra E2E mínima.
//
// Corre contra el MISMO proyecto Supabase REMOTO de desarrollo que usa el resto
// del proyecto (sin Docker, sin proyecto nuevo). Usa el cliente `service_role`
// (SOLO acá, en un script de servidor/CI, nunca en código de cliente — regla
// dura del proyecto) para crear el usuario de Auth ya confirmado y saltarse RLS
// al armar la membresía.
//
// Con el aislamiento por-worker (tenants efímeros) casi ningún spec necesita
// este tenant fijo — queda como fallback para specs no migrados. Este seed crea
// SOLO el núcleo de plataforma (tenant + usuario admin + membresía); ningún
// baseline de dominio.
//
// Uso:
//   npm run test:e2e:seed --workspace=factura-eletronica-web
// (o `node e2e/seed-tenant-e2e.mjs` desde apps/web)
//
// Variables de entorno requeridas:
//   NEXT_PUBLIC_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   E2E_TEST_TENANT_EMAIL
//   E2E_TEST_TENANT_PASSWORD
// Si faltan y existe apps/web/.env.local, se leen de ahí como fallback (dev
// local) — NUNCA se commitea ese archivo (ya está en .gitignore).
//
// Idempotencia: correr este script una segunda vez (con las mismas env vars) no
// duplica nada — detecta el usuario/tenant/membresía ya existentes y los deja
// tal cual (o corrige rol/estado si por lo que sea quedaron mal). Es SEGURO
// volver a correrlo en cada corrida de CI.

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const NOMBRE_TENANT_E2E = "Tenant E2E (QA)";
const SUBDOMINIO_TENANT_E2E = "e2e-qa";

/** Carga apps/web/.env.local como fallback SOLO para las vars que falten en process.env (dev local). */
function cargarEnvLocalComoFallback() {
  const envLocalPath = path.resolve(__dirname, "..", ".env.local");
  if (!existsSync(envLocalPath)) return;

  const contenido = readFileSync(envLocalPath, "utf8");
  for (const lineaCruda of contenido.split(/\r?\n/)) {
    const linea = lineaCruda.trim();
    if (!linea || linea.startsWith("#")) continue;
    const idx = linea.indexOf("=");
    if (idx === -1) continue;
    const clave = linea.slice(0, idx).trim();
    let valor = linea.slice(idx + 1).trim();
    if (
      (valor.startsWith('"') && valor.endsWith('"')) ||
      (valor.startsWith("'") && valor.endsWith("'"))
    ) {
      valor = valor.slice(1, -1);
    }
    if (process.env[clave] === undefined) process.env[clave] = valor;
  }
}

function requerirEnv(nombre) {
  const valor = process.env[nombre];
  if (!valor) {
    console.error(`[seed-e2e] Falta la variable de entorno ${nombre}.`);
    return null;
  }
  return valor;
}

async function main() {
  cargarEnvLocalComoFallback();

  const url = requerirEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = requerirEnv("SUPABASE_SERVICE_ROLE_KEY");
  const email = requerirEnv("E2E_TEST_TENANT_EMAIL");
  const password = requerirEnv("E2E_TEST_TENANT_PASSWORD");

  if (!url || !serviceRoleKey || !email || !password) {
    console.error(
      "[seed-e2e] Faltan variables requeridas — no se puede sembrar. Ver el comentario de cabecera de este script.",
    );
    process.exitCode = 1;
    return;
  }

  const admin = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const emailNormalizado = email.trim().toLowerCase();

  // 1) Usuario (auth.users + trigger trg_auth_users_crear_usuario -> public.usuarios).
  let usuarioId = null;
  const { data: usuarioExistente, error: errorUsuarioExistente } = await admin
    .from("usuarios")
    .select("id")
    .eq("email", emailNormalizado)
    .maybeSingle();

  if (errorUsuarioExistente) {
    console.error("[seed-e2e] Error leyendo public.usuarios:", errorUsuarioExistente.message);
    process.exitCode = 1;
    return;
  }

  if (usuarioExistente) {
    usuarioId = usuarioExistente.id;
    console.log(`[seed-e2e] Usuario ya existe (${emailNormalizado}) — id ${usuarioId}.`);
  } else {
    const { data: creado, error: errorCrear } = await admin.auth.admin.createUser({
      email: emailNormalizado,
      password,
      email_confirm: true,
      user_metadata: { origen: "seed-e2e-tenant" },
    });

    if (errorCrear || !creado?.user) {
      console.error("[seed-e2e] Error creando el usuario de Auth:", errorCrear?.message);
      process.exitCode = 1;
      return;
    }

    usuarioId = creado.user.id;
    console.log(`[seed-e2e] Usuario creado (${emailNormalizado}) — id ${usuarioId}.`);
  }

  // 2) Membresía existente del usuario (regla dura: un usuario = un tenant). Si
  // ya tiene membresía, ESE es el tenant de prueba — no se crea ni se reasigna
  // otro (evitaría duplicar filas o violar la regla).
  const { data: membresiaExistente, error: errorMembresia } = await admin
    .from("usuarios_tenants")
    .select("tenant_id, rol, estado")
    .eq("usuario_id", usuarioId)
    .maybeSingle();

  if (errorMembresia) {
    console.error("[seed-e2e] Error leyendo usuarios_tenants:", errorMembresia.message);
    process.exitCode = 1;
    return;
  }

  let tenantId = membresiaExistente?.tenant_id ?? null;

  if (!tenantId) {
    // 3) Tenant dedicado (por subdominio, idempotente).
    const { data: tenantExistente, error: errorTenantExistente } = await admin
      .from("tenants")
      .select("id")
      .eq("subdominio", SUBDOMINIO_TENANT_E2E)
      .maybeSingle();

    if (errorTenantExistente) {
      console.error("[seed-e2e] Error leyendo public.tenants:", errorTenantExistente.message);
      process.exitCode = 1;
      return;
    }

    if (tenantExistente) {
      tenantId = tenantExistente.id;
      console.log(`[seed-e2e] Tenant ya existe (subdominio=${SUBDOMINIO_TENANT_E2E}) — id ${tenantId}.`);
    } else {
      const { data: tenantCreado, error: errorCrearTenant } = await admin
        .from("tenants")
        .insert({ nombre: NOMBRE_TENANT_E2E, subdominio: SUBDOMINIO_TENANT_E2E })
        .select("id")
        .single();

      if (errorCrearTenant || !tenantCreado) {
        console.error("[seed-e2e] Error creando el tenant:", errorCrearTenant?.message);
        process.exitCode = 1;
        return;
      }

      tenantId = tenantCreado.id;
      console.log(`[seed-e2e] Tenant creado (subdominio=${SUBDOMINIO_TENANT_E2E}) — id ${tenantId}.`);
    }
  } else {
    console.log(`[seed-e2e] El usuario ya tiene membresía — se reutiliza su tenant (${tenantId}).`);
  }

  // 4) Membresía Admin activa (crea o corrige — este usuario es un fixture
  // dedicado a E2E, es seguro forzar su rol/estado si por lo que sea quedaron
  // distintos de admin/activo entre corridas).
  if (!membresiaExistente) {
    const { error: errorInsertarMembresia } = await admin
      .from("usuarios_tenants")
      .insert({ usuario_id: usuarioId, tenant_id: tenantId, rol: "admin", estado: "activo" });

    if (errorInsertarMembresia) {
      console.error("[seed-e2e] Error creando la membresía:", errorInsertarMembresia.message);
      process.exitCode = 1;
      return;
    }
    console.log("[seed-e2e] Membresía Admin creada.");
  } else if (membresiaExistente.rol !== "admin" || membresiaExistente.estado !== "activo") {
    const { error: errorCorregirMembresia } = await admin
      .from("usuarios_tenants")
      .update({ rol: "admin", estado: "activo" })
      .eq("usuario_id", usuarioId);

    if (errorCorregirMembresia) {
      console.error("[seed-e2e] Error corrigiendo la membresía:", errorCorregirMembresia.message);
      process.exitCode = 1;
      return;
    }
    console.log("[seed-e2e] Membresía corregida a Admin/activo.");
  } else {
    console.log("[seed-e2e] Membresía ya es Admin/activo — sin cambios.");
  }

  console.log(
    `[seed-e2e] Listo. tenant_id=${tenantId} usuario_id=${usuarioId} email=${emailNormalizado} (contraseña NO se imprime).`,
  );
}

main().catch((error) => {
  console.error("[seed-e2e] Error inesperado:", error);
  process.exitCode = 1;
});
