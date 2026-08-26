import { test, expect } from "./fixtures";

import { iniciarSesionTenant } from "./helpers";

/**
 * SMOKE — login del admin efímero.
 *
 * El camino más básico del harness: la fixture `auto` worker-scoped
 * (`fixtures.ts`) ya creó un tenant efímero + su usuario admin y publicó sus
 * credenciales en el holder `tenant-actual.ts`. `iniciarSesionTenant(page)` a
 * secas usa ESAS credenciales (flujo real de correo/contraseña, sin bypass) y
 * espera aterrizar en `/dashboard`. Si este spec pasa, toda la cadena
 * crear-tenant → crear-usuario-auth → membresía → login real → resolución de
 * tenant por sesión está sana.
 */
test.describe("Smoke — login del admin efímero", () => {
  test("el admin del tenant efímero puede iniciar sesión y llega al dashboard", async ({ page }) => {
    await iniciarSesionTenant(page);
    await expect(page).toHaveURL(/\/dashboard/);
  });
});
