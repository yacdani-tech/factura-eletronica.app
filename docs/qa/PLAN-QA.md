# PLAN-QA — Manual del carril de QA extenuante

> Fuente de verdad operativa del carril de QA de la plataforma. La versión corta (contrato del carril) vive en `CLAUDE.md` §"Carril de QA extenuante"; este archivo es el manual completo que todo agente del carril lee al arrancar una campaña. Lo mantiene `qa-analista`.

## 1. Propósito y principios

El carril de QA es un flujo **independiente del desarrollo**: no entrega features, entrega **evidencia** — casos de prueba diseñados y ejecutados, bugs documentados con reproducción verificada, y un reporte de campaña con números. Existe porque el flujo de desarrollo (líder → `qa-tests` → `revisor`) verifica *el cambio que se acaba de hacer*; este carril ataca *el producto entero*, buscando lo que se rompió entre features, lo que nunca se probó y lo que solo aparece con datos/combinaciones reales.

Principios no negociables:

1. **El carril QA no arregla código productivo.** Encuentra, reproduce, documenta, prioriza. Los fixes entran por el carril de desarrollo normal (project-manager prioriza → agente líder arregla → `qa-tests` verifica con test de regresión) y este carril solo re-verifica el caso al cerrarse el bug. Los agentes del carril SÍ pueden escribir código de **test** (specs, fixtures, helpers bajo `apps/web/e2e/` y archivos `*.test.ts*`), jamás `app/`, `lib/`, `components/` productivos ni migraciones.
2. **Probar antes de reportar.** Un bug sin reproducción verificada 2 veces no se reporta (regla existente del proyecto). Todo bug lleva pasos exactos, esperado vs. actual y evidencia.
3. **Riesgo primero.** El orden de ataque es siempre: dinero → multi-tenant/RLS → ingesta de datos → documentos inmutables → resto. Una campaña que gasta el presupuesto en cosmética antes de cubrir el flujo de negocio principal está mal diseñada.
4. **Datos propios, nunca esperar a que el dueño del producto los cree.** El QA siembra los escenarios que cruzan umbrales (paginación >20, umbrales de cuota, colas con conflictos). El estado "activado" ES el caso de prueba.
5. **Nunca contra producción.** Todo corre contra la base de datos de DEV con tenants efímeros (`e2e-ef-*`) o tenants QA descartables. Prohibido usar el MCP de producción, el dominio de producción, o el tenant real del dueño del producto desde este carril.
6. **Jamás debilitar una aserción para poner algo en verde.** Si un test revela un bug, el bug se documenta; el test no se ajusta. La suite golden-master del módulo de cálculo crítico es sagrada.
7. **Nunca declarar un área "bien", "cubierta" o "sin problemas" sin evidencia cuantificable** de qué se ejecutó, contra qué versión/commit, y qué quedó sin probar. "Corrí la suite y no vi nada raro" no es un veredicto — un veredicto trae números (§12/§13). Esta regla aplica a los CUATRO agentes del carril, no solo al que arma el reporte final.
8. **Un hallazgo que huele a S0 no espera el protocolo de reproducción normal.** La regla de "reproducir 2 veces antes de reportar" (principio 2) tiene una excepción: si el primer hallazgo implica fuga entre tenants, corrupción de datos o exposición de algo sensible, se captura la evidencia MÍNIMA, se corta esa línea de prueba ahí mismo y se escala al dueño del producto de inmediato — la segunda reproducción (si hace falta) se decide después del triage, nunca reinsistiendo alegremente sobre una fuga real ya confirmada una vez.
9. **Mobile SIEMPRE (decisión del dueño del producto).** La resolución MOBILE (375px) es una dimensión transversal de TODA campaña, no un tour aparte que se saltea cuando el alcance es "de otra cosa" (auth, permisos, flujo principal…). Cada charter/caso que corre en escritorio corre también a 375px, y el resultado lo declara explícitamente (viewport en el entorno del bug y en el reporte): o se probó en mobile, o queda `NOT_RUN` con motivo — nunca un default silencioso. `qa-analista` reparte la pasada mobile en cada charter y la pone en los Exit criteria; `qa-explorador` la ejecuta; `qa-project-manager` no da GREEN a un alcance con la cobertura mobile de un P0 en silencio. Origen: un charter se ejecutó solo en escritorio y el hueco mobile quedó sin cubrir.

## 2. Agentes del carril

