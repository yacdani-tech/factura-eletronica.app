# Arranque del QA — Plataforma

> Guía de instalación y operación para la persona que corre el **carril de QA extenuante**. Si ya estás instalada, lo que te importa día a día es la sección 6. El manual del carril (por qué se hace cada cosa) es `docs/qa/PLAN-QA.md`.

## 1. Tu rol en una frase

Corrés campañas de QA sobre la plataforma, revisás los bugs que los agentes encuentran y decidís cuáles se registran en el board de Trello. **No arreglás código** — eso lo hace el equipo de desarrollo por su propio carril. Vos producís evidencia y decidís qué entra al board.

Sos el filtro humano: un agente puede reportar algo que en realidad es comportamiento esperado, o duplicar un bug conocido. Nada llega a Trello sin que vos lo apruebes.

## 2. Lo que necesitás

### Cuentas y accesos (los gestiona el dueño del producto, menos la de Claude)

| Acceso | Para qué | Quién lo da |
|---|---|---|
| GitHub, permiso **Read** sobre el repo | Clonar y actualizar el código | El dueño del producto te invita |
| Suscripción a **Claude** | Correr Claude Code y los agentes | Tu propia cuenta |
| Miembro del **board de Trello** | Registrar los bugs | El dueño del producto te agrega |
| `apps/web/.env.local` | Credenciales de la base de datos de desarrollo | El dueño del producto te lo pasa por canal privado |

### Software a instalar

| Programa | Versión | De dónde |
|---|---|---|
| **Node.js** | 22.13 o superior | nodejs.org (elegí la LTS) |
| **Git** | Cualquiera reciente | git-scm.com |
| **Claude Code** | Última | Instalador oficial de Anthropic |
| **Visual Studio Code** *(opcional)* | Última | code.visualstudio.com — para leer archivos y screenshots cómodo |

El navegador de pruebas (Chromium) **no se instala a mano**: lo baja Playwright en el paso 5 de la instalación. Contá con unos 3 GB libres entre dependencias y navegador.

Verificá que Node quedó bien antes de seguir:

```bash
node -v
```

Tiene que decir v22.13 o más. Si decís que sí y más adelante algo falla raro, este es el primer sospechoso.

## 3. Acceso al repositorio (solo lectura)

Necesitás **clonar** el repo, no escribir en él. El dueño del producto te dará acceso de una de estas dos formas:

- **Colaborador con permiso "Read"** (lo habitual): recibís una invitación a tu cuenta de GitHub. Podés clonar y actualizar (`git pull`), no podés subir cambios. Clonás normal con tu cuenta.
- **Deploy key de solo lectura**: si no vas a tener cuenta en el repo, el dueño del producto genera una clave SSH válida únicamente para este repositorio y te la instala en la máquina. Clonás por SSH.

**Consecuencia importante del acceso de solo lectura**: los archivos que los agentes crean o modifican dentro del repo (bugs, evidencia, actualizaciones del catálogo, el estado del carril) viven **solo en tu copia local** — no podés subirlos. Por eso el registro oficial de un bug es **la tarjeta de Trello**, que se crea con toda la información adentro (pasos, esperado, actual) y los screenshots adjuntos: esa sí sale de tu máquina, porque se sube por su propia API, no por git.

Lo que **no** sale solo de tu máquina — y hay que mandárselo al dueño del producto a mano para que no se pierda entre campaña y campaña — son tres archivos del repo:
- El reporte de la campaña (`docs/qa/reportes/…`).
- El catálogo de casos actualizado (`docs/qa/casos/…`, campo "Última ejecución").
- El estado del carril (`docs/qa/ESTADO-QA.md`).

Al cerrar cada campaña, mandáselos por el canal que usen — el dueño del producto los sube al repo compartido. Si en algún momento `qa-automatizador` escribe un test nuevo dentro de `apps/web/e2e/`, avisá también: esa automatización nueva tampoco sale sola de tu máquina.

### Qué viene en el clon y qué no

Al clonar ya tenés **todo lo que tu Claude Code necesita para trabajar**, sin copiar nada a mano:

