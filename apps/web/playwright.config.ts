import { defineConfig, devices } from "@playwright/test";

/**
 * Infra E2E mínima. `webServer` levanta y apaga el server SOLO: se usa
 * `next dev` (no build+start) para no pagar el costo de un build de producción
 * en specs de humo, y `reuseExistingServer` fuera de CI reutiliza un
 * `npm run dev` que ya esté corriendo en la sesión en vez de pelear por el
 * puerto 3000.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  // Timeout POR TEST. 90s da headroom para specs que hacen varios round-trips
  // reales secuenciales contra el backend bajo la carga de shards paralelos +
  // la compilación on-demand de `next dev` (que compila cada ruta la primera
  // vez que un test la visita). El timeout solo acota cuánto se PERMITE correr,
  // no lo que tardan los tests que ya pasan.
  timeout: 90_000,
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // El E2E NUNCA debe mandar correos reales (agota la cuota del proveedor y
    // genera rebotes a direcciones de prueba). Este bypass es solo dev/test;
    // producción/preview nunca setean esta var.
    env: {
      ...process.env,
      RESEND_ENVIO: "off",
    },
  },
});