| Agente | Rol en una campaña | Definición |
|---|---|---|
| `qa-project-manager` | Coordinador ESTRATÉGICO: decide el alcance/tipo de cada campaña, lleva el estado del carril en el tiempo (`docs/qa/ESTADO-QA.md`), recomienda el siguiente paso al cerrar. NO diseña casos ni ejecuta. | `.claude/agents/qa-project-manager.md` |
| `qa-analista` | Líder TÉCNICO de la campaña: diseña el plan dentro del alcance que le da el PM, mantiene el catálogo de casos, hace triage de bugs, emite el reporte final. | `.claude/agents/qa-analista.md` |
| `qa-explorador` | Testing exploratorio con navegador real, guiado por charters/tours: datos límite, permisos por rol, responsive, interrupciones, multi-tenant. | `.claude/agents/qa-explorador.md` |
| `qa-automatizador` | Corre las suites completas LOCAL (Vitest + Playwright), automatiza los casos P0 del catálogo, mantiene la salud de la suite E2E. | `.claude/agents/qa-automatizador.md` |

`qa-tests` y `revisor` **siguen siendo del carril de desarrollo** — no se reemplazan, no se mezclan. Si una campaña encuentra un bug y el dueño del producto decide arreglarlo, el fix lo verifica `qa-tests` dentro del flujo de desarrollo; `qa-automatizador` solo re-ejecuta el caso del catálogo después.

**Dos capas de coordinación, sin pisarse**: `qa-project-manager` decide QUÉ campaña corresponde y CUÁNDO (alcance/tipo/motivo, mirando el estado del carril a lo largo del tiempo); `qa-analista` diseña CÓMO ejecutar ESA campaña puntual (casos concretos, charters, triage). Es la misma separación que `project-manager` vs. un líder de dominio en el carril de desarrollo.

Los agentes no se invocan entre sí: el **orquestador** (la sesión principal) los coordina — PM (alcance) → analista (plan técnico) → explorador + automatizador en paralelo → analista (triage + reporte) → PM (actualiza estado, recomienda próximos pasos).

## 3. Tipos de campaña

| Tipo | Cuándo | Alcance típico |
|---|---|---|
| **Regresión de módulo** | Después de una tanda de features en un módulo | Todos los casos del catálogo de ese módulo + exploratorio dirigido |
| **Flujo de negocio completo** | Periódico, o antes de un hito | El catálogo transversal del flujo principal entero, de punta a punta |
| **Smoke pre-release** | Antes de promover `dev` → `main` | P0 de todos los módulos + suites completas en verde |
| **Dirigida** | Un pendiente/bug conocido o un área sospechosa | Casos diseñados ad-hoc (ej. concurrencia, deadlock) |
| **Matriz de permisos** | Cuando cambian roles/permisos | Admin/Operador/Contador × cada acción — verificar que el BACKEND bloquea, no solo que la UI oculta |

La campaña se activa solo cuando el dueño del producto la pide: comando `/qa <alcance>` o en palabras ("campaña de QA", "QA extenuante de X", "smoke pre-release").

## 4. Catálogo de casos (`docs/qa/casos/`)

- Un archivo por módulo (`auth.md`, …) + los transversales. Formato: `docs/qa/casos/_plantilla.md`.
- **IDs estables** con prefijo de módulo: nunca se renumeran ni se reusan; un caso retirado se marca `RETIRADO` con motivo, no se borra.

| Prefijo | Módulo |
|---|---|
| AUTH | Login, registro público, invitaciones, sesión, bloqueo de tenant |
| TENANT | Multi-tenant: resolución de tenant, aislamiento RLS, membresías/roles |
| DATA | Ingesta/importación de datos: parseo, detección de estructura, normalización, deduplicación |
| CALC | Módulo de cálculo crítico del proyecto (dinero/reglas puras), si existe |
| DOC | Documentos generados: inmutabilidad, estados, anulación, link público |
| ADM | Consola super-admin |
| TRANS | Transversales: roles/permisos, responsive, a11y, persistencia de forms |

> La tabla de arriba es una semilla genérica de un SaaS multi-tenant. Al aparecer módulos de negocio propios del proyecto, agregarles su prefijo estable y su archivo de catálogo — el prefijo, una vez elegido, no se cambia.

- **Prioridades**: P0 = regla dura o flujo de negocio principal (se ejecuta en TODA campaña que toque el módulo); P1 = funcionalidad principal; P2 = secundario/borde.
- **Trazabilidad**: cada caso referencia la sección del spec de requisitos (en `docs/`) o la regla dura de `CLAUDE.md` que lo origina, y su estado de automatización (`manual` / `unit:<ruta>` / `e2e:<ruta>` / `parcial:<ruta>`). La meta de largo plazo: todo P0 automatizado.
- Cada ejecución actualiza la línea "Última ejecución" del caso (fecha · resultado · campaña).

## 5. Protocolo de bugs (`docs/qa/bugs/`)

