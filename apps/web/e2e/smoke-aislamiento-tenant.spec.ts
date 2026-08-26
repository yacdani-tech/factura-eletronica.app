import { test, expect } from "./fixtures";

import { clienteAdminE2E, clienteConSesionE2E } from "./helpers";
import { crearTenantEfimero, eliminarTenantEfimero } from "./infra/tenant-efimero";

/**
 * SMOKE — aislamiento multi-tenant por RLS (regla dura #1).
 *
 * Modelado sobre el spec `auth-bloqueo-rls-lectura-escritura.spec.ts` del
 * repo fuente, pero contra una tabla BASE del framework
 * (`plantillas_notificacion`, multi-tenant genérica) en vez de una tabla de
 * negocio. Verifica el invariante central de la plataforma: un usuario de un
 * tenant NO puede leer las filas de OTRO tenant — la RLS las filtra por
 * `private.current_tenant_id()`, devolviendo 0 filas ajenas (nunca un
 * `permission denied` crudo, que sería otra clase de fallo — falta de GRANT).
 *
 * Montaje: el tenant A es el worker-scoped (`tenantEfimero`); el tenant B se
 * crea DENTRO del test (con su propio admin) y se destruye en el `finally`.
 * Ambos reciben una fila sembrada en `plantillas_notificacion` vía service_role
 * (infra de test, bypassa RLS). Después se abre una SESIÓN REAL (rol
 * `authenticated`, RLS real) con las credenciales del admin de A y se afirma:
 *   - A ve su propia fila,
 *   - A NO ve la fila de B (ni por lectura amplia ni filtrando por el id de B).
 * Cualquier fila de B visible desde la sesión de A es una fuga entre tenants (S0).
 */
test.describe("Smoke — aislamiento multi-tenant por RLS", () => {
  test("un usuario del tenant A no puede leer las filas del tenant B", async ({ tenantEfimero }) => {
    test.setTimeout(60_000);
    const admin = clienteAdminE2E();
    const marca = `iso-${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const tenantB = await crearTenantEfimero(marca);

    try {
      const claveA = `smoke-iso-a-${marca}`;
      const claveB = `smoke-iso-b-${marca}`;

      // Siembra una plantilla en cada tenant (service_role, bypassa RLS).
      const insA = await admin.from("plantillas_notificacion").insert({
        tenant_id: tenantEfimero.tenantId,
        clave: claveA,
        asunto: "Plantilla del tenant A",
        cuerpo: "Cuerpo A",
      });
      expect(insA.error).toBeNull();

      const insB = await admin.from("plantillas_notificacion").insert({
        tenant_id: tenantB.tenantId,
        clave: claveB,
        asunto: "Plantilla del tenant B",
        cuerpo: "Cuerpo B",
      });
      expect(insB.error).toBeNull();

      // Sesión REAL del admin del tenant A (rol authenticated, RLS real).
      const sesionA = await clienteConSesionE2E(tenantEfimero.email, tenantEfimero.password);

      // (1) A ve SU propia fila.
      const propias = await sesionA
        .from("plantillas_notificacion")
        .select("tenant_id, clave")
        .eq("clave", claveA);
      expect(propias.error).toBeNull();
      expect(propias.data ?? []).toHaveLength(1);
      expect(propias.data?.[0]?.tenant_id).toBe(tenantEfimero.tenantId);

      // (2) A NO ve la fila de B ni filtrando explícitamente por su clave...
      const ajenasPorClave = await sesionA
        .from("plantillas_notificacion")
        .select("tenant_id, clave")
        .eq("clave", claveB);
      expect(ajenasPorClave.error).toBeNull();
      expect(ajenasPorClave.data ?? []).toEqual([]);

      // ...ni filtrando explícitamente por el tenant_id de B (RLS lo corta).
      const ajenasPorTenant = await sesionA
        .from("plantillas_notificacion")
        .select("tenant_id, clave")
        .eq("tenant_id", tenantB.tenantId);
      expect(ajenasPorTenant.error).toBeNull();
      expect(ajenasPorTenant.data ?? []).toEqual([]);

      // (3) Ninguna fila visible para A pertenece a B (barrido completo).
      const todas = await sesionA.from("plantillas_notificacion").select("tenant_id");
      expect(todas.error).toBeNull();
      for (const fila of todas.data ?? []) {
        expect(fila.tenant_id).not.toBe(tenantB.tenantId);
      }

      await sesionA.auth.signOut();
    } finally {
      await eliminarTenantEfimero(tenantB.tenantId).catch((e) => {
        console.error("[smoke aislamiento] no se pudo borrar el tenant B efímero:", e);
      });
    }
  });
});
