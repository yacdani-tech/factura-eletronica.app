# PLAN_MVP

Plan de tareas secuencial con estimados. Deriva de `docs/Requerimientos_<app>.md` (el alcance) y ordena la construcción por dependencias y riesgo.

Separación de responsabilidades (ver `docs/00-estandar-de-requisitos.md`): este archivo lleva el ORDEN y el COSTO; el ESTADO vive en `docs/PROGRESO.md` y el ALCANCE en el documento de requisitos.

---

## Plan

Plan de tareas — pendiente de definir a partir de `docs/Requerimientos_<app>.md` (el spec de negocio de factura-eletronica.app todavía no existe en `docs/`; es el bloqueo actual para proponer la siguiente tarea de feature — ver `docs/PROGRESO.md`).

La base técnica del monorepo (migración a turborepo, fases 1-6) está CERRADA — ver `docs/PROGRESO.md`. Lo que sigue de acá es construcción de negocio sobre esa base.

---

## Backlog / próximos pasos (sin priorizar aún — decide el dueño del producto)

- **Deuda heredada: pipeline de resolución de tenant por subdominio sin consumidor.** Tras la Fase 6 (tenant por sesión, commit `705d0ea`), `resolverSubdominio`, `TENANT_SUBDOMAIN_HEADER`, `gate-subdominio.ts`, `tenant-publico.ts` y `construirUrlPublicaTenant` quedaron sin ningún caller real, pero siguen exportados por `@factura/db`/`@factura/core`. No rompe nada hoy, pero es riesgo de reimportación accidental que reintroduzca el patrón por subdominio (ya descartado — el producto usa un solo dashboard `web.factura-eletronica.app`, tenant resuelto por sesión). Documentado como "deuda heredada" en `docs/arquitectura/contratos-transversales.md` §h. Opciones a decidir: (a) eliminar el código muerto, (b) dejarlo con un comentario `@deprecated` explícito, (c) no tocar hasta que estorbe. Candidato natural: tarea chica de `arquitecto-app` + `revisor`, impacto LOCAL.
- **Implementación real del adaptador de Hacienda** (`packages/hacienda-adapter`, hoy STUB de la Fase 4): XML v4.4, firma XAdES-EPES, OAuth IDP. Bloquea que `apps/api/app/api/facturas/route.ts` deje de devolver 501. Es la feature central del producto — depende de que el spec de requerimientos defina el alcance exacto de la integración fiscal.
- **CI con `--passWithNoTests`** en vitest de `apps/web`/`apps/landing` (agregado hoy porque el repo todavía no tiene tests ahí): revertir en cuanto existan tests reales en esas apps, para que la ausencia de tests vuelva a fallar el CI.