- Un archivo por bug: `BUG-AAAAMMDD-NN-<slug>.md` (NN = secuencia del día, mirar los existentes con glob antes de numerar). Formato: `docs/qa/bugs/_plantilla.md`.
- **Severidades**:
  - **S0** — viola una regla dura de CLAUDE.md (dinero mal calculado, datos de otro tenant visibles, documento emitido mutado, pérdida de lo digitado en un form, registro de negocio borrado indebidamente, auditoría ausente) o bloquea el flujo de negocio principal sin workaround. → Se escala al dueño del producto de inmediato, sin esperar el reporte.
  - **S1** — flujo principal roto con workaround, o dato incorrecto no monetario.
  - **S2** — funcionalidad secundaria rota, responsive/a11y roto, mensaje de error genérico donde la convención exige causa+acción.
  - **S3** — cosmético, copy, alineación.
- **Estados = las 7 COLUMNAS reales del board de Trello** (`Plataforma QA`, no un enum inventado del repo): `Reportado` (entrada) → `Confirmado` (triage del operador) → `En arreglo` (el dueño del producto lo priorizó, carril dev trabajando) → `Por verificar` (corregido, espera re-ejecución de QA) → `Cerrado` (verificado). Salidas alternas: `Descartado (no era bug)` (no reproduce, o es comportamiento esperado — con el motivo en la tarjeta) y `Falta decisión de producto` (el caso reveló una ambigüedad del spec; el dueño del producto decide antes de seguir). El campo `Estado` del bug `.md` LOCAL solo importa ANTES de subir (`nuevo`/`confirmado`/`rechazado-*`, el triage del analista) — una vez creada la tarjeta, el estado vive y se mueve SOLO en Trello (ver §11: nunca se duplica).
- **Tipo — Bug vs. Mejora** (campo personalizado de Trello, decisión del dueño del producto — antes era etiqueta, se movió a campo para que TODO lo estructurado viva en un solo mecanismo): un **Bug** viola el spec o una regla dura (severidad S0-S3 aplica); una **Mejora** es una sugerencia de UX/producto que NO viola nada — sin severidad (queda `—`, el título de la tarjeta cae a `[Mejora]` en vez de `[S?]`). Por defecto `Bug` si el `.md` no trae el campo `Tipo`. Esta distinción reemplaza/formaliza lo que antes vivía suelto como "hallazgos que no son bugs" en el reporte de campaña — ahora tiene representación propia en el board.

### 5.1 Severidad vs. Prioridad — qué es cada una y cómo elegir (entrenamiento del carril)

Son DOS campos personalizados distintos (ya no etiquetas) que se confunden fácil porque los dos "suenan" a urgencia. Son ejes ortogonales — un bug puede tener severidad alta y prioridad baja, o al revés — y el carril los llena con criterios DIFERENTES:

| | **Severidad** | **Prioridad** |
|---|---|---|
| **Qué mide** | Cuánto daño hace el defecto AL SISTEMA si nadie lo toca — un hecho técnico, no una opinión | Qué tan urgente es agendarlo — una decisión de negocio |
| **Quién la fija** | El agente que reporta el bug, con criterio FIJO (tabla de abajo) — casi no admite juicio | El dueño del producto (o quien prioriza el backlog) — admite contexto: release próximo, cliente afectado, esfuerzo del fix |
| **Escala** | S0 · S1 · S2 · S3 | Alto · Medio · Bajo |
| **¿Cambia con el tiempo?** | NO — la severidad de un bug no cambia porque "total no lo vamos a arreglar ya" | SÍ — la prioridad de un bug puede bajar si aparece un workaround aceptado, o subir si empieza a doler más |
| **¿Aplica a una Mejora?** | NO — una Mejora no viola nada, no tiene severidad (campo `—`) | SÍ — toda Mejora igual compite por lugar en el backlog y necesita prioridad |

**Criterio de Severidad (técnico, casi automático — usar esta tabla, no "a ojo"):**
- **S0**: viola una regla dura de `CLAUDE.md` (dinero mal calculado, datos de otro tenant visibles, documento emitido mutado, se perdió lo que el usuario digitó, registro de negocio borrado indebidamente, falta auditoría) O bloquea el flujo de negocio principal sin ningún workaround. Siempre se escala al dueño del producto de inmediato — la severidad ya te dice que no espera al reporte.
- **S1**: el flujo principal se rompe, pero hay un workaround (aunque sea incómodo); o un dato sale incorrecto y no es dinero.
- **S2**: algo secundario falla — responsive, accesibilidad, un mensaje de error genérico donde debía ser específico.
- **S3**: cosmético — alineación, copy, un detalle visual que no afecta el uso.

