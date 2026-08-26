# Estado del carril de QA — Plataforma

> Lo mantiene el agente `qa-project-manager`. Espejo de `docs/PROGRESO.md` pero para el carril de QA extenuante: cadencia de campañas, cobertura por módulo y backlog conocido. Se actualiza al **cerrar** cada campaña (recibido el resultado de `qa-analista`, formato PLAN-QA §14) — nunca a mitad de una corrida.
>
> Estado inicial: el carril está SEMBRADO pero AÚN NO SE CORRIÓ NINGUNA CAMPAÑA. Las métricas de abajo arrancan en cero; se llenan con la primera campaña real.

## Deuda de QA (números, no adjetivos — PLAN-QA §1 principio 7)

| Métrica | Valor |
|---|---|
| Casos P0 catalogados | Ver `docs/qa/casos/` — el catálogo AUTH está sembrado (AUTH-001…010); el resto de los módulos aún sin catalogar |
| Casos P0 automatizados (`e2e:`/`unit:`, no `parcial:`) | 0 — todos los casos sembrados están en `manual` (fresh repo, sin specs todavía) |
| Casos con ejecución VIGENTE (no stale, ver PLAN-QA §13) | 0 — ningún caso ejecutado aún |
| Specs en cuarentena por flaky | 0 |
| Módulos de riesgo alto sin campaña reciente | TODOS — ningún módulo tiene campaña registrada aún (arranque del carril) |

## Última campaña

**Ninguna aún.** El carril está recién sembrado; la primera campaña definirá la línea base. Recomendación de arranque (PLAN-QA §3 principio 3, "riesgo primero"): la primera campaña debería atacar el flujo de negocio principal (dinero / cálculo) o, si aún no existe, la matriz multi-tenant / bloqueo de tenant (catálogo AUTH ya sembrado).

## Quality Gate vigente

**Sin evaluar** — no se ha cerrado ninguna campaña, así que no hay veredicto técnico (`RED`/`YELLOW`/`GREEN`) que emitir todavía. El primer Quality Gate lo emite `qa-project-manager` al cerrar la primera campaña.

## Cobertura por módulo (última campaña que lo tocó)

| Módulo | Última campaña | Resultado | Cobertura |
|---|---|---|---|
| _(sin filas aún — se agrega una por cada módulo tocado por una campaña)_ | — | — | — |

## Backlog conocido

Ver el detalle en `docs/qa/PLAN-QA.md` §9. Resumen vivo (arranque):
1. Correr la PRIMERA campaña y establecer la línea base de cobertura.
2. Construir el catálogo de casos módulo por módulo (AUTH ya sembrado como plantilla de nivel de detalle) — mapear qué specs existentes cubren cada caso a medida que se escriben.
3. Automatizar los P0 a medida que existan specs E2E (meta de largo plazo: todo P0 automatizado).

## Riesgos abiertos

- **Cobertura real desconocida**: sin ninguna campaña corrida, no hay evidencia de cobertura de ningún módulo. Es el hueco de evidencia más grande del carril por definición hasta la primera campaña.
- **Sin auditoría de salud de suite**: no se sabe cuántos specs son flaky o legacy hasta correr las suites la primera vez.
