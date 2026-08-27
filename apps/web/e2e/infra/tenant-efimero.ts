import type { SupabaseClient } from "@supabase/supabase-js";

import { clienteAdminE2E } from "../helpers";

/**
 * Fábrica de TENANTS EFÍMEROS para la infra E2E (aislamiento por-worker).
 *
 * PROBLEMA que resuelve: si TODOS los specs corrieran contra un mismo tenant
 * compartido se contaminarían entre sí (pisado de singletons de config,
 * aserciones que dependen del tamaño global del tenant, miembros temporales
 * cruzados), obligando a `workers:1` en serie. La resolución de tenant en la
 * app es 100% por la membresía del usuario logueado
 * (`private.current_tenant_id()` → `usuarios_tenants` por `auth.uid()`), SIN
 * dependencia de subdominio en `localhost`. Así que cada worker de Playwright
 * puede tener su PROPIO tenant: se crea un tenant + un usuario admin NUEVO
 * (regla dura: un usuario = un tenant) + su membresía, y al loguearse con ESE
 * usuario la RLS lo aísla por completo del resto. Esto habilita el paralelismo.
 *
 * `service_role` (vía `clienteAdminE2E`, ya aprobado como infra de QA, ver
 * `helpers.ts`): crear el usuario Auth ya confirmado y saltarse RLS para armar
 * el tenant/membresía es INFRAESTRUCTURA de test, no runtime de la app — la
 * prohibición de `service_role` de los contratos transversales rige el runtime,
 * no la infra que lo verifica.
 *
 * BASELINE (framework de factura-electronica): este harness genérico crea SOLO el
 * núcleo de plataforma — un tenant, su usuario admin y la membresía. NO siembra
 * ningún baseline de DOMINIO (perfiles de cobro, rutas/zonas, tipo de cambio,
 * catálogos, etc.): eso pertenece al producto derivado, que debe extender este
 * archivo (o agregar su propio sembrador) según su esquema de negocio.
 *
 * TEARDOWN: todas las FKs a `tenants(id)` son `ON DELETE CASCADE`, pero varias
 * tablas hijas pueden tener guards BEFORE DELETE (append-only de `auditoria`,
 * soft-delete, etc.) que prohíben el borrado físico incluso para service_role.
 * Por eso el teardown NO es un `delete from tenants` directo: se delega en la
 * RPC `eliminar_tenant_efimero` (SECURITY DEFINER, `session_replication_role=
 * replica`, migración `20260804100000`), que salta esos guards y borra todo el
 * árbol — restringida por prefijo a tenants efímeros (jamás toca uno real). Los
 * `auth.users` NO viven en public y no cascadean: se borran aparte vía admin
 * API, tomando los `usuario_id` de la membresía ANTES de borrar el tenant.
 */

/** Prefijo común de subdominio/email de TODO tenant efímero — ancla del GC. */
export const PREFIJO_TENANT_EFIMERO = "e2e-ef";

/** Contraseña fija de los usuarios efímeros (descartables; nunca se loguea). */
const PASSWORD_EFIMERO = "E2e-Efimero-2026!";

/** Dominio de correo de los usuarios efímeros (no se envía correo real). */
const DOMINIO_CORREO_EFIMERO = "plataforma-e2e.test";

export interface TenantEfimero {
  tenantId: string;
  subdominio: string;
  nombre: string;
  email: string;
  password: string;
  adminUserId: string;
}

/**
 * Sanitiza una marca libre a un fragmento apto para subdominio/email:
 * minúsculas, solo `[a-z0-9-]`, sin guiones repetidos ni en los extremos,
 * acotado para respetar el CHECK de formato de `tenants.subdominio`.
 */
function sanitizarMarca(marca: string): string {
  const limpio = marca
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return limpio.slice(0, 40) || "x";
}

/** Un plan ACTIVO cualquiera (los planes son globales). `tenants.plan_id` es nullable, así que si no hay ninguno se crea el tenant sin plan. */
async function resolverPlanActivo(admin: SupabaseClient): Promise<string | null> {
  const { data, error } = await admin.from("planes").select("id").eq("activo", true).limit(1).maybeSingle();
  if (error || !data) return null;
  return data.id as string;
}

/**
 * Crea un tenant efímero (tenant + usuario admin + membresía) y devuelve las
 * credenciales para loguearse contra él. `marca` debe ser ÚNICA por
 * worker/corrida (ej. `${runId}-w${workerIndex}`): define el subdominio
 * (`e2e-ef-<marca>`, único) y el email del admin.
 */