**Criterio de Prioridad (de negocio — el puente pone un default, el dueño del producto lo puede cambiar con motivo):**
- Default automático: **S0/S1 → Alto**, **S2 → Medio**, **S3 → Bajo**. Este default es el punto de partida correcto en el 90% de los casos — no hace falta pensarlo dos veces salvo que algo del contexto lo justifique.
- Subir la prioridad de lo que el default sugiere cuando: el bug afecta una pantalla de uso diario (el flujo principal, las listas más usadas) más que una de uso ocasional; hay un lanzamiento o demo próximo; muchos usuarios lo reportarían si lo vieran (aunque técnicamente sea S2/S3); es una Mejora que destraba otro trabajo pendiente.
- Bajar la prioridad de lo que el default sugiere cuando: ya existe un workaround que el equipo usa sin dolor real; el módulo afectado se va a reemplazar pronto; el costo de arreglarlo es desproporcionado al impacto real (poco común, pero pasa con S1 en flujos casi sin uso).
- **Toda desviación del default se anota con el motivo** en la tarjeta — nunca "porque sí". Si no hay un motivo claro, se deja el default.

**Ejemplos resueltos** (para calibrar la intuición):
- El redondeo de un monto da 1 centavo de diferencia en la moneda local → **S0** (viola regla dura de dinero) + **Alto** (default, sin excepción — un S0 nunca baja de Alto).
- El botón "Editar" de una fila queda un poco desalineado en 375px → **S2** (responsive) + **Bajo** (default; no hay razón de negocio para subirlo salvo que sea LA pantalla que se demuestra mañana).
- Sugerencia: agregar un atajo de teclado para confirmar en lote → **Mejora**, sin severidad + **Medio** (a ojo, ajustable si destraba otra tarea).
- Un mensaje de error dice "Error interno" en vez de explicar la causa → **S2** (convención de mensajes violada, no es dinero ni fuga de datos) + **Medio** (default; sube a Alto si aparece muy seguido y genera tickets de soporte reales).
- **Dedup**: antes de crear un bug, grep en `docs/qa/bugs/` y en los pendientes conocidos del proyecto — un síntoma conocido se anota como re-ocurrencia en el bug existente.
- **Evidencia**: screenshots chicos (PNG) van a `docs/qa/evidencia/<bug-id>/` y se referencian desde el bug — el puente los adjunta solo a la tarjeta al crearla. Traces/videos de Playwright NO se meten al repo (pesados): quedan en `apps/web/test-results/`/`playwright-report/` locales y el bug anota la ruta + cómo regenerarlos (comando + spec).
- **Registro oficial = Trello** (decisión del dueño del producto): el bug aprobado por el operador humano se sube al board con `scripts/qa/trello.mjs`, que traduce el `.md` a los **campos personalizados nativos** del board (ID de requisito, Prioridad, Entorno, Navegador, Ancho, Rol del usuario, Reproducible) — visibles en el frente de la tarjeta sin abrirla — y agrega el checklist **"Antes de mover a Confirmado"** (4 puntos; el puente pre-marca los que ya están objetivamente satisfechos al crear la tarjeta — reproducido 2 veces, evidencia adjunta, campos completos — y deja SIEMPRE sin marcar "regla releída y citada", que exige juicio humano). Ver §11 — el reparto de fuentes de verdad entre repo y board está definido ahí y NO debe duplicarse.
- **Número de tarjeta visible en el título** (decisión del dueño del producto): Trello asigna un número secuencial (`idShort`) a cada tarjeta, pero mostrarlo en el frente depende de un ajuste de cuenta/vista que resultó poco confiable. Para no depender de eso, el puente lee el `idShort` recién asignado tras crear la tarjeta y lo escribe él mismo al frente del título (`#15 [S2] descripción…`) con un segundo request — así el número se ve SIEMPRE en la vista de lista, en cualquier cliente de Trello, sin ajustes de por medio.

## 6. Runbook — E2E y suites en LOCAL (gate primario)

Contexto: si GitHub Actions está desactivado para push/PR (tope de minutos; queda solo `workflow_dispatch`), el gate de calidad ES este runbook. La infra local funciona sin configuración extra: los helpers de E2E, el seed y el GC cargan `apps/web/.env.local` como fallback de las vars que falten (URL/keys de la base de datos de dev, service-role para la fábrica de tenants).

### Comandos (todos desde `apps/web/`)

| Qué | Comando |
|---|---|
| Unit/integración completa | `npx vitest run` (o `npm run test:web` desde la raíz) |
| Unit de un área | `npx vitest run lib/<área>` |
| Tipos | `npx tsc --noEmit` |
| E2E suite completa | `npm run test:e2e -- --workers=2` |
| E2E un spec | `npm run test:e2e -- <spec>.spec.ts` |
| E2E con navegador visible / debug | `npm run test:e2e -- --ui` (o `--headed`) |
| Ver el último reporte HTML | `npx playwright show-report` |
| GC de tenants efímeros huérfanos | `npm run test:e2e:gc` |
| Seed del tenant fijo legacy | `npm run test:e2e:seed` (idempotente) |

