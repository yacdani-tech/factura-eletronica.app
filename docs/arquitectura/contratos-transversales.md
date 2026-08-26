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

**Archivo:** `apps/web/lib/supabase/admin.ts` — el cliente `service_role`
bypassa RLS/Storage por completo; es la excepción, no la norma.

**Regla del proyecto (aplica a cualquier uso, existente o futuro):**

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
     de sesión ya autenticado, **jamás de un parámetro que mande el cliente** —
     la regla dura #1 aplica igual acá, aunque `service_role` no la fuerce. En
     un flujo público, el `tenantId` sale de resolver el subdominio server-side
     (§a / §h), nunca del FormData.
4. **`import "server-only"`** en el módulo del cliente admin es obligatorio:
   hace fallar el build si se importa desde un Client Component, en vez de
   depender de disciplina humana.
5. **Proceso para agregar un uso NUEVO:**
   - Documentar en el propio call site la justificación puntual (qué
     limitación estructural hace imposible RLS acá).
   - Revisión **obligatoria** del agente `revisor` antes de mergear, con foco
     en los puntos 1-4.
   - Mantener en `lib/supabase/admin.ts` (y, si el proyecto lo lleva, en esta
     sección) la lista de usos permitidos, para que nunca quede desactualizada
     respecto al código real.

## c. Excepciones documentadas a la regla dura #1 (tenant_id como parámetro)

La regla dura #1 es "el subdominio define el tenant; JAMÁS aceptar `tenant_id`
desde el cliente". Puede existir un conjunto ACOTADO de puntos donde un
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

## d. Lectura de archivos de importación (`.xlsx`/CSV) — `lib/importacion/lector-archivo.ts`

**Librería:** `xlsx` (SheetJS) fijado al build OFICIAL del CDN propio de
SheetJS (ej. `https://cdn.sheetjs.com/xlsx-<ver>/xlsx-<ver>.tgz`), como
`dependency` de `apps/web` — **nunca** al nombre `xlsx` a secas del registro
npm (que resuelve a una versión antigua con CVEs conocidas de prototype
pollution/ReDoS; los CVEs están corregidos en las versiones del CDN, que
SheetJS no publica en npm). El pin correcto vive en la URL misma; ningún
`npm update`/Dependabot debe "corregirla" a una versión del registro. `npm ci`
la descarga del CDN y valida su integridad contra el hash del lockfile.

**Por qué SheetJS y no las alternativas:** un `.xlsx` real puede usar
`t="inlineStr"` para el texto de sus celdas (codificación OOXML válida, sin
`xl/sharedStrings.xml`), que otras librerías (`read-excel-file`, `exceljs`)
**rechazan**. Un rechazo de un `.xlsx` VÁLIDO es un defecto de la librería, no
del archivo (ver la convención "Tolerante al recibir, específico al fallar" en
CLAUDE.md).

**Función pública única — el ÚNICO punto de entrada de todos los consumidores:**

```
// apps/web/lib/importacion/lector-archivo.ts
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

## h. Gate "subdominio inexistente → 404 genérico, nunca login"

**Archivos:** `apps/web/lib/tenant/gate-subdominio.ts` (el helper),
`apps/web/app/(auth)/layout.tsx` (login/registro),
`apps/web/app/(app)/layout.tsx` (app shell), `apps/web/app/not-found.tsx` (la
404 genérica), el resolver de tenant público reutilizado (§b),
`apps/web/lib/tenant/subdominio.ts` (`SUBDOMINIOS_RESERVADOS`).

**El problema que resuelve:** el middleware resuelve el subdominio SOLO
parseando el header `Host` — por diseño **nunca consulta la BD**. Sin este
gate, un subdominio que no corresponde a NINGÚN tenant
(`noexiste.factura-eletronica.app`) llega sin sesión, el middleware redirige a `/login`
(mismo host), y el usuario ve el formulario de login como si `noexiste` fuera
una cuenta real — filtra indirectamente "esto podría ser un tenant" y es una
experiencia incorrecta para cualquier URL mal tecleada.

**Contrato exacto:**
1. `subdominioActualNoExiste(): Promise<boolean>` es un wrapper delgado sobre
   el resolver de tenant público (§b, sin duplicar la query): devuelve `true`
   ÚNICAMENTE cuando el resultado es `no_encontrado` (ningún tenant tiene ese
   subdominio). Los otros casos devuelven `false` (el gate NO aplica):
   - `{ tenant }` (existe y activo) → normal.
   - `sin_subdominio` (host de plataforma: raíz, `www`, `web`, `localhost`) →
     normal, short-circuit sin consultar BD.
   - `bloqueado` (el tenant EXISTE pero no está `activo`) → **NO** 404, a
     propósito: dar 404 rompería el flujo de expulsión de tenant bloqueado
     (regla dura #9). El gate es estrictamente de EXISTENCIA, no de estado.
   - `error_servidor` (falta la key de servicio o falla transitoria) →
     **fail-OPEN**, a propósito: un error de infraestructura NUNCA debe
     convertirse en un 404 masivo para TODOS los subdominios.
2. **Mensaje genérico (regla dura de no filtrar información):**
   `app/not-found.tsx` muestra un mensaje ÚNICO y genérico ("Esta página no
   existe") sin importar la causa real — el visitante NUNCA puede distinguir,
   por la respuesta HTTP ni por el copy, si el subdominio nunca existió, es una
   palabra reservada, o fue dado de baja.
3. **Dos consumidores, mismo contrato:**
   - `app/(auth)/layout.tsx` (login/registro): corre el gate ANTES de renderizar
     — cubre el visitante sin sesión con subdominio basura.
   - `app/(app)/layout.tsx` (app shell): corre el gate **en paralelo** con la
     resolución de usuario (`Promise.all`, sin sumar latencia) y ANTES de
     cualquier rama existente. Aplica **también a usuarios YA logueados** —
     cubre una sesión vieja apuntando a un host que dejó de existir. Sale del
     alcance el caso "el subdominio existe pero es de OTRO tenant al de la
     sesión" (eso se resuelve por el tenant de la SESIÓN, no del host).
4. **El middleware NO cambia y sigue sin consultar la BD** — toda la resolución
   real de existencia se hace server-side en los dos layouts, vía el mismo
   helper. El costo de una consulta a `tenants` por request solo se paga donde
   hace falta decidir render (layouts), no en el middleware que corre para todo.

**No es un uso nuevo de `service_role`:** el gate reutiliza exactamente la
misma función/lectura ya aceptada (§b), sin tocar ninguna tabla ni caller de
escritura nuevos.

**`SUBDOMINIOS_RESERVADOS`** (`lib/tenant/subdominio.ts`) es un set curado de
palabras de infraestructura/producto/soporte que ningún tenant puede registrar.
La lista de la APP es la autoritativa (el CHECK de BD es solo defensa en
profundidad); ampliarla no requiere migración. Ningún subdominio reservado
resuelve a un tenant real, así que caen solos en el 404 de este gate.
