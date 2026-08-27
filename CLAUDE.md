# CLAUDE.md — Plataforma (base genérica)

## Qué es este proyecto
Plataforma es un SaaS multi-tenant (describir el dominio concreto de la app aquí al instanciar). **Este repo es la BASE genérica**: la infraestructura, las convenciones y el proceso son reusables; el negocio concreto se define en `docs/Requerimientos_<app>.md` siguiendo `docs/00-estandar-de-requisitos.md`.

El **cobro de suscripción de la plataforma a los tenants** existe como MÓDULO REUSABLE (ver regla dura #9): cada tenant recibe una factura de suscripción por ciclo de aniversario, en USD, con pago manual (el tenant reporta comprobante, el super-admin marca pagado). La pasarela de pago automática queda para fase 2 de cada app.

## Documentos fuente (leer antes de tareas grandes)
- `docs/Requerimientos_<app>.md` — spec completo. **FUENTE DE VERDAD del alcance**, versionada y mantenida por el agente siguiendo `docs/00-estandar-de-requisitos.md`. Ante un cambio de regla: se reescribe la viñeta en el `.md` y se agrega una línea a `docs/CHANGELOG-requisitos.md` (y, si el proyecto mantiene una copia Word, se regenera con pandoc — nunca se edita a mano).
- `docs/PLAN_MVP.md` — plan de tareas secuencial con estimados.
- `docs/PROGRESO.md` — estado actual. Actualizarlo al terminar cada tarea (lo mantiene el agente project-manager).
- `design-system/<app>/MASTER.md` — FUENTE DE VERDAD visual para la UI (generada con el skill ui-ux-pro-max). Si existe `design-system/<app>/pages/<pagina>.md`, sus reglas tienen prioridad sobre MASTER.md para esa página.
- `docs/arquitectura/contratos-transversales.md` — contratos que cruzan middleware/capas/agentes (header interno `PATHNAME_HEADER`, política de uso del cliente `service_role`, excepciones documentadas a la regla dura #1, contrato del lector de archivos de importación, normalizador espejado JS↔SQL, memoización por-request, bypass de rutas de cron, gate de subdominio inexistente). Mantenido por `arquitecto-app`; cualquier código nuevo que toque uno de estos contratos debe leerlo primero.
- `docs/arquitectura/recomendacion-e2e-playwright.md` — recomendación de infraestructura E2E mínima; **IMPLEMENTADA** (`apps/web/e2e/`, `apps/web/playwright.config.ts`). Queda como referencia de las decisiones de diseño.
- `docs/qa/PLAN-QA.md` — manual del **carril de QA extenuante** (agentes `qa-project-manager`/`qa-analista`/`qa-explorador`/`qa-automatizador`, catálogo de casos, protocolo de bugs, runbook E2E local). Leerlo al arrancar cualquier campaña de QA (`/qa`). Ver la sección "Carril de QA extenuante" más abajo.

## Stack
Next.js (App Router) en Vercel · Supabase (Postgres + RLS, Auth, Storage) · Resend (email) · Vitest + Playwright · TypeScript estricto + Zod.

## Reglas de negocio DURAS (violarlas = bug crítico)
Estas son las reglas GENÉRICAS de la plataforma base. **Las reglas de negocio ESPECÍFICAS de esta app se agregan aquí al instanciar, siguiendo `docs/00-estandar-de-requisitos.md`.**

1. **Multi-tenant (POR SESIÓN, no por subdominio):** toda tabla de datos de tenant lleva `tenant_id NOT NULL` + política RLS. **El tenant se resuelve por SESIÓN/MEMBRESÍA** (`auth.uid()` → `usuarios_tenants`, vía `private.current_tenant_id()`), NO por subdominio — este producto NO da una URL por tenant: todos los clientes usan UN solo dashboard (`web.factura-electronica.app`) y el tenant sale del login. (Desviación deliberada del framework casilleros, que sí usaba subdominio=tenant.) JAMÁS aceptar `tenant_id` desde el cliente. El `service_role` vive SOLO en `apps/api` (nunca en `apps/web`); las tres superficies son `api.` / `web.` / apex (marketing).
2. **Un usuario = un tenant.** Correo único global (si ya existe, se usa otro).
3. **Dinero y multi-moneda:** `numeric`, nunca float. **USD es la moneda BASE**; cada tenant tiene UNA `moneda_local` configurable (código ISO). Siempre exactamente dos monedas: USD + local. **NADA de símbolo de moneda hardcodeado**: la moneda local, su símbolo y sus decimales viven en un **catálogo de monedas** (cada moneda con sus decimales; ej. 0 o 2). Redondeo por moneda, solo al final. Cada documento guarda SNAPSHOT del **tipo de cambio y del código de moneda** con que se emitió; montos en USD + moneda local. Sin tres o más monedas simultáneas ni conversión entre monedas locales.
4. **Documentos inmutables:** corrección = anular + re-emitir; nunca UPDATE de montos. Toda emisión congela un snapshot; una corrección genera un documento nuevo, jamás muta el emitido.
5. **Estados = ejes paralelos** (columnas separadas), nunca un solo campo "estado". Cada dimensión del ciclo de vida de una entidad es su propia columna; combinarlas en un solo enum "estado" es un bug de diseño.
6. **UI:** todo en español, UNA sola interfaz — el rol (ej. Admin/Operador/Contador) habilita/deshabilita acciones. Textos centralizados (multi-idioma-ready).
7. **Auditoría:** todo **UPDATE** a tablas de negocio queda registrado vía trigger de auditoría con actor y diff (INSERT y DELETE no generan pista — la creación ya queda trazada por `creado_en`/`creado_por` de cada tabla); la tabla `auditoria` es append-only (INSERT permitido, UPDATE/DELETE prohibidos para todos los roles incluido admin); los comprobantes ya emitidos son inmutables; ningún `created_by`/`actor_id` viene del payload del cliente (siempre `auth.uid()` en servidor, con actor de sistema explícito si es un proceso sin sesión).
8. **Persistencia de formularios:** lo que el usuario digitó NUNCA se borra solo — ni por un error de validación, ni por un postback/re-render: solo el usuario borra sus datos (o el form se limpia tras un ÉXITO que lo descarta, ej. al cerrar el diálogo). Esto incluye los campos de **password**. Ojo con React 19: `<form action>` se resetea SOLO al completar la server action (éxito O error) — todo input de un form con server action debe ser controlado (o preservar su valor explícitamente) para cumplir esta regla. Ver los aprendizajes de `<form action>` + Radix Select / inputs nativos abajo.
9. **Suscripción de la plataforma a los tenants (módulo reusable):** cada tenant recibe UNA factura de suscripción por **ciclo de aniversario** (ancla `fecha_alta`), en **USD** (moneda base; sin moneda local ni tipo de cambio — es un cobro APARTE del que el tenant hace a sus propios clientes). Monto = `coalesce(tenants.precio_suscripcion_usd, planes.precio_mensual_usd, 0)`, **congelado** al generarse (regla #4: nunca UPDATE de `monto_usd`; cambiar el precio solo afecta la PRÓXIMA factura). Generación **lazy "de aquí en adelante"** (sin backfill). **Vence al inicio del ciclo**. Estados: `pendiente → reportado` (el tenant sube comprobante a un bucket privado) `→ pagado` (el super-admin lo confirma manualmente; `revertir` deshace). El **bloqueo por atraso es DECISIÓN MANUAL** del super-admin. Toda mutación pasa por RPC `SECURITY DEFINER` (la tabla no tiene RLS de INSERT/UPDATE/DELETE). Las columnas de plataforma de `tenants` (`estado`, `plan_id`, `precio_suscripcion_usd`) están protegidas por un guard column-level que rechaza cambios salvo super-admin/`service_role` — así un Admin del tenant no puede, por PATCH directo a PostgREST, auto-desbloquearse, auto-cambiarse de plan ni bajarse el precio. Ver contrato en `docs/arquitectura/contratos-transversales.md`.

## Convenciones
- **No mostrar código en las respuestas:** no se pegan bloques de código, diffs o snippets en las ventanas del chat mientras se trabaja. Explicar los cambios EN PALABRAS (qué se tocó, dónde y por qué); el código va al archivo, no a la respuesta. Aplica a todos los agentes y a cualquier tarea.
- **Priorizar paralelismo al arrancar un trabajo:** cuando una tarea admite dividirse en agentes o procesos independientes, lanzarlos EN PARALELO (varias llamadas de herramienta en un mismo mensaje, agentes concurrentes, subtareas sin dependencia entre sí) para ahorrar tiempo y tokens — pero NUNCA a costa de la calidad del entregable. Si hay dependencia real o paralelizar arriesga el resultado, se hace en serie.
- **Índice de código MCP `codebase-memory`:** para CUALQUIER tarea de exploración amplia, review, auditoría o "buscá/dónde está X / todos los lugares donde…", ARRANCAR por el índice (`search_code`/`query_graph`/`trace_path`) ANTES de barrer archivos con `Grep`/`Read` — estos quedan para confirmar detalles puntuales. Al iniciar, verificar `index_status`; si el HEAD avanzó respecto al `head_sha` del índice, refrescar con `index_repository` antes de confiar en él, y re-indexar tras commitear.
- Migraciones en `supabase/migrations/` (timestamped); nunca editar una aplicada.
- Toda entrada externa validada con Zod (mismo esquema cliente y servidor).
- Commits en español con prefijo de módulo: `motor: redondeo a media libra`.
- **Push sin preguntar ni confirmar:** cuando el trabajo termina en commit/push, push directo a `dev`, sin pedir confirmación. Usar `git push origin dev` **PLANO**. **NUNCA usar `git credential fill`** (invoca el diálogo GUI del Git Credential Manager de Windows y saltan popups). Se pinea la cuenta de una vez (`git config --global credential.https://github.com.username <usuario>`) para que el push plano autentique en silencio. Se commitea en bloques temáticos con tests en verde antes de pushear y se vigila CI/Vercel después.
- Server Components por defecto; `"use client"` solo con interactividad real.
- **Acciones de fila = 1 visible + menú "⋯":** en TODA tabla/lista, cada fila muestra COMO MÁXIMO una acción primaria visible (la más probable según el estado de la fila) y el RESTO va en un menú overflow "⋯" (`aria-label` "Más acciones"). Prohibido el "muro de botones" repetidos por fila. La primaria se elige por prioridad de estado; los diálogos se renderizan FUERA del `DropdownMenuItem`, controlados por el estado del island de acciones (props `open`/`onOpenChange`/`mostrarTrigger`). En E2E, la acción secundaria se alcanza abriendo el menú (`getByRole("button", { name: menuAcciones })` → `getByRole("menuitem", { name })`).
- **Listas responsive: tabla desktop → tarjetas mobile → detalle full-screen.** TODA lista/tabla debe ser responsive. En escritorio (≥640px, `sm`): tabla con columnas. En mobile (<640px): cada fila se colapsa en una TARJETA apilada (dato principal como título arriba-izquierda, valor de mayor peso arriba-derecha `tabular-nums`, datos secundarios atenuados debajo — nada se trunca ni se encima, sin scroll horizontal). Al tocar la tarjeta se abre el DETALLE del ítem a PANTALLA COMPLETA (overlay `max-sm:fixed inset-0 z-50`, header con flecha ← + título, campos y controles apilados en una columna, inputs/botones a ancho completo con tap ≥44px). El switch es 100% CSS (`hidden sm:block` / `sm:hidden`), sin `matchMedia`/`useMediaQuery` (ambos layouts montados; el CSS oculta uno). Reutilizar SIEMPRE los primitivos compartidos `TarjetaListaMobile` y `DetalleListaMobile` (`apps/web/components/listas/`) — NUNCA recrear el comportamiento ad-hoc. El detalle es un `<div>` plano, NO un Radix `Dialog`/`Sheet` (evita la fuga de `aria-hidden`). Ambos subtrees viven dentro del MISMO provider de selección → los checkboxes se sincronizan solos; el estado editable real vive en UNA sola instancia viva (el detalle), no dos. **Excepción aceptada:** si el DETALLE del ítem es una SUB-PÁGINA real con su propio fetch NO trivial, es válido que la tarjeta mobile NAVEGUE a esa ruta (`router.push`) en vez de abrir el overlay inline — replicar ese contenido inline forzaría un fetch por fila (N+1). En ese caso el desktop también navega a la misma ruta, la tarjeta conserva su islote de acciones directo, y la desviación se documenta en el componente.
- **Manejo de archivos: "Tolerante al recibir, específico al fallar":** aplica a TODO el manejo de archivos subidos (cualquier importador/ingesta). (a) ACEPTAR todas las variantes VÁLIDAS de un formato antes de rechazar — ej. `.xlsx` con `t="inlineStr"` sin `xl/sharedStrings.xml`, CSV con separador `,` o `;`, encoding UTF-8/Latin-1 con o sin BOM, encabezados que no están en la fila 1, hojas múltiples, filas vacías intercaladas, celdas combinadas/columnas ocultas, teléfonos/identificadores como texto con ceros a la izquierda. (b) DETECTAR el tipo real por CONTENIDO (magic bytes), nunca por la extensión. (c) Al FALLAR, el mensaje SIEMPRE indica causa probable + siguiente paso, con la plantilla **"No pudimos [acción]. [Causa probable]. [Qué hacer]."** — PROHIBIDO el genérico y la palabra "dañado" como cajón de sastre. Capa compartida: `packages/core/src/importacion/lector-archivo.ts` (`leerFilasDeArchivo`); mensajes centralizados en `lib/textos/`. Ver contrato §d.
- **Todo atajo que aplique un filtro se refleja en el panel de filtros:** cualquier banner, contador clickeable de una tabla, o link que navegue aplicando un filtro (`?revision=`, `?atencion=`, etc.) DEBE reflejar ese filtro en la sección de Filtros de la lista destino como **(a) chip removible** en la barra de "Filtros activos" **y (b) control MARCADO** dentro del panel (`Sheet`), para que el usuario vea que la lista está filtrada y pueda quitarlo desde ahí. Nunca dejar un filtro que "solo vive en la URL" sin representación visible. Si el valor es un meta-valor "umbrella" (disyunción de motivos), igual se ofrece como opción del control.

## Flujo estándar de implementación y QA

1. Al iniciar sesión: invocar al agente **project-manager** para saber dónde vamos y qué sigue.
2. `project-manager` define: objetivo; alcance; criterios de aceptación; agente líder; agentes consultados.
3. El agente líder implementa la funcionalidad — directamente si es una **tarea simple** (un archivo, un fix, un componente), o mediante el skill **bucle-agentico** si es una **feature compleja** (toca BD + lógica + UI, o varias piezas coordinadas): fases primero, mapeo de contexto real antes de las subtareas de cada fase. `backend-app` coordina la lógica de aplicación salvo que la tarea sea puramente BD o UI.
4. **Decisión estructural** (organización del monorepo, límites entre apps/paquetes compartidos, contratos entre agentes, topología de deploy): consultar a **arquitecto-app** antes de implementar — no es para features de negocio, es para "dónde vive esto" y "cómo se conecta con el resto".
5. El agente líder entrega a `qa-tests` (usar la plantilla de handoff más abajo):
   - resumen del cambio;
   - archivos modificados;
   - contratos afectados;
   - criterios de aceptación;
   - casos límite conocidos;
   - comandos para ejecutar la funcionalidad;
   - riesgos identificados.
6. `qa-tests`:
   - inspecciona el comportamiento real;
   - diseña el plan de pruebas;
   - crea o actualiza pruebas unitarias;
   - crea o actualiza pruebas de integración;
   - crea E2E cuando el flujo lo amerite;
   - ejecuta regresiones relevantes;
   - registra evidencia.
7. Si QA encuentra defectos:
   - no modifica directamente el comportamiento productivo;
   - devuelve el hallazgo al agente líder con reproducción, resultado esperado y evidencia;
   - vuelve a ejecutar las pruebas después de la corrección.
8. Cuando QA está en verde: **revisor** realiza la auditoría final de solo lectura.
9. `project-manager` cierra la tarea únicamente cuando: criterios de aceptación cumplidos; pruebas nuevas y regresiones en verde; revisión final aprobada; documentación (`docs/PROGRESO.md`) actualizada cuando corresponda.
10. Nada fuera del alcance del spec sin decisión explícita del dueño del producto (el project-manager lo vigila).

### Dimensionar el proceso al cambio: carril rápido vs. gate completo
El flujo de arriba (líder → `qa-tests` → `revisor`, con subagentes por dominio) es para **features complejas**. Aplicarlo a un cambio trivial es puro overhead: cada subagente recarga contexto, corre `tsc`/`vitest` y reporta. **Dimensionar el proceso al tamaño y riesgo del cambio, no aplicar el gate pesado por defecto.**

**Gate completo OBLIGATORIO (líder + `qa-tests` + `revisor`)** cuando el cambio toca CUALQUIERA de estos ejes de riesgo (las reglas duras):
- Dinero / moneda / tipo de cambio.
- **Multi-tenant / RLS**, resolución de tenant, o autorización por rol.
- **Migraciones** de BD, esquema, triggers, o Storage.
- **Documentos inmutables** / auditoría.
- Contratos transversales (`docs/arquitectura/contratos-transversales.md`) o cambios estructurales (→ `arquitecto-app`).

**Carril rápido (el orquestador o el líder edita inline y verifica directo, SIN relay de subagentes ni `revisor` aparte)** cuando el cambio NO toca ninguno de esos ejes y queda cubierto por tests: copy/textos, labels, `.optional()` de un schema de UI, estilos, un componente aislado, un fix de presentación. Verificación mínima del carril rápido: `tsc --noEmit` + `vitest` de lo afectado + (si cambia comportamiento observable de una pantalla/flujo) el E2E de ese flujo. Un solo agente puede hacer todo esto.

Regla de decisión: ante la duda sobre en qué eje cae, o si el cambio es reversible y barato, **carril rápido**; si toca una regla dura o es difícil de revertir, **gate completo**. No fanout de subagentes para diffs triviales.

### Handoff al agente `qa-tests`
Plantilla que el agente líder completa al entregar el cambio (paso 5 de arriba):

```
## Handoff al agente qa-tests

### Cambio implementado
Descripción breve del comportamiento nuevo o modificado.

### Archivos principales
- Ruta:
- Ruta:

### Criterios de aceptación
1.
2.
3.

### Casos límite
-
-

### Contratos afectados
- Inputs:
- Outputs:
- Errores esperados:
- Eventos o efectos secundarios:

### Reglas duras tocadas
- Multi-tenant / RLS:
- Dinero / moneda:
- Documentos inmutables:

### Datos de prueba sugeridos
-
-

### Verificación manual realizada
- Comando:
- Resultado:

### Riesgos conocidos
-
```

## Relación de los implementadores con las pruebas

Los agentes implementadores pueden:
- ejecutar suites existentes;
- corregir código productivo cuando QA detecta un defecto;
- añadir puntos de inyección o interfaces para mejorar testabilidad;
- explicar invariantes y resultados esperados;
- proporcionar fixtures representativos;
- sugerir casos límite.

Los agentes implementadores no deben, por defecto:
- declarar su propia implementación aprobada;
- decidir que no hacen falta pruebas;
- reducir assertions para hacer pasar una suite;
- modificar resultados esperados sin una decisión de producto;
- cerrar una tarea antes del visto bueno de `qa-tests`.

## Carril de QA extenuante (framework de pruebas — SEPARADO del desarrollo)

Carril independiente del flujo de implementación: no entrega features, entrega **EVIDENCIA** — casos de prueba ejecutados, bugs documentados y un reporte de campaña. Se activa SOLO cuando el dueño del producto lo pide (comando `/qa <alcance>`, o en palabras: "campaña de QA", "QA extenuante de X", "smoke pre-release"). Manual de operación completo: `docs/qa/PLAN-QA.md` (obligatorio leerlo al arrancar cualquier campaña).

**Regla de oro: el carril QA NO arregla código productivo.** Encuentra, reproduce (2 veces, con evidencia), documenta y prioriza. Los fixes entran por el carril de DESARROLLO normal (project-manager prioriza → agente líder arregla → `qa-tests` verifica con test de regresión) y el carril QA solo RE-VERIFICA el caso al cerrarse el bug. Los agentes del carril pueden escribir código de TEST (specs, fixtures, helpers de `e2e/`, `*.test.ts*`) — jamás `app/`, `lib/`, `components/` productivos ni migraciones, y jamás debilitar una aserción para poner algo en verde.

- **Agentes**: `qa-project-manager` (coordinador estratégico: decide alcance/tipo de cada campaña, lleva `docs/qa/ESTADO-QA.md`, recomienda el siguiente paso), `qa-analista` (líder técnico: plan de campaña, catálogo de casos, triage, reporte), `qa-explorador` (exploratorio con navegador real por charters/tours) y `qa-automatizador` (suites completas en local, automatización de P0, salud de la suite). `qa-tests` y `revisor` siguen siendo del carril de desarrollo. El orquestador coordina: PM (alcance) → analista (plan técnico) → explorador + automatizador EN PARALELO → analista (triage + reporte) → PM (actualiza estado, recomienda próximos pasos).
- **Artefactos** (todo en `docs/qa/`): `casos/<modulo>.md` (catálogo con IDs estables tipo `MOD-001` y trazabilidad requisito → caso → spec), `bugs/BUG-AAAAMMDD-NN-<slug>.md` (plantilla obligatoria) y `reportes/AAAA-MM-DD-<campaña>.md`. Un bug sin reproducción verificada NO se reporta.
- **Severidades**: **S0** = viola una regla dura de este archivo (dinero mal calculado, fuga entre tenants, documento emitido mutado, pérdida de lo digitado, registro protegido borrado) o bloquea el flujo principal sin workaround → se escala al dueño del producto DE INMEDIATO. **S1** = flujo principal roto con workaround o dato incorrecto no monetario. **S2** = secundario/responsive/a11y. **S3** = cosmético. Solo `qa-analista` fija la severidad final y solo `qa-project-manager` emite el Quality Gate de cierre (`RED`/`YELLOW`/`GREEN`) — detalle en `docs/qa/PLAN-QA.md`.
- **E2E LOCAL es el gate primario**: la suite corre en la máquina de desarrollo con tenants efímeros por worker (`apps/web/e2e/fixtures.ts`); comandos y precauciones en `docs/qa/PLAN-QA.md`.
- **Datos**: SIEMPRE contra el Supabase de DEV con tenants efímeros (`e2e-ef-*`) o tenants QA descartables. PROHIBIDO apuntar el carril QA a producción o al tenant real, y prohibido enviar correos reales (`RESEND_ENVIO=off`).
- **Operador humano + Trello**: el carril lo corre una PERSONA de QA (no el dueño del producto), con acceso de solo lectura al repo. Ella es el GATE entre hallazgo y registro: revisa cada bug y decide cuál se sube al board de Trello. Como no puede pushear, **la tarjeta de Trello es el registro oficial del bug** (lleva repro + evidencia adjunta) y el repo mantiene catálogo/manual/reportes; el estado NUNCA se duplica en los dos lados. Ningún agente sube tarjetas por su cuenta.

## Matriz de agentes

### Regla general
Cada tarea debe tener:
1. un agente líder de implementación;
2. agentes consultados cuando la tarea toca otros dominios;
3. `qa-tests` como responsable de crear y ejecutar las pruebas;
4. `revisor` como auditor final de solo lectura;
5. decisión del dueño del producto cuando haya cambios complejos, costosos o difíciles de revertir.

| Agente | Lidera | Consulta o escala cuando | No hace |
|---|---|---|---|
| **project-manager** | Inicio y cierre de sesión, estado del proyecto, alcance, prioridades, dependencias, orden de ejecución, selección del agente líder y coordinación de handoffs. | Consulta a `arquitecto-app` cuando una tarea requiere una decisión estructural. Consulta al especialista para estimaciones. Escala al dueño del producto cambios de alcance, prioridad, costo o roadmap. | No diseña arquitectura, no implementa código y no decide soluciones técnicas. |
| **arquitecto-app** | Estructura del monorepo, límites entre apps y paquetes, dirección de dependencias, contratos transversales, configuración multiambiente, auth/redirects, estrategia de email, SEO técnico, variables de entorno, dominios y topología de deploy. | Consulta al especialista dueño del dominio. Escala temprano al dueño del producto decisiones complejas antes de investigar o implementar en profundidad. | No implementa features de negocio, pantallas, BD/RLS ni decide alcance. |
| **arquitecto-db** | Esquema, migraciones, constraints, índices, RLS, funciones SQL, triggers, Storage y contratos de persistencia. | Consulta al agente de dominio para comprender invariantes. **Pareo automático: SIEMPRE que `arquitecto-db` participa en una tarea/migración/decisión, `arquitecto-app` participa también** — una migración casi siempre define un contrato transversal que el resto de la app consume. Escala cambios destructivos o difíciles de revertir. | No implementa pantallas, workflows completos ni reglas comerciales. |
| **backend-app** | Server actions, APIs internas, autorización por rol, workflows, resolución de tenant conforme a las convenciones aprobadas, documentos, consumo de plan, emails, webhooks y adaptadores de integraciones. | Consulta a `arquitecto-app` cuando una integración cambia arquitectura, ambientes, contratos o dependencias. Consulta a `arquitecto-db` para persistencia. | No redefine arquitectura transversal, esquema/RLS ni presentación. |
| **ui-app** | Pantallas, componentes, formularios, navegación, interacción, accesibilidad, responsive y estados visuales. Implementa metadata visible según la convención de `arquitecto-app`. | Consulta a `arquitecto-app` por Server/Client Components, routing, metadata o reutilización transversal. Consulta a `backend-app` por contratos. Entrega a `qa-tests` selectores y estados comprobables. | No implementa reglas de negocio, autorización real ni cálculos. |
| **qa-tests** | Toda la estrategia e implementación de pruebas: unitarias, integración, contratos, regresión y E2E con Playwright. Mantiene fixtures, mocks, datos de prueba y golden masters técnicos. Ejecuta las suites y determina si los criterios de aceptación están cubiertos. | Consulta al agente implementador para conocer comportamiento esperado y casos límite. Consulta a `arquitecto-app` si el sistema no es testeable por un problema estructural. Reporta defectos al agente líder y bloquea el cierre cuando faltan pruebas críticas o existen regresiones. | No cambia reglas de negocio para que las pruebas pasen, no corrige silenciosamente código productivo y no reemplaza al `revisor`. |
| **revisor** | Revisión final de solo lectura antes del merge. Audita tenants, seguridad, dinero, documentos, contratos, alcance, regresiones y decisiones aprobadas. Verifica que QA esté en verde y que la evidencia sea suficiente. | Devuelve hallazgos al agente líder. Señala problemas estructurales a `arquitecto-app` y problemas de persistencia a `arquitecto-db`. Escala al dueño del producto riesgos críticos o decisiones no autorizadas. | No implementa, no escribe pruebas, no refactoriza y no aprueba su propio código. |
| **qa-project-manager** *(carril QA)* | Coordinador estratégico del carril: decide alcance/tipo de cada campaña, lleva `docs/qa/ESTADO-QA.md` (cadencia, cobertura por módulo, riesgos), recomienda el siguiente paso al cerrar. | Entrega el brief de alcance a `qa-analista`. Escala al dueño del producto cuando el momento de una campaña pedida es claramente inoportuno. | No diseña casos ni charters, no ejecuta nada, no toca código ni Trello, no invoca a otros agentes. |
| **qa-analista** *(carril QA)* | Plan TÉCNICO de campaña dentro del alcance que da el PM, catálogo de casos (`docs/qa/casos/`), triage de bugs y reporte de campaña. | Consulta el spec de requisitos para el comportamiento esperado. Escala al dueño del producto todo S0 de inmediato y toda ambigüedad de producto que un caso revele. | No ejecuta pruebas, no toca código (ni de test) y no decide alcance/cadencia. |
| **qa-explorador** *(carril QA)* | Testing exploratorio con navegador real por charters/tours: datos límite, permisos por rol, responsive, interrupciones, multi-tenant, archivos hostiles. | Entrega cada hallazgo como bug con reproducción verificada 2× y evidencia, para triage de `qa-analista`. | No modifica nada fuera de `docs/qa/`, no arregla nada y no prueba contra producción. |
| **qa-automatizador** *(carril QA)* | Corridas locales completas de las suites (tsc + Vitest + Playwright con tenants efímeros), automatización de casos P0 del catálogo y salud de la suite E2E (flaky, legacy, tiempos). | Escala a `arquitecto-app` problemas estructurales de testeabilidad; entrega fallos clasificados (producto vs. suite) a `qa-analista`. | No toca código productivo (solo specs/fixtures/helpers de test) y no debilita aserciones para poner algo en verde. |

## Auto-blindaje (aprender de los errores)
Cada error que cueste más de unos minutos resolver sigue este protocolo — sin excepción:

1. **ARREGLAR** la causa raíz (no el síntoma).
2. **TESTEAR** que quedó resuelto (idealmente dejando un test de regresión).
3. **DOCUMENTAR** el aprendizaje en la capa correcta:

| El error aplica a... | Documentarlo en |
|---|---|
| Solo esta tarea/feature | Notas de la tarea en `docs/PROGRESO.md` |
| Un dominio (BD, cálculo, UI, tests) | El agente relevante en `.claude/agents/*.md` (sección "Aprendizajes") |
| TODO el proyecto | La sección **Aprendizajes** de este archivo |

**Formato fijo:**
```
### [AAAA-MM-DD]: [título corto]
- **Error**: qué falló exactamente
- **Fix**: cómo se arregló
- **Aplicar en**: dónde más aplica este conocimiento
```

Regla: el aprendizaje solo sirve si queda en un archivo que se carga en contexto. Por eso importa elegir bien la capa — lo crítico va aquí, no enterrado en notas.

## Aprendizajes (bitácora auto-blindaje)

Estos son los gotchas GENÉRICOS del stack (Next.js + React 19 + Supabase + Radix), heredados de la app madre y válidos para cualquier instancia de esta base. Las lecciones específicas de cada app se agregan debajo con el mismo formato.

### 2026-07-20 / 2026-08-03: en React 19, un `<form action>` dispara un `form.reset()` NATIVO al enviar — borra el valor de los Radix `<Select>` Y de los inputs/checkboxes/radios NATIVOS controlados (regla dura #8)
- **Error**: React 19 envuelve el submit de un `<form action>` como `requestFormReset(fiber); return action(formData)` → un `form.reset()` nativo **sincrónico** ANTES de invocar la action. (a) `@radix-ui/react-select` escucha el evento `"reset"` del `<form>` y hace `setValue(valorInicial)`, pisando la selección del usuario. (b) El mismo reset desmarca checkboxes/radios/inputs NATIVOS controlados SIN emitir `onChange`, así que React nunca re-sincroniza. Invisible a tsc/Vitest; se reproduce ejecutando el flujo.
- **Fix**: (a) wrapper de `Select` en `components/ui/select.tsx` con un listener de `"reset"` en **fase de captura** sobre `document` que ignora el `onValueChange` sintético del reset (flag módulo-level, apagado en `queueMicrotask`). (b) para controles nativos, un listener de `"reset"` en captura que llama `preventDefault()` **scoped al `<form>` propio** (`evento.target === formRef.current`). El valor real ya viajó en el `FormData` antes del reset.
- **Aplicar en**: cualquier control (Radix o nativo) dentro de un `<form action>` de React 19. Si agregás uno nuevo, aplicá el patrón del wrapper compartido o el guard scoped. Tests que montan el sub-componente aislado NO ven el bug — hay que montar el WRAPPER con el `<form action>` real.

### 2026-08-11: un import de VALOR desde un módulo server-only en un componente `"use client"` rompe `next dev`/`next build` con tsc y Vitest EN VERDE
- **Error**: un componente `"use client"` importaba el VALOR de un módulo cuya cadena de imports llega a `next/headers`. `tsc --noEmit` limpio y Vitest en verde (ninguno modela el límite server/client de RSC), pero el dev server quedó en Build Error en TODAS las rutas. Los `import type` son inofensivos (se borran al compilar); solo el import de valor arrastra el módulo al bundle del navegador.
- **Fix**: módulo hermano PURO `lib/<dominio>/tipos.ts` (tipos + constantes + helpers puros, CERO imports de Next/Supabase); `datos.ts` re-exporta, los componentes cliente importan del puro.
- **Aplicar en**: toda capa `lib/<dominio>/datos.ts` que exporte constantes/tipos que la UI cliente necesita nace con su `tipos.ts` hermano puro. tsc/Vitest NO ven los límites de RSC en ninguna dirección — lo cubren `next dev` (cargando la ruta) o `next build`.

### 2026-08-01: un `export const` en un archivo `"use server"` pasa tsc/ESLint/dev pero ROMPE `next build`
- **Error**: `export const X = …` en un archivo que empieza con `"use server"`. Next.js prohíbe exportar cualquier cosa que no sea una función `async` desde un archivo `"use server"`, pero `tsc --noEmit`, ESLint y el dev server NO lo detectan. Solo `next build` (el compilador RSC de producción) lo marca. El CI corre solo Vitest → el fallo solo se ve en el deploy de Vercel.
- **Fix**: convertir en `const` local (sin `export`). Constantes/tipos/helpers compartidos con tests van en un módulo hermano SIN la directiva.
- **Aplicar en**: al tocar cualquier archivo `"use server"`, NO agregar `export const`/`export interface`/`export function` sync sueltos — SOLO funciones `async`. Tras pushear cambios de `apps/web`, verificar el status de Vercel del commit.

### 2026-07-17: `next build` lintea los `.test.tsx` — un patrón legítimo de test rompe el build de producción en silencio
- **Error**: la fase de lint de `next build` (`@next/next/*` como ERROR) marcaba archivos de TEST que usan patrones penalizados en producción (mock de `next/script` con un `<script>` plano). El build de Vercel fallaba varios commits seguidos sirviendo el último build EXITOSO (código viejo), mientras Vitest + tsc pasaban.
- **Fix**: `apps/web/.eslintrc.json` → `"ignorePatterns": ["**/*.test.ts", "**/*.test.tsx", "e2e/**"]`. Los tests ya se validan por tsc + Vitest; no deben pasar por el lint de páginas de Next.
- **Aplicar en**: tras una tanda grande de features de `apps/web`, verificar el estado del deploy de Vercel — un `failure` significa que producción sirve código viejo aunque `dev` tenga lo nuevo. Vitest en verde + tsc limpio NO garantizan que `next build` pase.

### 2026-07-16: correr `next build` con el dev server levantado corrompe `.next`
- **Error**: `next dev` y `next build` comparten la misma carpeta `.next/`. Correr el build con el dev server corriendo pisa los artefactos en uso → submits que fallan con `Server Action not found`, `__webpack_modules__[moduleId] is not a function`, 500 de webpack en páginas que compilan bien.
- **Fix**: parar el dev server, borrar `apps/web/.next` y volver a levantarlo. NO correr el build mientras el dev server está arriba. Si hay que verificar el build en dev, usar un `distDir` temporal por env var y revertirlo.
- **Aplicar en**: al diagnosticar un dev server que "de repente" da errores raros de webpack/actions, la caché compartida es la primera sospecha, no el código recién editado.

### 2026-07-15: prohibido `git stash`/`git reset --hard`/`git checkout -- .` en el working tree COMPARTIDO
- **Error**: un agente usó `git stash` + `git stash drop` para diagnosticar un build y descartó en silencio los cambios sin commitear de OTRAS tareas en curso. Se recuperaron por suerte (el commit del stash seguía vivo como objeto huérfano).
- **Fix**: restauración desde el commit huérfano (`git fsck --unreachable --no-reflogs | grep commit` → `git checkout <sha> -- <archivos>`).
- **Aplicar en**: REGLA para todos los agentes — prohibido `git stash`, `git reset --hard`, `git checkout -- .` o cualquier operación que descarte/mueva cambios del árbol que no sean del propio diff. El working tree es COMPARTIDO y casi siempre tiene trabajo sin commitear de otras sesiones. Si un build falla raro, sospechar de caché (`.next`), nunca "limpiar" con git.

### 2026-07-06: un `require()` en un `*.config.ts` crashea el dev server con `require is not defined`
- **Error**: `plugins: [require("tailwindcss-animate")]` en `tailwind.config.ts`. Next carga el config `.ts` como ESM, donde `require` no existe.
- **Fix**: import ESM — `import tailwindcssAnimate from "tailwindcss-animate"` + `plugins: [tailwindcssAnimate]`.
- **Aplicar en**: cualquier `*.config.ts` del proyecto (postcss, next, tailwind) — nunca `require()`, siempre `import`.

### 2026-07-28: un `select` de Supabase SIN `.range()`/`.limit()` topa SILENCIOSAMENTE en 1000 filas (default de PostgREST)
- **Error**: cualquier `.select(...)` que luego itere/compare TODAS las filas en memoria (dedups, agregados manuales) devuelve como MÁXIMO 1000 filas por request. Sin `ORDER BY` esas 1000 son un subconjunto ARBITRARIO — el pre-check "traé todo y comparo en JS" se salta cualquier valor fuera de ese subconjunto. "Casi siempre anda" en dev (tenants chicos) y falla en prod (tenants grandes).
- **Fix**: (a) si necesitás todo el conjunto: **paginar** con `.order("id").range(desde, desde+999)` en bucle hasta una página con <1000 filas. (b) si solo querés saber si existe UNA coincidencia: query ACOTADA que filtre en la BD (`.limit(1)`), no traer la tabla entera.
- **Aplicar en**: revisar todo pre-check de unicidad y todo `.select` sin `.limit()` que compare en memoria. Los tests con mocks NO lo atrapan.

### 2026-07-30: DOS migraciones con el MISMO timestamp prefix → la tooling aplica una y DESCARTA la otra en silencio
- **Error**: dos archivos `AAAAMMDDHHMMSS_*.sql` con el mismo prefix. La tooling aplicó uno (re-timestamped) y descartó el otro sin avisar (ni error ni log) — nunca entró a `supabase_migrations.schema_migrations`. Una vista quedó sin su columna nueva y toda una pantalla mostró 0 (la query caía al `catch` → default en 0).
- **Fix**: re-emitir la migración perdida con un timestamp fresco y ÚNICO, posterior a todo lo aplicado.
- **Aplicar en**: NUNCA reusar un version prefix ya presente en `supabase/migrations/`; verificar con un glob que no colisione. Cuando un CONTEO muestra 0 pero la lista subyacente muestra filas, sospechar de que la query del agregado (vista/RPC) está FALLANDO y cayendo a un default, no de la lógica de conteo.

### 2026-08-04: anidar un `MultiSelect` (Radix DropdownMenu) dentro de un `Sheet`/Dialog fuga `aria-hidden` al cerrar ambos con doble Escape
- **Error**: Sheet abierto → MultiSelect abierto → Escape (cierra dropdown) → Escape (cierra Sheet) dejaba un `<div aria-hidden="true">` ancestro pegado permanentemente: el contenido de fondo desaparece del árbol de accesibilidad. Son dos bugs sumados: DropdownMenu es `modal` por defecto (refcounts de `aria-hidden` cruzados) + la carrera de `Presence` de Radix cuando dos capas cierran casi simultáneamente deja el Dialog sin desmontar.
- **Fix**: en `components/ui/multi-select.tsx` → `modal={false}` en el DropdownMenu (solo el Dialog del Sheet administra el `aria-hidden`) + `data-[state=closed]:!animate-none`; en `components/ui/sheet.tsx` → `data-[state=closed]:!animate-none` en overlay y contenido. Se desactiva SOLO la animación de salida.
- **Aplicar en**: al anidar cualquier par de primitivos Radix que ambos apliquen `aria-hidden`/scroll-lock (DropdownMenu/Popover/Select DENTRO de Dialog/Sheet), poné el layer INTERNO en `modal={false}`. Verificarlo requiere ejercer el peor caso (0ms entre Escapes) y chequear `[aria-hidden="true"]` residual.

### 2026-08-05: las listas mobile cargaban lento — cada fila montaba EAGER ~11 raíces Radix Dialog (× ambos subtrees desktop+mobile)
- **Error**: el patrón "1 acción + menú ⋯" renderizaba TODAS sus raíces Radix `Dialog` de forma EAGER en cada fila aunque estén cerradas. Con las listas responsive cada fila monta DOS subtrees (tabla desktop + tarjeta mobile, AMBOS hidratados — el switch es solo CSS). ~220 providers Radix hidratando de golpe. Un Dialog cerrado no emite nada al DOM, pero cuesta hidratación (fiber/hooks), invisible salvo en un trace de scripting con CPU throttling.
- **Fix**: hook compartido `useMontajeDiferido` (`components/listas/`): `montado` arranca en `false`, `activar()` lo pone en `true` permanente en el mismo handler que abre un diálogo; los diálogos se envuelven en `{montado && (…)}`. De ~220 raíces a 0 en la hidratación inicial.
- **Aplicar en**: los diálogos/popovers controlados por fila se montan DIFERIDO, nunca eager. Al diagnosticar "una lista carga lento", contá las consultas reales (¿`.range()`?) Y las raíces Radix que cada fila monta × filas × subtrees del switch responsive.

### 2026-08-18: un proyecto Supabase NUEVO "aprovisionado" solo con `db push` queda sin `search_path` de extensiones y sin GRANTs a los roles de PostgREST
- **Error**: aplicar las migraciones a un proyecto Supabase nuevo casi funciona, pero dos cosas que el Dashboard configura al crear un proyecto NO se replican por migración pura: (1) `pgcrypto`/`pg_trgm` quedan en el schema `extensions` pero el `search_path` por defecto NO lo incluye → funciones no calificadas (`gen_random_bytes`) revientan; (2) los roles `anon`/`authenticated`/`service_role` NO tienen GRANT sobre las tablas de `public` → `permission denied for table X` (que se confunde con RLS, pero RLS devuelve 0 filas, nunca error de permiso). El segundo se ve solo con los LOGS reales del hosting cuando un usuario real lee una tabla.
- **Fix**: `ALTER DATABASE postgres SET search_path TO public, extensions;` + `GRANT ALL ON ALL TABLES/SEQUENCES/ROUTINES IN SCHEMA public TO anon, authenticated, service_role;` + el `ALTER DEFAULT PRIVILEGES` equivalente + `NOTIFY pgrst, 'reload schema';`. Idempotentes; se corren una sola vez contra el proyecto nuevo, no como migración del repo. Detalle del setup de Auth/proyecto nuevo en `docs/CONFIG_SUPABASE_AUTH.md`.
- **Aplicar en**: la próxima vez que se cree un proyecto Supabase desde cero por CLI/API (otro ambiente, fork, DR). Ante "pantalla vacía sin datos" en una base recién migrada, sospechar de GRANT/search_path antes que de RLS, y verificar con los logs del hosting ANTES de re-revisar políticas.

### 2026-08-24: hacer una columna nullable rompe EN SILENCIO cualquier guard optimista que la compare con `=` (`NULL = x` es NULL, nunca TRUE)
- **Error**: una columna que era NOT NULL pasó a nullable. Un guard de drift optimista comparaba `p.col = e.esperado` con `=` estándar, y el cliente coaccionaba `null → 0` al armar el esperado. Para una fila con `NULL` real vs. esperado `0`, `NULL = 0` es `NULL` (nunca TRUE) → la fila quedaba fuera del CTE de "lo que no cambió" → la RPC lanzaba siempre "selección desactualizada". tsc y Vitest con mocks en verde; se cazó ejecutando el flujo contra datos reales (E2E).
- **Fix**: predicado a `IS NOT DISTINCT FROM` (trata `NULL IS NOT DISTINCT FROM NULL` como TRUE, idéntico a `=` para no-null) + mandar `null` REAL desde el cliente (no coaccionar a `0`). Ambas capas son necesarias.
- **Aplicar en**: cada vez que una columna NOT NULL pasa a nullable, auditar TODA comparación `=`/`<>`/`IN`/join/CTE que la toque en guards, dedups y `WHERE`. Un guard optimista que excluye de más se manifiesta como "selección desactualizada". Vale un E2E del flujo por cada columna que se vuelve nullable.

### 2026-07-16: `CREATE POLICY on storage.objects` falla en Supabase hosted con "must be owner of relation objects" — el diseño correcto es bucket-only + escritura server-side con service-role
- **Error**: una migración con políticas RLS de INSERT/SELECT sobre `storage.objects` falla al aplicarse (`42501: must be owner of relation objects`): esa tabla es propiedad de `supabase_storage_admin` y el rol `postgres` que corre migraciones no tiene membresía. Es estructural del proyecto hosted, no un typo.
- **Fix**: la migración queda BUCKET-ONLY (solo el upsert de la fila en `storage.buckets`). CERO políticas sobre `storage.objects` = deny-by-default REAL. La única vía de escritura es una server action del backend con el cliente **service-role** (bypassa RLS de Storage por diseño, nunca expuesto al cliente), que valida el permiso y arma el path `<tenant_id>/...` desde el tenant resuelto en el contexto del request. La lectura pública sale del flag `public = true` del bucket.
- **Aplicar en**: cualquier bucket de Storage nuevo — diseño por defecto bucket-only + escritura exclusivamente vía server action con service-role. Si se necesitara escritura DIRECTA de clientes, las políticas de `storage.objects` se crean por Dashboard/Management API, nunca por una migración de este repo.