### Reglas y gotchas del repo (aprendidas a golpes — respetarlas)

1. **Dev server compartido**: `reuseExistingServer` está activo fuera de CI — si hay un `npm run dev` corriendo en :3000, Playwright lo REUSA. Eso es rápido, pero los flags de seguridad (envío de correo en off, límite de registro público en off, fallbacks de IA en off) solo los inyecta Playwright cuando levanta su PROPIO server. Antes de una corrida, confirmar que el `.env.local` del dev server ya trae esos flags en off; si hay duda, apagar el dev server y dejar que Playwright levante el suyo.
2. **Nunca `next build` con el dev server arriba** (corrompe `.next/` compartido). El E2E usa `next dev`, no aplica; pero si algún día se migra a `build && start`, usar `distDir` temporal.
3. **Workers locales**: 2–4 máximo. Cada worker crea SU tenant efímero contra la base de datos de dev; más workers = más carga sobre `next dev` (compila on-demand) y más flakiness de timeouts, no más velocidad.
4. **Una sola corrida E2E a la vez en esta máquina** (puerto 3000 + base de datos de dev compartida). Si otra sesión está corriendo E2E, esperar.
5. **Corrida abortada = tenants huérfanos**: si se corta una corrida (Ctrl+C, crash), correr `npm run test:e2e:gc` antes de la siguiente.
6. **Specs legacy sin migrar**: si algún spec todavía corre contra un tenant fijo compartido (contaminado por corridas previas), NO confiar en aserciones de conteos globales en esos specs. Migrarlos al fixture de tenant efímero es prioridad del backlog (§9).
7. **Aserciones con fechas/montos de `Intl`**: normalizar `\s+`→`" "` o usar `\s` — Windows local usa espacio ASCII, Linux/ICU usa U+202F (falso verde local).
8. **Los specs E2E no pasan por el `tsc` principal**: al cambiar la firma de un helper de textos/config, grepear también `e2e/**`.
9. **Fallo "diálogo no cierra tras submit"**: antes de asumir que la action falló, mirar el screenshot/snapshot del reporte — botón en "Creando…" disabled = lento, no roto. Timeouts explícitos de 15s en aserciones post-mutación real.
10. **try/finally envolvente**: en specs que mutan tablas con DELETE bloqueado, el `try` envuelve DESDE el primer paso mutante; la limpieza de cada fixture va en su propio `try/catch`.

### Orden recomendado de una corrida de campaña

1. `npx tsc --noEmit` + `npx vitest run` (rápido, corta temprano si algo está roto).
2. `npm run test:e2e:gc` (higiene).
3. `npm run test:e2e -- --workers=2` (suite completa) o el subconjunto de specs del módulo bajo campaña.
4. Fallos → reproducir individual con `--ui`/`--headed`, diagnosticar si es bug de producto (→ reporte de bug) o deuda del spec (→ salud de suite, ver el agente automatizador).

## 7. Herramientas

### Hoy (cero instalación — parte del stack)
- **Vitest** (unit/integración) y **Playwright** (specs E2E, tenants efímeros por worker, trace on-first-retry).
- **MCP de Playwright** — el navegador real de los agentes para exploración y verificación visual interactiva.
- **pgTAP** (`supabase/tests/database`) — suites de BD/RLS; corren vía runner remoto manual, no en CI.
- **tsc estricto** y los scripts `test:e2e:seed` / `test:e2e:gc`.
- **gh CLI** — para Issues (gratis, no gasta minutos de Actions) si se aprueba el espejado de S0/S1.

### Fase 1 (una instalación, alto valor — proponer en la primera campaña)
- **`@axe-core/playwright`** — auditoría de accesibilidad automatizada en las pantallas clave; se integra como aserciones dentro de specs existentes.
- **`@vitest/coverage-v8`** — mapa de cobertura INFORMATIVO para que `qa-analista` encuentre huecos (nunca como gate de % obligatorio).

### Fase 2 (opt-in, cuando el catálogo esté maduro)
- **`fast-check`** (property-based) sobre el módulo de cálculo crítico (si el proyecto lo tiene): invariantes que deben aguantar CUALQUIER input — redondeo determinista, total ≥ mínimo, sumas exactas por moneda, conversiones de unidad deterministas. Complementa el golden-master con inputs que a nadie se le ocurrieron.
- **Stryker (mutation testing) SOLO sobre el módulo de cálculo crítico** — mide si la suite realmente atraparía un bug de dinero. Caro en tiempo; acotado al cálculo es viable y es el lugar donde más paga.
- **Visual regression acotada** con `toHaveScreenshot` SOLO para vistas críticas de presentación (frágil entre máquinas — usarlo consciente de eso, con umbrales).

