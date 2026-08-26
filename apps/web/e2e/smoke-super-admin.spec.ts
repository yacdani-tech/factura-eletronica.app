import type { SupabaseClient } from "@supabase/supabase-js";

import { test, expect } from "./fixtures";

import { textosAuth } from "@/lib/textos/auth";
import { clienteAdminE2E, iniciarSesionTenant } from "./helpers";

/**
 * SMOKE — consola de plataforma (`/soporte`) y su gate por rol.
 *
 * Dos caras del mismo control de acceso:
 *   (1) Un SUPER-ADMIN de plataforma aterriza en la consola `/soporte` (su
 *       destino post-login natural, `calcularDestinoPostLogin`) y la ve.
 *   (2) Un ADMIN normal de un tenant que intenta entrar a `/soporte` es
 *       REDIRIGIDO fuera (a `/dashboard`) — la página re-exige el rol
 *       (`exigirSuperAdmin`) además del layout (defensa en profundidad).
 *
 * El super-admin efímero se crea vía service_role (infra de test): usuario Auth
 * confirmado + fila en `super_admins`. Se destruye al final borrando su
 * `auth.users` (la fila de `super_admins` cae por ON DELETE CASCADE). No usa un
 * tenant: un super-admin sin selección de tenant vive en "modo plataforma".
 */

interface SuperAdminEfimero {
  id: string;
  email: string;
  password: string;
}

async function crearSuperAdminEfimero(admin: SupabaseClient, marca: string): Promise<SuperAdminEfimero> {
  const email = `e2e-superadmin-${marca}@plataforma-e2e.test`;
  const password = `SuperAdmin-QA-${marca}!`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { origen: "e2e-smoke-super-admin" },
  });
  if (error || !data?.user) throw new Error(`crearSuperAdminEfimero: ${error?.message}`);
  const id = data.user.id;
  const { error: errorSA } = await admin.from("super_admins").insert({ usuario_id: id });
  if (errorSA) throw new Error(`crearSuperAdminEfimero: super_admins: ${errorSA.message}`);
  return { id, email, password };
}

test.describe("Smoke — consola de plataforma y gate por rol", () => {
  test("un super-admin llega a la consola /soporte", async ({ page }) => {
    test.setTimeout(60_000);
    const admin = clienteAdminE2E();
    const marca = `smoke-sa-${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const superAdmin = await crearSuperAdminEfimero(admin, marca);

    try {
      // Login manual (NO `iniciarSesionTenant`: ese espera `/dashboard`, y un
      // super-admin aterriza en `/soporte`).
      await page.goto("/login");
      await page.getByLabel(textosAuth.login.emailLabel).fill(superAdmin.email);
      await page.getByLabel(textosAuth.login.passwordLabel).fill(superAdmin.password);
      await page.getByRole("button", { name: textosAuth.login.botonSubmit }).click();

      await page.waitForURL("**/soporte");
      await expect(page).toHaveURL(/\/soporte/);
      // La consola renderiza su encabezado ("Cuentas") — confirma que la
      // página cargó de verdad, no solo la URL.
      await expect(page.getByRole("heading", { name: "Cuentas" })).toBeVisible();
    } finally {
      await admin.auth.admin.deleteUser(superAdmin.id).catch((e) => {
        console.error("[smoke super-admin] no se pudo borrar el super-admin efímero:", e);
      });
    }
  });

  test("un admin normal es redirigido fuera de /soporte hacia /dashboard", async ({ page }) => {
    // Sesión del admin efímero del worker (rol de tenant, NO super-admin).
    await iniciarSesionTenant(page);

    await page.goto("/soporte");
    // El gate (layout modo plataforma + `exigirSuperAdmin` en la página) lo
    // saca de la consola: termina en el dashboard, nunca viendo `/soporte`.
    await page.waitForURL("**/dashboard");
    await expect(page).toHaveURL(/\/dashboard/);
  });
});
