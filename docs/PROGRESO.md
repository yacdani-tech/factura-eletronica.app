# PROGRESO

Estado actual del desarrollo. Lo mantiene el agente `project-manager`: se actualiza al terminar cada tarea (qué quedó hecho, qué falta, notas de la tarea y aprendizajes acotados a la feature — ver la tabla de auto-blindaje en `CLAUDE.md`).

Separación de responsabilidades (ver `docs/00-estandar-de-requisitos.md`):
- **Qué debe hacer el sistema** → `docs/Requerimientos_<app>.md`.
- **Qué está construido y qué falta** → este archivo.
- **Qué cambió, cuándo y por qué** → `docs/CHANGELOG-requisitos.md` + Git.
- **Cuánto cuesta y en qué orden** → `docs/PLAN_MVP.md`.

---

## Estado

### [2026-08-26] Migración a turborepo — CERRADA (Fases 1-6 + cabos sueltos)

**Hecho.** Monorepo turborepo con `apps/web`, `apps/api`, `apps/landing` y `packages/db`, `packages/ui`, `packages/core`, `packages/hacienda-adapter`.

- **Fase 2** (commit `5a38309`) — extracción de `@factura/db` (`packages/db`): clientes Supabase, resolución de tenant, guards de auth.
- **Fase 3** (commit `79e22ab`) — extracción de `@factura/ui` (`packages/ui`) y `@factura/core` (`packages/core`): primitivos UI y lógica pura compartida.
- **Fase 4** (commit `753614e`) — `packages/hacienda-adapter`: contratos tipados, **STUB explícito** (cada función lanza "no implementado"; `apps/api/app/api/facturas/route.ts` devuelve 501). La implementación real de Hacienda (XML v4.4, firma XAdES-EPES, OAuth IDP) es una **feature aparte**, fuera de esta tarea — queda pendiente en el backlog (ver `docs/PLAN_MVP.md`).
- **Fase 5** (commit `f4ddd83`) — `apps/api` como tercer surface (route-handlers), con `vercel.json` propio (cron de generación de suscripciones).
- **Fase 6** (commit `705d0ea`) — modelo de tenant **por sesión** (no por subdominio): `service_role` removido de `apps/web`, vive solo en `apps/api`.

**Cabos sueltos cerrados hoy (arquitecto-app):**
- `docs/arquitectura/contratos-transversales.md` reescrito: §b (política `service_role`, apunta a `packages/db/src/supabase/admin.ts` con inventario autoritativo de call sites reales), §d (ruta del lector de archivos actualizada a `packages/core/src/importacion/lector-archivo.ts`), §h (reescrita para describir tenant-por-sesión real, con nota de deuda heredada sobre el pipeline de subdominio sin consumidor), §i nueva (topología de deploy Vercel: 3 Vercel Projects independientes por root directory, solo `apps/api` tiene `vercel.json` por los crons).
- Header de `packages/db/src/supabase/admin.ts` limpiado (tenía texto copiado del template base "casilleros" con referencias a un dominio inexistente en esta app).
- CI (`.github/workflows/ci.yml`) migrado de npm a pnpm; job de test unificado a `turbo run typecheck` + `turbo run test` desde la raíz (cubre ahora `apps/api` y todos los `packages/*`, antes solo cubría web/landing). Se agregó script `typecheck` a 6 `package.json` que no lo tenían, más `devDependencies` de TypeScript faltantes. Se agregó `--passWithNoTests` a vitest de web/landing (repo día-1 sin tests aún) — **revertir en cuanto haya tests reales**, es deuda de CI, no dejarlo pasar desapercibido.
- Topología Vercel confirmada sin cambios de código (documentada en §i de contratos-transversales.md).

**No resuelto — pasa a backlog** (ver `docs/PLAN_MVP.md` § Backlog / próximos pasos): el pipeline de resolución de tenant por subdominio (`resolverSubdominio`, `TENANT_SUBDOMAIN_HEADER`, `gate-subdominio.ts`, `tenant-publico.ts`, `construirUrlPublicaTenant`) y el bypass de cron en `apps/web/middleware.ts` quedaron sin ningún consumidor real tras la Fase 6, pero siguen exportados por `@factura/db`/`@factura/core` — riesgo de reimportación accidental que reintroduzca el patrón viejo.

**Próxima tarea:** con la base de turborepo cerrada, el plan de construcción del MVP sigue el orden de `docs/PLAN_MVP.md` (pendiente de definir a partir de `docs/Requerimientos.md` / `docs/Requerimientos_<app>.md`, que aún no existe en este repo con el spec de negocio concreto de factura-electronica.app). **Bloqueo:** no hay spec de requerimientos de negocio todavía — antes de proponer la siguiente tarea de feature, hace falta que el dueño del producto defina el alcance concreto (facturación electrónica: qué documentos, qué integraciones fiscales, qué roles) siguiendo `docs/00-estandar-de-requisitos.md`.