### Descartadas (y por qué)
- Gestores de casos SaaS (TestRail, Qase…): el catálogo vive en el repo, versionado, donde los agentes leen/escriben. Cero costo, cero fricción.
- Cypress: ya hay Playwright maduro con infra propia.
- `act` (Actions local en Docker): paridad imperfecta y Docker en Windows pesa; el runner self-hosted (§8) es la vía correcta si se quiere revivir CI.

## 8. CI — estado y opciones para revivirlo

- **Estado (opción A)**: `ci.yml` sin triggers automáticos; gate = este runbook local + tsc/Vitest + revisor + build de deploy. `workflow_dispatch` disponible para gastar minutos puntuales a demanda.
- **Nada que instalar aparte**: el `ci.yml` corría LOS MISMOS comandos del runbook §6 (`npm ci`, `npm run test:web`, `playwright install`, `test:e2e:seed`, `test:e2e --shard`). Una máquina con Node + dependencias + Chromium YA es el CI; lo único que se pierde al apagarlo es el disparo automático, el entorno limpio por corrida, el paralelismo de varios runners y el resultado visible en el PR.
- **Opción B (recomendada si existe una máquina dedicada del operador de QA): runner self-hosted.** Minutos GRATIS ilimitados para un repo privado. Pasos: GitHub → repo → Settings → Actions → Runners → "New self-hosted runner" (Windows x64) → ejecutar los comandos de configuración que da la página → opcionalmente instalarlo como servicio de Windows → en `ci.yml`, cambiar `runs-on: ubuntu-latest` por `runs-on: self-hosted` en los jobs E2E y re-activar los triggers `push`/`pull_request`. Precauciones: (a) validar `ci.yml` con `actionlint` antes de commitear; (b) jamás habilitar PRs de forks con runner self-hosted; (c) en UNA máquina los shards de la matriz corren EN SERIE (un job a la vez) — está bien, no pelean por el puerto; alternativamente reducir a un solo job sin matriz con `--workers=2`; (d) los aprendizajes de ICU se invierten: el runner sería Windows, CI dejaría de detectar los espacios U+202F de Linux — mantener las aserciones normalizadas; (e) quien registra el runner necesita ser admin del repo — lo hace el dueño del producto, no el operador de QA (que tiene solo lectura); (f) un runner self-hosted ejecuta en esa máquina el código de cualquier commit que dispare el workflow: por eso la regla (b) no se negocia.
- **Opción C**: esperar el reset mensual de minutos (limitado) o subir el plan de GitHub. Decisión de costo del dueño del producto.
- **Opcional independiente**: corrida NOCTURNA local — una tarea programada que corra la suite completa de madrugada y deje el reporte en `docs/qa/reportes/`. Solo si el dueño del producto la pide; la máquina debe quedar encendida.

## 9. Backlog inicial del carril

Prioridad de arranque (semilla genérica; se reemplaza por pendientes reales a medida que aparecen):

1. **Correr la primera campaña** y establecer la línea base de cobertura (recomendado: flujo de negocio principal o matriz multi-tenant).
2. **Construir el catálogo módulo por módulo**: AUTH (semilla ya creada) → el flujo de negocio principal → el resto, mapeando qué specs existentes cubren cada caso.
3. **Migrar cualquier spec legacy** que corra contra un tenant fijo compartido al fixture de tenant efímero — elimina la dependencia del tenant contaminado y sus falsos rojos.
4. **Automatizar los P0** a medida que existan specs E2E (meta de largo plazo: todo P0 automatizado).
5. **Campaña de matriz de permisos** Admin/Operador/Contador (verificar bloqueo en backend, no solo UI).
6. **Diseñar casos dirigidos de concurrencia** (emisión simultánea, deadlocks) ANTES de que exista el fix, para poder verificarlo cuando llegue.

## 10. Definición de "campaña terminada"

- Plan ejecutado, o cada desviación anotada en el reporte con motivo.
- Todo hallazgo tiene su archivo de bug con severidad, repro verificada y evidencia; S0 ya escalados al dueño del producto (no esperaron al reporte).
- Suites corridas con números registrados (pasan/fallan/saltados, duración).
- Catálogo actualizado ("Última ejecución" de cada caso tocado).
- Reporte emitido en `docs/qa/reportes/` con el formato de `_plantilla.md`, S0/S1 arriba.
- NADA de código productivo tocado por el carril.

## 11. Operador humano del carril y registro en Trello

El carril lo opera una PERSONA de QA (no el dueño del producto). Su guía de instalación y operación diaria es `docs/qa/ONBOARDING-QA.md`. Su rol es el **gate entre hallazgo y registro**: los agentes encuentran y documentan, ella revisa y decide qué se registra oficialmente.

