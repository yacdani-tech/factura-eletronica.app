# Casos de prueba — <Módulo>

> Catálogo de casos del módulo `<módulo>`. Prefijo de IDs: `<PREFIJO>` (ver tabla en `docs/qa/PLAN-QA.md` §4). Los IDs son ESTABLES: nunca se renumeran ni se reusan; un caso obsoleto se marca `RETIRADO` con motivo. Lo mantiene `qa-analista`; los resultados de ejecución los actualizan `qa-explorador`/`qa-automatizador` al correr cada caso.

**Convenciones del bloque de caso:**
- **Prioridad**: P0 (regla dura / flujo de negocio principal — corre en toda campaña del módulo) · P1 (funcionalidad principal) · P2 (secundario/borde).
- **Tipo**: funcional · permisos · datos-límite · responsive · a11y · concurrencia · persistencia-form · multi-tenant.
- **Automatización**: `manual` · `unit:<ruta>` · `e2e:<ruta>` · `parcial:<ruta>` (el spec cubre parte del caso — anotar qué falta).
- **Última ejecución**: `AAAA-MM-DD · <resultado de la taxonomía PLAN-QA §12> · <campaña>`. Un "PASÓ" NO es cobertura vigente si el código que el caso ejerce cambió DESPUÉS de esa fecha — `qa-project-manager` lo marca `STALE` al cruzarlo contra `docs/PROGRESO.md` (PLAN-QA §13).

---

### <PREFIJO>-001 — <Título corto en infinitivo>
- **Prioridad**: P0 · **Tipo**: funcional · **Regla dura**: una regla dura del proyecto (ver `CLAUDE.md`) (o `—`)
- **Requisito**: <sección del spec de requisitos en `docs/`, o decisión del dueño del producto con fecha>
- **Precondiciones**: <tenant/datos/rol necesarios — incluir CÓMO sembrarlos>
- **Pasos**:
  1. <paso>
  2. <paso>
- **Esperado**: <resultado observable, incluyendo lo que NO debe pasar>
- **Automatización**: manual
- **Última ejecución**: — · — · —
