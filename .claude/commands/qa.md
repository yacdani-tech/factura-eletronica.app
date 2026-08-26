---
description: Arranca una campaña del carril de QA extenuante (agentes qa-project-manager / qa-analista / qa-explorador / qa-automatizador)
---

Arrancá una campaña del carril de QA extenuante sobre: $ARGUMENTS

Sos el ORQUESTADOR del carril (no implementás nada vos). Seguí este flujo:

1. Leé `docs/qa/PLAN-QA.md` completo y la sección "Carril de QA extenuante" de `CLAUDE.md`. Verificá el `index_status` del MCP `codebase-memory` (refrescar si el HEAD avanzó).
2. Invocá a **qa-project-manager** para decidir/confirmar el ALCANCE: si `$ARGUMENTS` viene vacío, él lo propone cruzando `docs/qa/ESTADO-QA.md`, el backlog de PLAN-QA §9 y `docs/PROGRESO.md`; si `$ARGUMENTS` ya trae un alcance explícito, él lo registra en un brief (y avisa si detecta que el momento es claramente inoportuno). Confirmá el alcance con el dueño del producto antes de gastar en la campaña.
3. Invocá a **qa-analista** con ese brief para el PLAN TÉCNICO de campaña (tipo, casos a ejecutar/crear, charters para el explorador, trabajo para el automatizador).
4. Con el plan listo, lanzá **qa-explorador** y **qa-automatizador** EN PARALELO (una sola tanda de tool calls), cada uno con su parte del plan y el contexto mínimo necesario. Antes de lanzar: confirmá que no haya OTRA corrida E2E activa en la máquina y que el dev server (si se reusa) tenga los envíos de correo en modo apagado.
5. Todo S0 que aparezca se le muestra al dueño del producto DE INMEDIATO, sin esperar el cierre.
6. Al terminar ambos, invocá de nuevo a **qa-analista** para triage + reporte (`docs/qa/reportes/`).
7. Invocá a **qa-project-manager** para que actualice `docs/qa/ESTADO-QA.md` con el resultado, emita el **Quality Gate** (`RED`/`YELLOW`/`GREEN`, PLAN-QA §13) y recomiende el siguiente paso (próxima campaña, o qué bug pasar primero al carril de desarrollo).
8. Entregá el resumen a quien haya lanzado la campaña: Quality Gate arriba de todo, números de suites (taxonomía PLAN-QA §12), bugs por severidad (S0/S1 primero, con links a los archivos), gaps de cobertura detectados, y la recomendación de `qa-project-manager`.
9. Ofrecé subir al board los bugs que el operador humano apruebe — UNO POR UNO, nunca en bloque automático: `node scripts/qa/trello.mjs previsualizar <bug.md>` para mostrar cómo queda, y `crear <bug.md>` para registrarlo. Nunca subas una tarjeta sin que la persona lo pida explícitamente para ese bug (ver PLAN-QA §11: el gate humano es la razón de ser del diseño).

Reglas duras del carril: NADIE toca código productivo; bugs solo con reproducción verificada 2×; nunca contra producción ni `supabase-prod`; los fixes son del carril de desarrollo. Ningún agente invoca a otro — vos sos el único que dispara `qa-project-manager`/`qa-analista`/`qa-explorador`/`qa-automatizador`.
