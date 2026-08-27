# Contratos transversales — Plataforma (base)

Este documento junta, en un solo lugar, los contratos que cruzan más de un
módulo/capa del monorepo. No repite el detalle línea a línea de cada
comentario del código (siguen siendo la referencia autoritativa de
implementación) — explica el contrato en sí, por qué existe, y qué debe
respetar cualquier código nuevo que lo toque. **Mantenido por `arquitecto-app`;
cualquier cambio a uno de estos contratos es una decisión estructural** (ver
CLAUDE.md → matriz de agentes → `arquitecto-app`).

Estos son los contratos GENÉRICOS de la plataforma base. Los contratos
específicos de cada app (motor de cálculo del dominio, documentos de negocio,
integraciones propias, etc.) se agregan aquí al instanciar, re-letrando las
secciones de forma limpia y en orden.

## a. `PATHNAME_HEADER` — middleware ↔ Server Components

**Archivos:** `apps/web/lib/servidor/pathname-header.ts` (la constante),
`apps/web/middleware.ts` (quien lo escribe), `apps/web/app/(app)/layout.tsx`
(quien lo lee).

**El problema que resuelve:** un Server Component (ej. un layout) no tiene
una forma soportada de leer el `pathname` de la request actual directamente
— Next.js no lo expone vía `headers()`/`cookies()` nativamente en un layout
de App Router. El patrón del proyecto es que el middleware, que sí ve la
request completa, escriba el dato en un header interno propio, y cualquier
Server Component lo lea después vía `(await headers()).get(PATHNAME_HEADER)`.

**Mismo patrón que `TENANT_SUBDOMAIN_HEADER`** (`lib/tenant/subdominio.ts`):
NO es un mecanismo ad-hoc, es la convención establecida para "dato resuelto en
el middleware, consumido en profundidad en Server Components". Cualquier futuro
dato que un middleware necesite exponer a un layout/página server-side debe
seguir esta misma forma (constante de header dedicada + comentario en el
middleware documentando quién la consume) antes de inventar un mecanismo nuevo.

**Contrato exacto:**
1. El middleware setea `requestHeaders.set(PATHNAME_HEADER, pathname)`
   **antes** de pasar `requestHeaders` a la respuesta, para TODA request que
   matchee su `config.matcher`.
2. Cualquier Server Component que necesite el pathname lo lee con
   `(await headers()).get(PATHNAME_HEADER)` — nunca lo deriva de otra fuente
   (URL de referrer, props) mientras este contrato exista.
3. **Fallback seguro-por-defecto:** si el header viene ausente o vacío
   (`null`), el comportamiento correcto es el MÁS SEGURO para ese consumidor
   — nunca asumir "sí es la ruta que estoy buscando". Un guard que resuelve
   "¿es esta ruta X?" devuelve `false` ante un header ausente, cayendo en la
   rama segura.
4. **Por qué puede faltar:** cualquier camino de render que no pase por el
   `matcher` del middleware puede dejar el header sin setear. El contrato
   asume que esto puede pasar y exige un fallback seguro — no es un caso que
   "no debería pasar nunca y por eso no se maneja".

**Para cualquier consumidor futuro:** reusar `PATHNAME_HEADER` tal cual,
respetar el punto 3, y si necesita el pathname en un contexto que el `matcher`
actual no cubre, ampliar el `matcher` en vez de inventar un segundo mecanismo.

## b. Política de uso del cliente `service_role`

**Archivo:** `packages/db/src/supabase/admin.ts` (`createAdminClient()`,
exportado como `@factura/db/supabase/admin`) — el cliente `service_role`
bypassa RLS/Storage por completo; es la excepción, no la norma.

**Dónde puede importarse (regla dura #1, post Fase 6/commit `705d0ea`):**
`createAdminClient` vive en un paquete COMPARTIDO (`packages/db`), pero solo
**`apps/api`** tiene permitido importarlo y llamarlo en runtime — es "la
única superficie autorizada a usar `service_role`" (ver el propio comentario
de cada call site en `apps/api`). **`apps/web` no debe importar
`@factura/db/supabase/admin` en ningún código que corra en producción.**
Verificado por grep (2026-08-26): cero usos reales en `apps/web` fuera de
comentarios que documentan esta regla y de la infraestructura de tests E2E
(`apps/web/e2e/**`, que corre fuera del runtime de la app y ya declara
explícitamente que esa prohibición rige el runtime, no sus propios fixtures).
Si algún día `apps/web` necesitara volver a importar el cliente admin, eso es
en sí mismo una decisión de alto impacto para `arquitecto-app` — no un PR
normal.

