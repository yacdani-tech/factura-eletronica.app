import { test as base, expect } from "@playwright/test";

import { crearTenantEfimero, eliminarTenantEfimero, type TenantEfimero } from "./infra/tenant-efimero";
import { setTenantActual } from "./infra/tenant-actual";

/**
 * Fixtures E2E con AISLAMIENTO POR-WORKER. En vez de que TODOS los specs
 * compartan un tenant mutable (fuente de flakiness sistémica: pisado de
 * singletons de config, aserciones dependientes del tamaño global del tenant,
 * miembros temporales cruzados), cada WORKER de Playwright obtiene su PROPIO
 * tenant efímero, creado una vez al arrancar el worker y borrado al terminar.
 * Con el aislamiento garantizado se puede usar `workers>1` sin colisiones.
 *
 * La fixture `tenantEfimero` es WORKER-SCOPED y `auto` (corre para TODOS los
 * tests, sin que haga falta pedirla): así `iniciarSesionTenant(page)` — sin
 * argumentos — usa automáticamente el tenant del worker (vía el holder
 * `tenant-actual.ts`). Los specs que necesiten el `tenantId` (verificación en
 * BD con `clienteAdminE2E`) igual pueden destructurar `tenantEfimero`
 * explícitamente.
 */
interface WorkerFixtures {
  tenantEfimero: TenantEfimero;
}

export const test = base.extend<object, WorkerFixtures>({
  tenantEfimero: [
    async ({}, use, workerInfo) => {
      // Marca ÚNICA global: `E2E_RUN_ID` (en CI, run_id + shard) evita
      // colisiones entre jobs de la matriz que corren en paralelo; el índice de
      // worker desambigua dentro de un run; el sufijo temporal cubre el caso de
      // un worker que se reinicia tras un crash (mismo índice, tenant nuevo).
      const runId = process.env.E2E_RUN_ID ?? "local";
      const marca = `${runId}-w${workerInfo.workerIndex}-${Date.now().toString(36)}`;
      const tenant = await crearTenantEfimero(marca);
      setTenantActual({
        email: tenant.email,
        password: tenant.password,
        tenantId: tenant.tenantId,
        subdominio: tenant.subdominio,
        nombre: tenant.nombre,
      });
      await use(tenant);
      setTenantActual(null);
      await eliminarTenantEfimero(tenant.tenantId);
    },
    { scope: "worker", auto: true },
  ],
});

export { expect };