### Reparto de fuentes de verdad (no duplicar estado)

El operador trabaja con acceso de **solo lectura** al repo, así que sus archivos de bug viven únicamente en su copia local. De ahí el reparto:

| Artefacto | Fuente de verdad | Quién lo mantiene |
|---|---|---|
| Bug reportado (descripción, repro, evidencia, estado del board) | **Trello** — la tarjeta lleva todo adentro y los screenshots adjuntos | Operador de QA + equipo de desarrollo |
| Catálogo de casos, manual, reportes de campaña | **Repo** (`docs/qa/`) | El dueño del producto (sube lo que el operador le pasa) |
| Archivo `.md` del bug en la copia local | Borrador de trabajo — insumo para armar la tarjeta | Operador (efímero) |

Regla derivada: **nunca** llevar el estado del bug en los dos lados. La tarjeta manda; el `.md` local solo conserva el link para evitar subidas duplicadas.

### Flujo de un bug, punta a punta

1. Un agente del carril lo documenta en `docs/qa/bugs/` con estado `nuevo`.
2. `qa-analista` lo tría: dedup, severidad, estado `confirmado` o `rechazado-*`.
3. **El operador humano lo revisa** y decide: va al board / no va / falta evidencia. Puede corregir la severidad — su criterio manda sobre el del analista.
4. Aprobado → `node scripts/qa/trello.mjs crear <ruta>`. La tarjeta queda arriba de la columna de entrada, etiquetada por severidad (si el board tiene etiquetas `S0`…`S3`), con la evidencia adjunta; el `.md` recibe la URL de vuelta.
5. El equipo de desarrollo lo arregla por el carril normal (project-manager → líder → `qa-tests` con test de regresión).
6. El operador re-verifica el caso del catálogo y mueve la tarjeta a cerrado.

### El puente (`scripts/qa/trello.mjs`)

Node puro, sin dependencias. Credenciales en `.env.qa` (raíz, gitignoreado): `TRELLO_API_KEY`, `TRELLO_TOKEN`, `TRELLO_LISTA_BUGS`. Comandos: `probar`, `boards`, `listas <idBoard>`, `etiquetas <idBoard>`, `previsualizar <bug.md>`, `crear <bug.md> [--forzar]`. Es idempotente: un bug que ya tiene tarjeta no se vuelve a subir salvo `--forzar`.

**Ningún agente sube tarjetas por su cuenta.** Crear una tarjeta publica contenido en un servicio externo: se hace SOLO cuando el operador humano lo pide para un bug concreto, después de revisarlo. Un agente que "encuentra y sube" rompe el gate humano, que es la razón de ser de este diseño.

## 12. Taxonomía de resultados (compartida por todo el carril)

Vocabulario ÚNICO para el resultado de un caso o charter — todos los agentes lo usan igual, así `qa-analista` agrega sin tener que interpretar prosa distinta de cada uno:

| Resultado | Significa |
|---|---|
| `PASS` | Se ejecutó y se comportó como el esperado. |
| `FAIL_PRODUCT` | Se ejecutó y el PRODUCTO no hizo lo esperado — candidato a bug. |
| `FAIL_TEST` | El producto está bien; el test/caso estaba mal escrito o desactualizado — deuda de suite, no bug. |
| `FAIL_ENVIRONMENT` | Falló por algo del entorno (tenant mal sembrado, server caído, credencial vencida) — no dice nada del producto ni del test. |
| `BLOCKED_SPEC` | No se pudo ejecutar porque el comportamiento esperado es ambiguo en el spec — va a `Falta decisión de producto`, no se inventa un esperado. |
| `BLOCKED_DATA` | No se pudo ejecutar porque faltó un dato/fixture que había que sembrar y no estaba. |
| `FLAKY` | Dio resultados distintos en corridas iguales — nunca se resuelve subiendo el timeout a lo loco; se documenta y se pone en cuarentena (ver `qa-automatizador.md`). |
| `NOT_RUN` | Estaba planeado y no se llegó a ejecutar (presupuesto de tiempo, dependencia bloqueada) — se declara explícitamente, nunca se omite en silencio. |
| `SKIPPED_APPROVED` | Se decidió no ejecutarlo con motivo aprobado (ej. el dueño del producto ya confirmó que ese caso no aplica más). |

Un reporte de campaña nunca dice "falló" a secas: dice CUÁL de estos nueve pasó.

## 13. Quality Gate y "cobertura fresca"

**Quality Gate** — al cerrar una campaña, `qa-project-manager` emite un veredicto TÉCNICO (no de negocio: no decide si se publica, informa el riesgo residual):