| Ya viene en el clon | Para qué sirve |
|---|---|
| `CLAUDE.md` | Las reglas del proyecto — tu Claude las lee solo al abrir la carpeta |
| `.claude/agents/qa-*.md` | Los **cuatro** agentes del carril: `qa-project-manager` (decide qué probar y cuándo), `qa-analista` (diseña el plan técnico), `qa-explorador` (navegador real) y `qa-automatizador` (suites) |
| `.claude/commands/qa.md` | El comando `/qa` |
| `docs/qa/` | Manual, catálogo de casos, estado del carril y plantillas |
| `scripts/qa/trello.mjs` | El puente al board |

Lo que **no** viene y hay que conseguir aparte:

| Falta | Cómo se resuelve |
|---|---|
| `apps/web/.env.local` | Te lo pasa el dueño del producto por un canal privado (sección 4) |
| `.env.local` en la raíz (una sola línea) | Lo creás vos — apaga el revisor de IA (paso 5 de la instalación) |
| `.mcp.json` | Lo copiás del ejemplo que sí viene: `docs/qa/mcp-qa.ejemplo.json` (paso 6 de la instalación) |
| `.env.qa` | Lo creás vos con tus credenciales de Trello (sección 7) |
| Dependencias y navegador | Se instalan con los comandos de la sección 5 |

No necesitás ningún archivo de configuración personal del dueño del producto ni su historial de trabajo: todo el conocimiento del carril está en los archivos versionados de arriba. Si algo te falta para operar, es un hueco de esta guía — avisá para corregirla.

## 4. Variables de entorno de la app

Pedile al dueño del producto un archivo `.env.local` **acotado para QA**, que va en `apps/web/`. Solo necesita:

- La URL y las llaves de la base de datos de **desarrollo** (nunca producción). Incluye la llave de servicio, que es la que crea y borra los tenants temporales de cada corrida.
- Los interruptores de seguridad del carril, que deben quedar **apagados**: envío de correo, límite de registro público, y los fallbacks de IA. Con esto ninguna prueba manda un correo real ni gasta llamadas de IA.

No hace falta que tengas llaves de servicios de pago ni credenciales de producción. Si algún archivo que te pasan las trae, avisá y pedí uno recortado.

## 5. Instalación (una sola vez)

**Paso 1 — Clonar.** Después de aceptar la invitación de GitHub, cloná el repo (el dueño del producto te pasa la URL exacta):

```bash
git clone <URL-del-repo>
```

**Paso 2 — Instalar dependencias**, desde la raíz de la carpeta que se creó:

```bash
npm ci
```

**Paso 3 — Bajar el navegador de pruebas.** Este comando se corre parado en `apps/web`:

```bash
npx playwright install --with-deps chromium
```

**Paso 4 — Poner las credenciales de la app.** Guardá el archivo que te pasó el dueño del producto como `apps/web/.env.local`. No lo compartas ni lo subas a ningún lado; está excluido del repo a propósito.

**Paso 5 — Apagar el revisor de código con IA.** El repo trae un gancho que, al terminar cada respuesta, le manda el diff a un modelo externo para una segunda opinión — es una herramienta del equipo de desarrollo, vos no la necesitás. Creá un archivo `.env.local` en la **raíz** del repo (al lado de `package.json`, distinto del de `apps/web/`) con esta única línea:

```
REVISION_IA=off
```

Con esto el gancho no se ejecuta nunca en tu máquina, sin depender de que no tengas por accidente una llave configurada. Este archivo también está excluido del repo — es solo tuyo.

**Paso 6 — Configurar el navegador de los agentes.** En `docs/qa/` hay un archivo llamado `mcp-qa.ejemplo.json`. Copialo a la raíz del repo con el nombre `.mcp.json`. Eso le da a tu Claude el navegador con el que explora la app.

> No pidas ni uses el `.mcp.json` del equipo de desarrollo: el de ellos incluye una conexión de administración a la base de **producción**, que este carril tiene prohibido tocar. El archivo de ejemplo trae solo lo que vos necesitás.

**Paso 7 — Verificar que todo quedó bien.** Desde la raíz:

```bash
npm run test:web
```

Si termina en verde, estás lista. Si falla, mandale la salida al dueño del producto antes de seguir — puede ser algo del repo, no de tu instalación.

**Paso 8 (opcional) — Una corrida de humo del navegador**, para confirmar que Playwright funciona de punta a punta. Desde `apps/web`:

```bash
npm run test:e2e -- login.spec.ts
```

La primera vez tarda varios minutos: tiene que compilar la aplicación entera antes de empezar.

## 6. Tu día a día

### Correr una campaña

En Claude Code, dentro de la carpeta del repo:

