# Reporte de campaña — <nombre> (AAAA-MM-DD)

## Resumen ejecutivo
<3 líneas máximo: veredicto general, cuántos S0/S1 aparecieron, Quality Gate. Números, no adjetivos.>

## Alcance (brief recibido de qa-project-manager — PLAN-QA §14)
- **Tipo de campaña**: regresión de módulo | flujo de negocio principal | smoke pre-release | dirigida | matriz de permisos
- **Módulos**: <lista>
- **Commit base**: `<sha corto>` de `dev`
- **Motivo**: <por qué esta campaña, ahora>
- **Hipótesis de riesgo**: R1 ... R2 ... (lo que esta campaña se propuso atacar)

## Entry / Exit criteria
- **Entry**: <ambiente operativo / fixtures / migraciones aplicadas / bugs conocidos revisados — cuál se cumplió, cuál no>
- **Exit**: <100% P0 ejecutados? 0 S0 abiertos? todo FAIL_* triageado? ningún BLOCKED_* sin motivo? — cuál se cumplió, cuál no>
- **Casos planeados vs. ejecutados**: P0 X/Y · P1 X/Y · P2 X/Y, por resultado de la taxonomía (PLAN-QA §12): PASS N · FAIL_PRODUCT N · FAIL_TEST N · BLOCKED_SPEC N · BLOCKED_DATA N · FLAKY N · NOT_RUN N (desviaciones explicadas abajo)

## Resultados de suites
| Suite | Resultado | Duración |
|---|---|---|
| tsc --noEmit | 0 errores / N errores | — |
| Vitest (web) | N pasan / N fallan | Xm |
| Playwright E2E | N pasan / N fallan / N saltados / N flaky | Xm |

## Bugs de la campaña
| ID | Tipo | Sev | Título | Impacto observado | Estado |
|---|---|---|---|---|---|
| [BUG-…](../bugs/BUG-….md) | Bug | S0 | … | fuga cross-tenant | escalado al dueño del producto |

## Hallazgos que NO son bugs
<deuda de specs (flaky, legacy), observaciones de UX para decisión de producto, mejoras sugeridas (Tipo=Mejora) — separados de los bugs a propósito>

## Gaps de cobertura detectados
<casos existentes reutilizados: N · casos nuevos creados: N · reglas duras/requisitos del alcance SIN ningún caso que las cubra: <lista o "ninguna">>

## No cubierto + riesgos
<qué quedó fuera y por qué; qué riesgo implica>

## Estado del catálogo
<casos nuevos creados, casos actualizados, cobertura de automatización antes → después>

## Quality Gate recomendado (PLAN-QA §13)
**RED | YELLOW | GREEN** — <motivo en una línea: qué gate obligatorio faltó, o que todos pasaron>

## Recomendación
<siguiente campaña sugerida, o qué pasar al carril de desarrollo primero — con prioridad propuesta. Este bloque + el Quality Gate son lo que qa-project-manager usa para actualizar docs/qa/ESTADO-QA.md>