**Inventario AUTORITATIVO de call sites reales (mantenido en el header de
`packages/db/src/supabase/admin.ts`; reflejarlo acá cuando cambie):**

| # | Call site | Por qué es imposible con RLS |
|---|---|---|
| 1 | `apps/api/app/api/cron/generar-suscripciones/route.ts` | Cron server-to-server (`Authorization: Bearer ${CRON_SECRET}`, sin cookie de sesión) que genera facturas de suscripción para TODOS los tenants — ningún cliente de sesión puede satisfacer la política RLS sin sesión ni acotarse a "todos los tenants" a la vez. Llama a la RPC de sistema `public.asegurar_facturas_suscripcion_sistema()`, otorgada exclusivamente a `service_role`. |

Ningún otro call site existe hoy en el código real. El código heredado del
template base ("casilleros") todavía trae ejemplos de otras clases de uso
(Storage de un logo, alta pública sin sesión, outbox de email) que **no
tienen feature ni call site propios en esta app todavía** — quedan como
categorías de referencia en el punto 2 de abajo, no como inventario vigente.

1. **`service_role` NUNCA se usa como vía GENERAL de acceso para leer o
   escribir datos de negocio protegidos por RLS.** Si una operación necesita
   tocar esas tablas dentro del contexto normal de un tenant, usa SIEMPRE el
   cliente de sesión (`createClient()`), donde RLS aplica como con cualquier
   usuario autenticado. Usarlo como atajo rompería la garantía multi-tenant
   (regla dura #1) — es una prohibición estructural, no una cuestión de
   disciplina.
2. **Solo está permitido para operaciones estructuralmente IMPOSIBLES de
   resolver con RLS.** Tres clases de imposibilidad real:
   - **Storage en Supabase hosted:** un bucket de Storage tiene **cero
     políticas de escritura** posibles por SQL de este proyecto (el owner de
     `storage.objects` es `supabase_storage_admin`, fuera del alcance de
     nuestras migraciones — ver §"storage bucket-only" en el aprendizaje de
     CLAUDE.md). Con Storage en deny-by-default, la única vía de escritura es
     un cliente que bypassee RLS/Storage.
   - **Seed de plataforma sin tenant activo:** un Super-Admin en modo
     plataforma (sin ningún tenant seleccionado en su sesión) que siembra
     filas iniciales de un tenant recién creado — `current_tenant_id()` es
     `NULL` ahí, así que ninguna política RLS `tenant_id = current_tenant_id()`
     puede satisfacerse con el cliente de sesión, sin importar qué `tenant_id`
     se pida insertar. Insert puntual, idempotente (protegido por su unique
     index), disparado una sola vez al crear el tenant. El CRUD normal de esas
     tablas sigue exclusivamente por el cliente de sesión.
   - **Endpoint público sin sesión (registro público) o job de
     infraestructura sin sesión (cron):** un visitante `anon` (sin
     `auth.uid()`, sin membresía) que inserta desde un endpoint público, o un
     Cron server-to-server que recorre TODOS los tenants — en ambos NINGÚN
     cliente de sesión, sea cual sea su rol, puede satisfacer la política RLS.
     El criterio real es ese, no exclusivamente "operación de plataforma".
   Un candidato futuro tiene que demostrar el MISMO tipo de imposibilidad
   estructural (no "es más simple/rápido"), y `arquitecto-app` confirma que la
   imposibilidad es real antes de aceptar un uso nuevo.
3. **La autorización real queda 100% en la capa de aplicación que llama al
   cliente admin**, porque `service_role` no aplica ningún chequeo por sí
   mismo. Sin excepción:
   - Un `exigirPermiso(...)`/`exigirSuperAdmin()` ANTES de cualquier llamada al
     cliente admin — nunca después, nunca opcional.
   - Cualquier identificador que participe en la ruta/filtro de la operación
     (ej. el `tenantId` en el path de un archivo) tiene que salir del CONTEXTO
     ya autenticado/resuelto server-side (sesión + membresía vía §h, o el
     propio Cron/RPC de sistema para un job sin sesión), **jamás de un
     parámetro que mande el cliente** — la regla dura #1 aplica igual acá,
     aunque `service_role` no la fuerce. Este producto NO tiene subdominio por
     tenant (§h): un futuro endpoint público sin sesión que necesite resolver
     "a qué tenant pertenece esto" tiene que definir su PROPIO mecanismo
     explícito (ej. un token/capability URL), nunca inventarlo asumiendo un
     host por tenant que no existe acá.
4. **`import "server-only"`** en el módulo del cliente admin es obligatorio:
   hace fallar el build si se importa desde un Client Component, en vez de
   depender de disciplina humana.
5. **Proceso para agregar un uso NUEVO:**
   - Documentar en el propio call site la justificación puntual (qué
     limitación estructural hace imposible RLS acá).
   - Revisión **obligatoria** del agente `revisor` antes de mergear, con foco
     en los puntos 1-4.
   - Mantener en `packages/db/src/supabase/admin.ts` (y, siempre, en la tabla
     de este documento) la lista de usos permitidos, para que nunca quede
     desactualizada respecto al código real.

## c. Excepciones documentadas a la regla dura #1 (tenant_id como parámetro)

La regla dura #1 es "el tenant se resuelve por sesión/membresía (§h);
JAMÁS aceptar `tenant_id` desde el cliente". Puede existir un conjunto ACOTADO
de puntos donde un
`tenantId` SÍ viaja como parámetro explícito desde el cliente hacia una Server
Action — todos del mismo tipo de operación: el **Super-Admin eligiendo/actuando
sobre un tenant desde la consola de soporte** (no un usuario de tenant operando
sobre sus propios datos). Cada uno se lista explícitamente en una tabla
(función + archivo) al implementarse.

**Por qué es una excepción legítima y no una violación:** el flujo de negocio
ES literalmente "el Super-Admin elige QUÉ tenant, entre todos los que existen"
— no hay ningún subdominio de la request del que derivar ese tenant (el
Super-Admin navega el host de plataforma, sin subdominio de tenant, viendo la
lista completa). No existe una fuente "del lado del servidor" de la cual
derivar ese tenant sin que alguien lo elija explícitamente.

**Lo que SÍ hace que sea seguro (defensa en profundidad de 3 capas, ninguna
opcional):**

1. **Guard de rol PRIMERO, siempre antes de tocar el `tenantId`:**
   `exigirSuperAdmin()` corre antes de cualquier parseo del parámetro. Ningún
   usuario de tenant normal puede llegar a validar siquiera el *formato* de un
   `tenantId` ajeno.
2. **El `tenantId` se valida como FORMA (UUID) y luego como EXISTENCIA** —
   nunca se asume que el string recibido corresponde a un tenant real ("0 filas
   afectadas" es error explícito, nunca éxito silencioso).
3. **RLS + trigger de BD revalidan de forma independiente del código de
   aplicación** — esta es la garantía REAL; los puntos 1-2 son UX/defensa en
   profundidad. Las policies RLS de `tenants` (y los triggers de tablas de
   plataforma) exigen rol de Super-Admin para escribir sobre un tenant que no
   es el propio, así que un usuario normal que invocara la Server Action
   directamente (bypaseando la UI) sería rechazado en BD aunque el guard de
   aplicación fallara.

**Regla para cualquier excepción NUEVA:** debe (a) ser también "el
Super-Admin/plataforma eligiendo entre tenants", nunca un atajo de conveniencia
para un flujo de tenant normal; (b) implementar las mismas 3 capas; y (c)
sumarse a la tabla de este documento — no basta con un comentario aislado.

## d. Lectura de archivos de importación (`.xlsx`/CSV) — `packages/core/src/importacion/lector-archivo.ts`

**Librería:** `xlsx` (SheetJS) fijado al build OFICIAL del CDN propio de
SheetJS (ej. `https://cdn.sheetjs.com/xlsx-<ver>/xlsx-<ver>.tgz`), como
`dependency` de `packages/core` (dueño real del lector) y, en espejo, de
`apps/web` (que también la lista directa en su propio `package.json`) —
**nunca** al nombre `xlsx` a secas del registro npm (que resuelve a una
versión antigua con CVEs conocidas de prototype pollution/ReDoS; los CVEs
están corregidos en las versiones del CDN, que SheetJS no publica en npm). El
pin correcto vive en la URL misma; ningún Dependabot/actualización automática
debe "corregirla" a una versión del registro. Si la versión del CDN cambia,
actualizar el pin en AMBOS `package.json` en el mismo commit. `pnpm install`
la descarga del CDN y valida su integridad contra el hash de `pnpm-lock.yaml`.

**Por qué SheetJS y no las alternativas:** un `.xlsx` real puede usar
`t="inlineStr"` para el texto de sus celdas (codificación OOXML válida, sin
`xl/sharedStrings.xml`), que otras librerías (`read-excel-file`, `exceljs`)
**rechazan**. Un rechazo de un `.xlsx` VÁLIDO es un defecto de la librería, no
del archivo (ver la convención "Tolerante al recibir, específico al fallar" en
CLAUDE.md).

**Función pública única — el ÚNICO punto de entrada de todos los consumidores:**

```
// packages/core/src/importacion/lector-archivo.ts
leerFilasDeArchivo(
  archivo: File,
  opciones?: OpcionesLectorArchivo,
): Promise<ResultadoLectorArchivo>
```

El motor SheetJS vive detrás de esta función, nunca expuesto directo. Los
consumidores (cualquier importador del dominio) la llaman en vez de
reimplementar el dispatch CSV/Excel.

**Contrato de salida:**

Éxito:
```
{
  filas: string[][];             // primera fila = encabezados, celdas trim, vacías = "".
  tipoDetectado: "csv" | "xlsx"; // qué rama/motor procesó el archivo.
  hojaElegida: string | null;    // nombre de la hoja usada en xlsx (SIEMPRE la primera del libro); null en csv.
  advertencias: string[];        // SIEMPRE un array (puede ser vacío) — nunca undefined. No bloqueantes.
}
```

Error: `{ error: string }` — mensaje ACCIONABLE en español, nunca el error
crudo de la librería (que se loguea server-side, nunca se expone). Catálogo de
mensajes por causa (archivo vacío, demasiado grande, no es un `.xlsx`
válido, demasiadas filas) centralizado en `lib/textos/`. **`leerFilasDeArchivo`
nunca lanza.**

`OpcionesLectorArchivo`:
- `tamanoMaxBytes?: number` — cota de tamaño de ENTRADA, aplicada a ambas ramas
  (defensa en profundidad; el valor de la cota es decisión del consumidor).
- `filasMax?: number` — cota de filas, aplica SOLO a la rama `.xlsx` (el "used
  range" inflado de Excel es específico de ese formato).
- `conservarFilasVacias?: boolean` — controla el filtrado de filas 100% vacías
  SOLO en `.xlsx` (default `false` = las descarta). Para CSV es NO-OP (el parser
  CSV ya preserva todas las filas).

**Invariante crítico — la detección de encabezado/preámbulo NO es
responsabilidad del lector compartido:**
- **El lector** decide CSV-vs-xlsx (por extensión/MIME + magic bytes),
  decodifica bytes, elige la hoja (siempre la primera, sin heurística),
  convierte cada celda a `string` de forma uniforme (`raw:false` preserva
  ceros a la izquierda de celdas de texto), aplica las cotas y preserva/descarta
  filas vacías según el flag. Nunca decide qué fila es "el encabezado", nunca
  salta preámbulos, nunca reordena ni renumera — devuelve las filas en el orden
  posicional EXACTO.
- **El consumidor** implementa cualquier "detección de fila de encabezados" o
  "saltar preámbulo" que necesite, con su propio `numeroFila` recalculado. Un
  consumidor que numera por POSICIÓN real en la hoja pasa
  `conservarFilasVacias: true` (numerar por posición requiere que el lector
  nunca descarte filas antes de entregarlas). El lector no debe, bajo ninguna
  circunstancia, empezar a "ayudar" con esa detección.

**Tolerancias adicionales del lector** (todas sin cambiar su firma ni su
salida): recuperación de "CSV embebido en una sola columna" (un `.xlsx` cuyos
datos quedaron pegados como una línea CSV por celda — heurística TIGHT de varias
condiciones, todas deben cumplirse; ante división ambigua, error específico,
nunca se adivina) y des-mojibake (revertir "UTF-8 leído como Latin-1", ej.
"RodrÃ­guez"→"Rodríguez", SOLO cuando el reencode da UTF-8 válido y distinto;
ante cualquier duda, devuelve el original sin tocar). Ambas con fixtures
dedicados.

## e. Normalizador espejado JS↔SQL para búsqueda/dedup tolerante

**Qué es:** cuando una comparación/búsqueda de texto debe ser tolerante (a
tildes, mayúsculas, formato), el criterio de normalización se define UNA sola
vez y se implementa DOS veces — una función pura en TypeScript (usada por la
capa de aplicación/tests) y su espejo EXACTO en SQL como función `IMMUTABLE`
(usada para materializar una columna `GENERATED STORED` + índice, y así
filtrar/ordenar en BD sin traer todo a memoria). Las dos implementaciones deben
producir SIEMPRE el mismo resultado byte a byte para la misma entrada — si
diverge una, se corrige la otra en el mismo cambio.

Cada par (criterio · espejo TypeScript · espejo SQL · migración · columnas
`GENERATED` consumidas) se lista en una tabla al implementarse. Ejemplos
típicos del tipo: identificador normalizado (sin guiones/espacios, minúsculas)
y nombre normalizado (trim + minúsculas + sin tildes).

**Patrón de denormalización CROSS-TABLA vía trigger (para permitir `ORDER BY`
de PostgREST cuando el valor mostrado sale de un COALESCE entre DOS tablas):**
PostgREST solo puede `.order()` por una columna real de la tabla consultada —
nunca por una expresión ni por una columna de un embed. Cuando el texto que el
usuario VE es `coalesce(<algo de tabla A>, <algo de tabla B>)`, una columna
`GENERATED` sola no alcanza (Postgres prohíbe que la expresión de una
`GENERATED` lea una tabla ajena). Solución en DOS PASOS: (1) una columna BASE
normal (no generada) en la tabla que se lista/ordena, mantenida por un PAR de
triggers — uno `BEFORE INSERT OR UPDATE OF <fk>` en la tabla hija que cachea el
valor de la fila padre al insertar/reasignar la FK, y otro `AFTER UPDATE ...
WHEN (<columna cambió>)` en la tabla padre que PROPAGA un rename a todas las
filas hijas en un solo `UPDATE` por sentencia (no un loop); (2) una columna
`GENERATED` sobre la de (1) + el valor crudo propio, que sí solo lee columnas
de la propia fila y es la que se usa para `.order()`/el índice. Ambos triggers
son `SECURITY INVOKER` (default) a propósito — la RLS de ambas tablas ya limita
al mismo tenant sin necesitar privilegios elevados.

**Auditoría de la columna BASE cross-tabla:** a diferencia de una `GENERATED`
(excluida siempre del diff de auditoría vía `pg_attribute.attgenerated`), la
columna BASE de este patrón SÍ entra al diff — es un dato de negocio real que
cambia por un evento real (matching o rename). Propagar el rename de una fila
padre con N hijas genera N filas nuevas en `auditoria` — comportamiento
correcto de la regla dura #7, documentarlo en el header de cada migración de
este patrón.

**Regla dura:** toda columna `*_normalizado[a]` `GENERATED` se consume SIEMPRE
pasando el término de búsqueda del usuario por su espejo TS exacto ANTES de
armar el `.ilike()`/`.eq()` — nunca se compara el término crudo contra una
columna normalizada. El criterio canónico de cada par lo documenta el header de
la migración SQL correspondiente.

**Requisito de orden de deploy:** el código que consume una columna
`*_normalizado[a]` referencia una columna que SOLO existe tras aplicar la
migración. Desplegar el código ANTES de aplicar la migración produce
`42703: column does not exist` (500) en cada búsqueda — la migración se aplica
PRIMERO, en cada ambiente, antes del código que depende de ella.

## f. Memoización por-request de lecturas de catálogo/config con `React.cache()`

**Contexto:** una misma pantalla (Server Component) suele invocar la MISMA
función de lectura de catálogo/config con el MISMO `tenantId` varias veces en
un solo render. Cada llamada es un round-trip real a Supabase — el costo
dominante de la pantalla no es el volumen de filas sino la CANTIDAD de idas a
la BD.

**Convención:** las funciones de LECTURA de catálogo/config **tenant-scoped**
que se invocan desde el árbol de render de un Server Component se memoizan
por-request envolviéndolas con `cache` de `"react"`
(`export const f = cache(async (tenantId) => …)`). React deduplica las llamadas
con argumentos idénticos dentro de un mismo render/request, colapsando los
round-trips repetidos a uno solo. La memoización es transparente: no cambia la
firma ni el valor devuelto.

**Regla dura (para NO arriesgar aislamiento multi-tenant):**
1. Solo se envuelve una función cuyo único insumo variable de tenant llegue
   como **argumento EXPLÍCITO** (`tenantId: string`), o que sea un catálogo
   GLOBAL sin tenant. **NUNCA** una función que resuelva el tenant internamente
   desde cookies/sesión — la clave del cache debe ser el propio `tenantId`,
   para que dos tenants jamás compartan una entrada.
2. `React.cache()` queda restringido a funciones invocadas desde el árbol de
   render de Server Components. Route Handlers y Server Actions quedan FUERA
   (su ciclo de vida no es el del render).
3. Si una función recibía un cliente `supabase` compartido como parámetro, para
   cachearla de forma efectiva pasa a crear su PROPIO cliente (`createClient()`)
   — la clave del cache es `tenantId`, no una instancia de cliente que cambia
   por invocación.

## g. Rutas de cron `/api/cron/*` — bypass del middleware de sesión/tenant

**Archivos:** `apps/web/middleware.ts` (el bypass),
`apps/web/app/api/cron/<job>/route.ts` (los consumidores),
`apps/web/vercel.json` (los crons que los disparan).

**El problema que resuelve:** `middleware.ts` corre para TODA request que
matchee su `config.matcher` y redirige con 307 a `/login` cuando no hay cookie
de sesión de Supabase. Un Cron de Vercel golpeando `/api/cron/<job>` NUNCA
tiene esa cookie (es una invocación programada server-a-server con
`Authorization: Bearer <CRON_SECRET>`) — sin bypass, la ruta recibiría siempre
el 307 de `/login`, nunca el JSON que su contrato promete.

**Contrato exacto:** `middleware.ts` evalúa
`pathname === "/api/cron" || pathname.startsWith("/api/cron/")` como el PRIMER
chequeo de la función y, si matchea, devuelve `NextResponse.next()` sin tocar
tenant/sesión/mantenimiento/headers internos. **El bypass está ACOTADO A
PROPÓSITO a `/api/cron/*`, NO a todo `/api/*`:** una futura ruta `/api` que NO
sea de cron NO hereda el bypass por accidente — sigue el camino normal del
middleware. Así, agregar una ruta `/api` sensible sin su propia auth NO la deja
expuesta por omisión.

**Consecuencia — cada ruta de cron es responsable de su PROPIA
autenticación/autorización** (por secreto de infraestructura, ej.
`CRON_SECRET`), el middleware ya NO se la da:
- El handler valida su secreto DENTRO del handler (fail-closed si el secreto no
  está seteado).
- Si necesita resolver un TENANT, lo hace explícitamente (normalmente el tenant
  sale de una consulta a BD, no del host) — el header interno
  `TENANT_SUBDOMAIN_HEADER` NO llega seteado a `/api/cron/*`.
- El modo mantenimiento tampoco aplica a `/api/cron/*` — un job de
  infraestructura debe poder correr aunque la UI esté en mantenimiento.

**Por qué el bypass es SEGURO:** el middleware nunca fue la única capa de
autorización — es UX/routing (redirects tempranos); la garantía real siempre
fue RLS + guards de aplicación dentro de cada handler (mismo criterio que §b
punto 3). Sacar `/api/cron/*` del camino del middleware no relaja ninguna
política RLS ni guard — solo saca un redirect que era el comportamiento
INCORRECTO para una API server-to-server.

**Regla para cualquier ruta `/api/*` NUEVA:** (1) documentar en el propio
archivo su mecanismo de autenticación (secreto compartido, `auth.uid()`, o
pública por diseño con su propio rate-limit); (2) una ruta que NO sea de cron
pasa por el middleware normal, NO se agrega al bypass; (3) si necesita
`tenant_id`/pathname y está bajo `/api/cron`, resolverlo dentro del handler,
nunca asumir que el middleware lo dejó en un header; (4) sumar el caso a esta
sección si introduce un patrón de autenticación distinto a `CRON_SECRET`.

## h. Resolución de tenant: por SESIÓN/MEMBRESÍA, nunca por subdominio

**Archivos:** `packages/db/src/auth/usuario-actual.ts` (`obtenerUsuarioActual`,
memoizado por-request con `React.cache`, §f), `packages/db/src/auth/exigir-permiso.ts`
(`exigirPermiso`, gate de Server Actions), `packages/db/src/auth/exigir-super-admin.ts`,
la tabla `usuarios_tenants` (membresía real), `super_admins`/
`super_admin_tenant_activo` (modo soporte, ver §c), y en BD la función
`private.current_tenant_id()` (creada en `20260713090000`; devuelve `NULL`
para un miembro de un tenant bloqueado desde `20260815100000`, y resuelve el
modo soporte desde `20260714221000`).

**Contexto — por qué NO es por subdominio:** el framework base del que sale
este repo ("casilleros") sí daba una URL propia por tenant (subdominio =
tenant). **Este producto es una desviación deliberada de esa convención**
(regla dura #1 de `CLAUDE.md`): hay UN solo dashboard, en un host FIJO
(`web.factura-electronica.app`), para TODOS los tenants — el subdominio de la
request no puede llevar el tenant porque todos comparten el mismo host. El
tenant sale exclusivamente de qué usuario inició sesión.

**Contrato exacto:**
1. `obtenerUsuarioActual()` resuelve `auth.uid()` vía `supabase.auth.getUser()`
   y, en paralelo (un solo round-trip efectivo), consulta la membresía real
   del usuario en `usuarios_tenants` (re-validando `estado = 'activo'` en la
   propia app, regla dura #3 — nunca confiar ciegamente en que RLS ya filtró
   todo), si es Super-Admin (`super_admins`) y su selección de modo soporte
   (`super_admin_tenant_activo`, §c) y si está bloqueado
   (`tenant_bloqueado_propio()`). El `tenantId` operable de la request sale
   EXCLUSIVAMENTE de ese contexto — nunca de un header, cookie, query param o
   campo de formulario que el cliente controle.
2. **La garantía real de aislamiento es RLS en BD, no la capa de aplicación:**
   toda política `tenant_id = private.current_tenant_id()` de cualquier tabla
   de negocio depende de esa función de Postgres, que lee `usuarios_tenants` a
   partir de `auth.uid()` DENTRO de la base — no de nada que la app le pase.
   Un bug en la capa de aplicación (punto 3) puede dar una peor experiencia,
   nunca debería poder filtrar datos de otro tenant.
3. `exigirPermiso(permiso)` es el ÚNICO gate de aplicación para Server
   Actions — mismo criterio del punto 1, **nunca** recibe `tenantId` de
   parámetro. Arma la membresía EFECTIVA (real, o la sintética de modo
   soporte, §c) y valida rol + permiso ANTES de tocar cualquier dato; es
   defensa en profundidad de UX (mensaje de negocio en español en vez de un
   `42501` crudo de Postgres), no la garantía real.
4. **Un usuario = una membresía activa** (regla dura #2: "un usuario = un
   tenant"). Sin membresía activa, `membresia` es `null` y el app shell
   muestra `<SinEquipo/>`. El único estado intermedio válido es un
   Super-Admin sin tenant seleccionado ("modo plataforma"), resuelto vía
   `modoSoporte`/`super_admin_tenant_activo` — ver §c para la ÚNICA excepción
   real donde un `tenantId` SÍ viaja como parámetro explícito.
5. `apps/web/middleware.ts` solo decide "¿hay sesión, sí o no?" (sin cookie
   de Supabase → redirect a `/login`) — **nunca** resuelve tenant. No existe
   ningún gate de "subdominio inexistente → 404" en este producto: no hay
   nada que verificar, porque el host es fijo y no codifica tenant.

**Deuda heredada — pipeline de subdominio SIN uso real, no lo reutilices:**
el código todavía trae, sin ningún consumidor en runtime, la resolución de
tenant POR SUBDOMINIO heredada de "casilleros": `packages/core/src/tenant/subdominio.ts`
(`resolverSubdominio`, `TENANT_SUBDOMAIN_HEADER`, `SUBDOMINIOS_RESERVADOS`),
que `apps/web/middleware.ts` **sigue calculando y seteando** en cada request
(header `x-tenant-subdominio`) sin que nada lo lea para gating;
`packages/db/src/tenant/gate-subdominio.ts` (`subdominioActualNoExiste()`) y
`packages/db/src/tenant/tenant-publico.ts` (`resolverTenantPublicoPorSubdominio()`
— el único punto de `packages/db` que importa `createAdminClient` FUERA del
inventario vigente de §b, aunque nadie lo invoca hoy); y
`apps/web/lib/tenant/enlace-tenant.ts` (`construirUrlPublicaTenant`, 0
llamadores). Su uso real se quitó de los layouts en el commit `705d0ea`
(Fase 6, "modelo de tenant POR SESIÓN, sin service-role en web"), pero los
ARCHIVOS siguen existiendo y `@factura/db` los sigue exportando
(`./tenant/tenant-publico`, `./tenant/gate-subdominio` en
`packages/db/package.json`) — nada impide hoy que un PR futuro los
reimporte por error, reintroduciendo tanto un camino a `service_role`
alcanzable desde `apps/web` (violaría §b) como un modelo de tenant que
contradice este §h. **Esto es deuda de la migración, señalada acá el
2026-08-26 por `arquitecto-app`, no una decisión vigente** — su limpieza
(borrar los archivos y el cálculo de subdominio del middleware, o sacarlos de
los `exports` de `packages/db`/`packages/core` mientras no tengan consumidor)
queda para que `project-manager` la priorice. Hasta entonces, ningún código
nuevo debe apoyarse en `TENANT_SUBDOMAIN_HEADER`/`resolverSubdominio`/
`subdominioActualNoExiste`/`construirUrlPublicaTenant` para gating o
resolución de tenant real — el contrato vigente es el de este §h.

## i. Topología de deploy en Vercel (Turborepo, 3 apps)

**Confirmado por `arquitecto-app` el 2026-08-26** al cerrar la migración a
Turborepo (Fases 1-6, commits `5a38309`…`705d0ea`): las tres apps
(`apps/web`, `apps/api`, `apps/landing`) se despliegan como **tres Vercel
Projects separados**, cada uno con su propio **Root Directory** apuntando a
`apps/web`, `apps/api` y `apps/landing` respectivamente (configuración de
Dashboard/Project Settings, fuera del repo) — NO un solo proyecto con
reescrituras internas. Es la topología ya vigente (`apps/api/next.config.ts`
trae la nota "Framework Preset = Next.js" de un incidente previo, evidencia de
que el proyecto YA existía como tal antes de esta migración estructural).

**Por qué NO hace falta `vercel.json` en `apps/web` ni en `apps/landing`:**
`vercel.json` solo es necesario cuando hay que declarar algo que el Dashboard
no cubre — hoy el único caso real del monorepo son los `crons` de
`apps/api/vercel.json` (`crons` SOLO puede declararse por archivo, nunca por
Dashboard). Ni `apps/web` ni `apps/landing` tienen crons ni ninguna otra
config que solo `vercel.json` resuelva; su Build/Install/Output Command usan
el default de Next.js, y Vercel ya detecta el monorepo (pnpm workspace +
`turbo.json` en la raíz) sin configuración adicional — basta con el Root
Directory del proyecto y "Include files outside the Root Directory in the
Build" activado (necesario para que el build de cada app resuelva
`packages/*` vía `workspace:*`, ya que `transpilePackages` en cada
`next.config.ts` los consume como TypeScript crudo, sin build propio — ver
`apps/web/next.config.ts`, `apps/api/next.config.ts`,
`apps/landing/next.config.ts`). Si una futura necesidad de `web`/`landing`
exige algo que el Dashboard no cubre (headers/redirects custom, otro cron,
`functions` con runtime distinto), agregar su propio `vercel.json` puntual es
una decisión LOCAL y reversible — no requiere pasar por `arquitecto-app`
salvo que cambie routing, dominios o variables de entorno.

**Instalación/build en CI y en Vercel deben usar el mismo gestor de
paquetes:** desde esta ronda (ver Task 2, `.github/workflows/ci.yml`), tanto
CI como Vercel instalan con `pnpm` (declarado en
`"packageManager": "pnpm@9.15.9"` del `package.json` raíz) — Vercel lo
detecta automáticamente por ese campo sin configuración extra por proyecto.

**Variables de entorno:** cada uno de los 3 Vercel Projects mantiene su
PROPIO set de env vars por ambiente (Development/Preview/Production) desde su
Dashboard — `apps/api` es la única superficie con `SUPABASE_SERVICE_ROLE_KEY`
(regla dura #1/§b); `apps/web`/`apps/landing` nunca deben tenerla configurada,
ni siquiera en Preview. Esto NO cambió con la migración a Turborepo — sigue
siendo responsabilidad de quien administra cada Project en el Dashboard, este
documento solo documenta la topología, no gestiona los valores.
