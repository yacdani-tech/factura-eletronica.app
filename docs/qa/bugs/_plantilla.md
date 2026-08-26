# BUG-AAAAMMDD-NN — <título corto: síntoma, no causa>

> Los campos de este bloque se traducen 1:1 a los CAMPOS PERSONALIZADOS nativos del board de Trello (`Plataforma QA`) al subir con `scripts/qa/trello.mjs crear`. Úsalos EXACTOS — el script busca las opciones por nombre; un valor que no exista como opción en Trello se deja sin fijar y hay que completarlo a mano en la tarjeta.

- **Fecha**: AAAA-MM-DD · **Campaña**: <nombre o `—`> · **Reportado por**: qa-explorador | qa-automatizador | el dueño del producto
- **Módulo**: <módulo> · **ID de requisito**: <ID del catálogo, ej. `AUTH-001`, o `—`>
- **Tipo**: Bug | Mejora (Bug = viola el spec/una regla; Mejora = sugerencia de UX/producto que NO viola nada — por defecto Bug)
- **Impacto observado** (HECHOS, no un veredicto): ¿fuga entre tenants? ¿afecta dinero? ¿bloquea sin salida? ¿hay workaround? — quien reporta llena esto, nunca la severidad final.
- **Frecuencia**: 2/2 | 2/3 | ... (cuántas veces reprodujo sobre cuántos intentos)
- **Severidad**: S0 | S1 | S2 | S3 — PROPUESTA por quien reporta a partir del impacto observado; la severidad FINAL la confirma `qa-analista` en el triage (criterios en `docs/qa/PLAN-QA.md` §5 — S0 se escala al dueño del producto DE INMEDIATO; solo aplica a Tipo=Bug, dejar `—` en una Mejora)
- **Prioridad**: Alto | Medio | Bajo (por defecto: S0/S1→Alto, S2→Medio, S3→Bajo — sobreescribir solo con motivo)
- **Estado**: nuevo | confirmado | en-desarrollo | corregido-por-verificar | verificado-cerrado | rechazado-no-repro | rechazado-por-diseño | falta-decision-producto | duplicado-de:<id>
- **Regla dura afectada**: una regla dura del proyecto (ver `CLAUDE.md`) (o `—`)

## Entorno (campos personalizados de Trello)
- **Entorno**: staging | producción — dentro del carril de QA, SIEMPRE `staging` (el carril tiene PROHIBIDO producción, PLAN-QA §1.5)
- **Navegador**: Chrome | Safari | Firefox | Edge
- **Ancho**: móvil | tablet | escritorio
- **Rol del usuario**: Super-Admin | Admin | Operador | Contador | Visitante sin sesión
- **Reproducible**: Sí | No | Intermitente (por defecto `Sí` — el carril no reporta sin reproducir 2 veces; usar `Intermitente` solo si no reprodujo siempre)
- Commit: `<sha corto>` · Rama: `dev`
- Tenant de prueba: <e2e-ef-… / qa-…>

## Regla
<la regla de negocio o requisito que el bug viola — citala, no solo la nombres>

## Precondición
<qué tiene que existir antes de reproducir: datos, rol, estado previo>

## Pasos MÍNIMOS (reproducidos 2 veces desde cero — sin esto el bug NO se reporta; excepción S0 en PLAN-QA §1 principio 8)
<reducí el camino real a los pasos mínimos que disparan el bug — si el camino real tenía 12 pasos y 4 alcanzan, entregá los 4>
1. <paso exacto, con datos concretos>
2. <paso>
3. <paso>

## Esperado
<qué debía pasar>

## Actual
<qué pasa de verdad — mensaje de error textual si lo hay>

## Evidencia
- `docs/qa/evidencia/BUG-AAAAMMDD-NN/<archivo>.png` — <qué muestra>
- Trace/reporte local: <comando para regenerarlo, ej. `npm run test:e2e -- <spec> --trace on`>

## Triage (qa-analista)
- <dedup contra bugs/pendientes existentes, hipótesis de área — SIN diagnóstico profundo de código productivo, eso es del carril dev>

## Resolución
- Fix: <commit/PR cuando exista> · Re-verificado: <fecha · resultado · quién>