```
/qa flujo de negocio principal
```

Podés acotar el alcance a lo que quieras: `/qa auth`, `/qa multi-tenant`, `/qa smoke pre-release`, `/qa matriz de permisos`, o algo bien puntual: `/qa dirigida: verificar tal requisito`. Si no ponés nada, `qa-project-manager` te va a proponer un alcance según lo que se tocó recientemente y lo que lleva más tiempo sin probarse.

La campaña hace esto sola: decide el alcance, diseña el plan, ejerce la app con un navegador real, corre las suites automatizadas, y te deja los bugs en `docs/qa/bugs/` más un reporte en `docs/qa/reportes/` con un veredicto (`GREEN`/`YELLOW`/`RED`) al final.

### Revisar lo que encontró

Leé cada archivo de bug. Para cada uno decidí:

- **Va al board** — el bug es real y vale registrarlo.
- **No va** — es comportamiento esperado, está duplicado, o no te convence la reproducción. Pedile a Claude que lo marque como rechazado con el motivo.
- **Falta algo** — pedile que lo reproduzca de nuevo, saque mejor evidencia o pruebe una variante.

Cada bug trae, además de una severidad ya sugerida, el **impacto observado** (hechos: ¿fuga entre tenants? ¿afecta dinero? ¿bloquea sin salida?) y la **frecuencia** con la que reprodujo. Vos podés corregir la severidad si no estás de acuerdo — tenés la última palabra.

### Severidad vs. Prioridad — no son lo mismo, y las vas a llenar seguido

Cada bug tiene DOS campos que suenan parecido pero responden preguntas distintas. Acostumbrate a separarlos:

- **Severidad** contesta: *¿cuánto daño le hace esto al sistema, hoy, tal cual está?* Es casi un hecho técnico — no depende de si "hay tiempo" para arreglarlo. Se mide en S0 (rompe una regla de negocio importante — dinero mal calculado, datos de un tenant que se filtran al de otro, un documento que cambia después de emitido — o bloquea el flujo principal sin ninguna salida), S1 (algo principal se rompe pero hay una forma de esquivarlo), S2 (algo secundario, como el diseño en el celular o un mensaje de error poco claro) o S3 (un detalle visual, nada más).
- **Prioridad** contesta: *¿qué tan pronto conviene agendarlo?* Esa sí es una decisión de negocio, y normalmente la termina afinando el dueño del producto. Se mide en Alto, Medio o Bajo.

**La regla práctica**: la Prioridad casi siempre sale sola de la Severidad — S0 y S1 son Alto, S2 es Medio, S3 es Bajo. El sistema ya lo hace por default. Vos solo tenés que pensarlo dos veces cuando algo del contexto lo amerite: por ejemplo, un detalle cosmético (S3, Bajo por default) puede merecer Alto si es justo la pantalla que se le muestra a un usuario nuevo mañana. Y al revés: un bug S1 en una función que casi nadie usa puede quedar en Medio aunque el default diga Alto. Si cambiás el default, dejá anotado el motivo en la tarjeta — nunca lo cambies "porque sí".

Un caso especial: una tarjeta marcada como **Mejora** (no Bug) nunca lleva Severidad — no está rompiendo nada, es una sugerencia. Pero SÍ lleva Prioridad, porque igual compite por lugar en la fila de trabajo.

El detalle completo con más ejemplos está en `docs/qa/PLAN-QA.md` §5.1, por si alguna vez dudás de un caso concreto.

### Subir un bug a Trello

Antes de subir, podés ver exactamente cómo va a quedar la tarjeta:

```bash
node scripts/qa/trello.mjs previsualizar docs/qa/bugs/BUG-20260101-01-ejemplo.md
```

Y para crearla:

```bash
node scripts/qa/trello.mjs crear docs/qa/bugs/BUG-20260101-01-ejemplo.md
```

O simplemente pedíselo a Claude en palabras ("subí el BUG-20260101-01 al board") y él corre el comando por vos.

Qué hace al subir: crea la tarjeta arriba de la columna **Reportado**, con título `[S1] descripción` (el número `#N` de cada tarjeta lo agrega solo el Power-Up "Card Numbers" instalado en el board — no hace falta que nadie lo escriba), **adjunta los screenshots** de la evidencia, y completa los **campos personalizados** de la tarjeta (Severidad, Tipo, Prioridad, Entorno, Navegador, Ancho, Rol del usuario, Reproducible, ID de requisito) — todo vive en estos campos, visibles en el frente de la tarjeta sin necesidad de abrirla. Después escribe el link de la tarjeta dentro del archivo del bug, así nunca subís dos veces lo mismo (si intentás, te avisa).