- **RED**: cualquier S0 abierto, un S1 en el flujo que se acababa de probar, la suite golden-master del módulo de cálculo rota, o un hallazgo de fuga entre tenants sin resolver.
- **YELLOW**: S1/S2 conocidos con mitigación aceptada, o cobertura P0 incompleta en algo que importa (`NOT_RUN`/`BLOCKED_*` en casos P0).
- **GREEN**: todos los gates obligatorios (P0 del alcance) pasaron y no hay bloqueantes abiertos.

**Cobertura fresca** — un caso con "Última ejecución: PASÓ" NO cuenta como cobertura vigente si el código que ese caso ejerce cambió DESPUÉS de esa fecha. `qa-project-manager` cruza la fecha de "Última ejecución" de cada caso (`docs/qa/casos/*.md`) contra las entradas de `docs/PROGRESO.md` posteriores a esa fecha para el mismo módulo — si hubo un cambio relevante después, el caso pasa a **STALE** aunque el archivo diga "PASÓ". Ejemplo: un caso corrió el 10 del mes y pasó; el 15 se tocó el módulo que ese caso ejerce → es cobertura STALE, no vigente, hasta que se re-ejecute.

Para el impacto transversal de un cambio (qué otros módulos consumen lo que cambió), usar el índice `codebase-memory` (`query_graph`/`trace_path`) en vez de armar un grafo de dependencias a mano. Al decidir alcance, `qa-project-manager` debe preguntarse qué consume lo que cambió, no solo mirar el nombre del módulo tocado.

## 14. Contratos de handoff entre agentes

Cada paso de la cadena entrega un bloque con esta forma — evita que el siguiente agente tenga que interpretar párrafos ambiguos. No hace falta JSON; un bloque de markdown con estos campos alcanza.

**PM → Analista (brief de alcance):**
```
BRIEF DE CAMPAÑA
Tipo: <regresión de módulo | flujo de negocio | smoke pre-release | dirigida | matriz de permisos>
Alcance: <módulo(s)>
Commit base: <sha corto de dev>
Motivo: <por qué esta campaña, ahora>
Riesgos a cubrir: <lista corta>
Exclusiones: <qué queda fuera y por qué>
Quality Gate exigido: <qué NO puede faltar para no salir RED>
```

**Analista → Explorador/Automatizador (plan técnico):**
```
PLAN DE CAMPAÑA
Hipótesis de riesgo: R1 ... R2 ... (ver §"diseño de casos" de qa-analista.md)
Casos obligatorios (P0 del alcance): <IDs>
Automatizador: <IDs + qué automatizar de nuevo>
Explorador: <charters/tours asignados>
Entry criteria: <qué debe existir antes de arrancar — ambiente, fixtures, migraciones aplicadas>
Exit criteria: <qué tiene que ser cierto para cerrar la campaña>
```

**Explorador/Automatizador → Analista (resultado por caso):**
```
<ID-del-caso o charter> — <resultado de la taxonomía §12>
Impacto observado (si no es PASS): <fuga cross-tenant? afecta dinero? bloquea sin salida? hay workaround?>
Frecuencia: <2/2, 2/3, 1/1...>
Evidencia: <ruta>
```
Nunca "severidad propuesta" — eso lo decide únicamente `qa-analista` en el triage, a partir del impacto observado (ver `qa-analista.md`).

**Analista → PM (resultado de campaña):**
```
RESULTADO DE CAMPAÑA
Planeados: N · Ejecutados: N
PASS: N · FAIL_PRODUCT: N · BLOQUEADOS: N · FLAKY: N · NOT_RUN: N
S0: N · S1: N · S2: N · S3: N
Gaps de cobertura detectados: <casos nuevos que hicieron falta y no estaban>
Quality Gate recomendado: RED | YELLOW | GREEN
```

## 15. Triggers automáticos de campaña

Más allá de "pasó mucho tiempo", ciertos cambios en `docs/PROGRESO.md` disparan SIEMPRE un tipo de campaña concreto — mismo espíritu que la tabla de "gate completo vs. carril rápido" de `CLAUDE.md`, aplicado a cuándo corresponde QA:

| Cambio reciente | Campaña que dispara |
|---|---|
| Nueva migración de BD / cambio de RLS | Matriz multi-tenant dirigida sobre las tablas tocadas |
| Cambio en el módulo de cálculo crítico | Golden master + regresión de cálculo — nunca opcional |
| Cambio de roles/permisos | Matriz de permisos completa |
| Cambio en generación/emisión de documentos | Documentos + cálculo + inmutabilidad |
| Cambio en el parser de ingesta o en la deduplicación de datos | Archivos hostiles + ingesta + el tramo del flujo principal que lo consume |

`qa-project-manager` revisa esta tabla contra las entradas recientes de `docs/PROGRESO.md` al decidir el alcance de la próxima campaña.