export async function crearTenantEfimero(marca: string): Promise<TenantEfimero> {
  const admin = clienteAdminE2E();
  const sufijo = sanitizarMarca(marca);
  const subdominio = `${PREFIJO_TENANT_EFIMERO}-${sufijo}`.slice(0, 63);
  const email = `${PREFIJO_TENANT_EFIMERO}-${sufijo}@${DOMINIO_CORREO_EFIMERO}`.toLowerCase();

  // 1) Usuario Auth confirmado -> dispara el trigger que crea public.usuarios.
  const { data: creadoUser, error: errorUser } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD_EFIMERO,
    email_confirm: true,
    user_metadata: { origen: "e2e-tenant-efimero", marca },
  });
  if (errorUser || !creadoUser?.user) {
    throw new Error(`crearTenantEfimero: no se pudo crear el usuario Auth (${email}): ${errorUser?.message}`);
  }
  const adminUserId = creadoUser.user.id;

  // 2) Tenant. Solo el núcleo de plataforma (regla dura: `tenants` no tiene
  // columnas de motor de cálculo en el esquema base). `estado` viene por
  // default de columna ('activo').
  const planId = await resolverPlanActivo(admin);
  const nombre = `Tenant E2E efímero ${sufijo}`;
  const { data: tenant, error: errorTenant } = await admin
    .from("tenants")
    .insert({ nombre, subdominio, plan_id: planId })
    .select("id")
    .single();
  if (errorTenant || !tenant) {
    // Limpieza best-effort del usuario ya creado antes de propagar.
    await admin.auth.admin.deleteUser(adminUserId).catch(() => {});
    throw new Error(`crearTenantEfimero: no se pudo crear el tenant (${subdominio}): ${errorTenant?.message}`);
  }
  const tenantId = tenant.id as string;

  // 3) Membresía Admin activa.
  const { error: errorMembresia } = await admin
    .from("usuarios_tenants")
    .insert({ usuario_id: adminUserId, tenant_id: tenantId, rol: "admin", estado: "activo" });
  if (errorMembresia) {
    await eliminarTenantEfimero(tenantId).catch(() => {});
    await admin.auth.admin.deleteUser(adminUserId).catch(() => {});
    throw new Error(`crearTenantEfimero: no se pudo crear la membresía admin: ${errorMembresia.message}`);
  }

  return { tenantId, subdominio, nombre, email, password: PASSWORD_EFIMERO, adminUserId };
}

/**
 * Borra un tenant efímero y TODOS sus usuarios. NO se puede hacer con un
 * `delete from tenants` con cascada: varias tablas hijas pueden tener guards
 * BEFORE DELETE que prohíben el borrado físico incluso para service_role. Se
 * delega en la RPC `eliminar_tenant_efimero` (SECURITY DEFINER,
 * `session_replication_role=replica`, ver migración 20260804100000), que salta
 * esos guards y borra todo el árbol — restringida por prefijo a tenants
 * efímeros (jamás toca uno real). Los `auth.users` NO viven en public y no
 * cascadean: se borran aparte por admin API, tomando los `usuario_id` de la
 * membresía ANTES del borrado. Best-effort: nunca lanza (el teardown no debe
 * tumbar la corrida) — deja rastro en consola para diagnosticar.
 */
export async function eliminarTenantEfimero(tenantId: string): Promise<void> {
  const admin = clienteAdminE2E();

  const { data: miembros } = await admin.from("usuarios_tenants").select("usuario_id").eq("tenant_id", tenantId);
  const usuarioIds = (miembros ?? []).map((m) => m.usuario_id as string);

  const { error: errorRpc } = await admin.rpc("eliminar_tenant_efimero", { p_tenant_id: tenantId });
  if (errorRpc) {
    console.error(`[tenant-efimero] eliminarTenantEfimero: la RPC falló para ${tenantId}: ${errorRpc.message}`);
  }

  for (const usuarioId of usuarioIds) {
    const { error } = await admin.auth.admin.deleteUser(usuarioId);
    if (error) {
      console.error(`[tenant-efimero] eliminarTenantEfimero: no se pudo borrar el usuario ${usuarioId}: ${error.message}`);
    }
  }
}

/**
 * GC de RED DE SEGURIDAD: borra tenants efímeros (por prefijo de subdominio)
 * más viejos que `horas`, por si una corrida crasheó antes de su teardown.
 * Pensado para correr al INICIO de una corrida de CI (o en un job programado),
 * nunca borra el trabajo de una corrida en curso si `horas` es razonable
 * (ej. 6). Devuelve cuántos borró.
 */
export async function limpiarTenantsEfimerosViejos(horas = 6): Promise<number> {
  const admin = clienteAdminE2E();
  const { data: viejos, error } = await admin
    .from("tenants")
    .select("id, creado_en")
    .like("subdominio", `${PREFIJO_TENANT_EFIMERO}-%`);
  if (error || !viejos) return 0;

  const limite = Date.now() - horas * 60 * 60 * 1000;
  const aBorrar = viejos.filter((t) => {
    const creado = typeof t.creado_en === "string" ? Date.parse(t.creado_en) : NaN;
    return Number.isFinite(creado) && creado < limite;
  });

  for (const t of aBorrar) {
    await eliminarTenantEfimero(t.id as string);
  }
  return aBorrar.length;
}