La tarjeta sale con el checklist **"Antes de mover a Confirmado"** ya cargado. El puente marca solo lo que ya está garantizado (que se reprodujo dos veces, que hay evidencia adjunta, que los campos quedaron completos) — pero **"Regla del requerimiento releída y citada" queda SIEMPRE sin marcar**, porque esa la tenés que confirmar vos: releé la sección "Regla" de la tarjeta contra el spec real antes de mover la tarjeta a `Confirmado`.

Si al subir ves en la consola un aviso de "campos FALTAN", es porque el bug no traía ese dato o el valor no coincidía con ninguna opción del board — completalo a mano en la tarjeta antes de confirmarla.

### Cuando aparece un S0

**S0 significa que se violó una regla fundamental del sistema**: dinero mal calculado, un tenant viendo datos de otro, un documento ya emitido que cambió, o datos que el usuario escribió y se perdieron. No esperes al final de la campaña: avisale al dueño del producto en el momento, y subí la tarjeta enseguida. Si el hallazgo es de este tipo (sobre todo una fuga entre tenants), no hace falta reproducirlo dos veces como con cualquier bug — capturá lo mínimo y escalá ya.

## 7. Configurar Trello (una sola vez)

1. Entrá a `https://trello.com/power-ups/admin`, creá un Power-Up cualquiera (o usá uno existente) y generá una **API key**.
2. Desde esa misma pantalla generá un **token** con permiso de escritura para tu cuenta.
3. Creá el archivo `.env.qa` en la raíz del repo (ya está en el `.gitignore`, no se sube nunca) con tres líneas: `TRELLO_API_KEY`, `TRELLO_TOKEN` y `TRELLO_LISTA_BUGS`.
4. Para saber qué poner en `TRELLO_LISTA_BUGS`, corré estos dos comandos y copiá el id de la columna donde querés que entren los bugs:

```bash
node scripts/qa/trello.mjs boards
```

```bash
node scripts/qa/trello.mjs listas <idDelBoard>
```

5. Verificá que quedó bien:

```bash
node scripts/qa/trello.mjs probar
```

6. Confirmá que el board ya tiene todo lo que el puente espera (columnas, campos personalizados):

```bash
node scripts/qa/trello.mjs revisar <idDelBoard>
```

Si el board de referencia (`Plataforma QA`) ya está armado, este comando va a decir "OK" en todo. Si alguna vez trabajás sobre un board nuevo, avisá al dueño del producto — los campos personalizados no se generan solos, son una decisión suya.

## 8. Reglas que no podés romper

1. **Nunca pruebes contra producción.** Solo la base de datos de desarrollo. Si una pantalla te pide credenciales que no tenés, no busques otras: avisá.
2. **Nunca arregles código de la aplicación**, ni aunque el fix sea obvio. Los agentes tienen prohibido tocarlo y vos también. Reportalo y seguí.
3. **Un bug se reporta reproducido dos veces** — salvo que huela a fuga entre tenants o algo igual de grave: ahí se escala de inmediato con evidencia mínima, sin insistir en reproducirlo.
4. **Nada de correos reales.** Los interruptores del punto 4 quedan apagados siempre.
5. **Una corrida de pruebas a la vez** en tu máquina.
6. Si cortás una corrida a la mitad, limpiá los tenants que quedaron sueltos:

```bash
npm run test:e2e:gc
```

## 9. Si algo se rompe

| Síntoma | Qué hacer |
|---|---|
| Las pruebas no arrancan / puerto ocupado | Cerrá otras corridas y cualquier servidor de desarrollo abierto, y volvé a intentar |
| Muchas pruebas fallan de golpe | Correr el GC (punto 8.6) y reintentar; si sigue, es del repo — avisá al dueño del producto con la salida |
| Trello devuelve error de permisos | Tu token venció o no tiene escritura: regeneralo (punto 7) |
| Un bug "ya tiene tarjeta" pero no la ves | Buscá el link dentro del archivo del bug; puede estar en otra columna del board |
| No sabés si algo es bug o es así a propósito | No lo subas: preguntá. La fuente de verdad del comportamiento esperado es el documento de requisitos |
