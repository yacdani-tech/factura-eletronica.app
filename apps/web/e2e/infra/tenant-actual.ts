/**
 * Holder MÓDULO-LEVEL del tenant efímero del worker actual. Playwright corre
 * cada worker en un PROCESO Node separado, así que un `let` a nivel de módulo
 * es efectivamente per-worker (cada proceso tiene su propia instancia del
 * módulo) — no hay estado compartido entre workers.
 *
 * Sirve para que `iniciarSesionTenant(page)` (sin pasar credenciales) use
 * automáticamente el tenant del worker, sin tener que enhebrar `tenantEfimero`
 * por la firma de cada test. Lo escribe la fixture worker-scoped `auto` de
 * `fixtures.ts` al arrancar el worker; lo lee `helpers.ts`. Los specs que
 * necesiten el `tenantId` (ej. para verificar en BD con `clienteAdminE2E`)
 * pueden seguir destructurando la fixture `tenantEfimero` explícitamente.
 */
export interface CredencialesWorker {
  email: string;
  password: string;
  tenantId: string;
  subdominio: string;
  nombre: string;
}

let actual: CredencialesWorker | null = null;

export function setTenantActual(tenant: CredencialesWorker | null): void {
  actual = tenant;
}

export function tenantActual(): CredencialesWorker | null {
  return actual;
}
