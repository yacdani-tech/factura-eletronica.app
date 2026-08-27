/**
 * Contrato TRANSVERSAL de orden + filtro por estado para toda lista paginada
 * del sitio (lote de Yac 2026-07-18, ítems 4+6 — "listas transversales").
 * Módulo puro, sin dependencias de Next/Supabase (mismo criterio que
 * `lib/paginacion.ts`): parsea query params CRUDOS de forma segura y devuelve
 * lo necesario para armar el `.order()`/`.eq()` real de Supabase — nunca se
 * interpola un string de columna/estado sin pasar antes por una whitelist
 * explícita de la entidad (regla dura: toda entrada externa se valida en el
 * servidor; acá la "entrada externa" es el query string).
 *
 * CONTRATO que consume `ui-app` en CADA lista de la app (mismos nombres de
 * query param en todas, para una UX consistente de "click en el header de
 * columna ordena"):
 *   - `orden`  : nombre de columna en camelCase (ej. `creadoEn`, `nombre`).
 *                Cualquier valor fuera de la whitelist de la entidad — o
 *                ausente — cae al DEFAULT completo de esa entidad.
 *   - `dir`    : `asc` | `desc`. Si `orden` es válido pero `dir` no lo es (o
 *                falta), TAMBIÉN se cae al default completo (columna +
 *                dirección) — nunca se mezcla una columna pedida con una
 *                dirección inventada a mitad de camino. Quien arma los links
 *                de la UI siempre debe mandar el PAR completo
 *                (`?orden=nombre&dir=asc`), igual criterio que
 *                `construirHrefPagina` con la paginación.
 *   - `estado` : valor crudo del filtro de estado de la entidad (ej.
 *                `activo`/`inactivo`/`bloqueado` según la entidad) o el
 *                valor especial `todos` para desactivar el filtro. CUALQUIER
 *                otro valor — incluido ausente — cae al estado "activo" de
 *                la entidad (default de item 6: activo por defecto, inactivo
 *                solo si el usuario lo pide explícitamente).
 *
 * Cada función de listado (`lib/<entidad>/datos.ts`) es dueña de:
 *   1. su propia whitelist de columnas ordenables (`Record<camelCase,
 *      columna_db>`) — documentada ahí mismo, con qué columnas quedan FUERA
 *      a propósito (ej. una columna derivada de un join/subquery, como
 *      "plan" en tenants o "ruta/zona" en subclientes) y por qué;
 *   2. su orden por defecto (SIEMPRE `creadoEn` DESC salvo excepción
 *      documentada);
 *   3. su propio set de estados válidos + cuál es el estado "activo".
 *
 * Desempate determinista: toda función de listado paginada debe encadenar un
 * SEGUNDO criterio de orden por `id` ASCENDENTE después del pedido por el
 * usuario (`.order(columnaDb, {ascending}).order("id", {ascending: true})`,
 * o el equivalente en memoria vía `ordenarEnMemoria`) — sin esto, filas con
 * el mismo valor en la columna ordenada (ej. mismo `estado`) pueden
 * reordenarse entre páginas sucesivas y romper la paginación.
 */

export type Direccion = "asc" | "desc";

export interface OrdenListado<TColumna extends string = string> {
  columna: TColumna;
  direccion: Direccion;
}

export interface ResolucionOrden<TColumna extends string> {
  /** El orden EFECTIVO ya resuelto (pedido válido, o el default completo). */
  pedido: OrdenListado<TColumna>;
  /** Columna real de la tabla (snake_case) para pasarle a `.order()` de Supabase. */
  columnaDb: string;
  /** `true` si `pedido.direccion === "asc"` — atajo para `.order(col, { ascending })`. */
  ascending: boolean;
}

/** `"todos"` desactiva el filtro de estado; cualquier otro valor es uno de los estados reales de la entidad. */
export type FiltroEstado<TEstado extends string> = TEstado | "todos";

function primerValor(valor: string | string[] | undefined): string | undefined {
  const crudo = Array.isArray(valor) ? valor[0] : valor;
  return crudo === undefined || crudo === "" ? undefined : crudo;
}

/**
 * Parte un término de búsqueda en PALABRAS (tokens) — separadas por cualquier
 * cantidad de espacios, descartando las vacías. Base de la búsqueda "por
 * palabras en cualquier orden" (decisión de Yac 2026-07-23): cada token se
 * exige por separado con un `.ilike("%token%")` ENCADENADO (los filtros
 * encadenados de supabase-js se combinan con AND), así "rodriguez fabian"
 * encuentra "Fabián Solano Rodríguez" sin depender del orden. Módulo puro,
 * sin dependencia de Supabase — el caller arma el `.ilike`/`.or` real.
 */
export function tokenizarBusqueda(valor: string | string[] | undefined | null): string[] {
  const crudo = Array.isArray(valor) ? valor[0] : valor;
  if (!crudo) return [];
  return crudo.trim().split(/\s+/).filter((token) => token.length > 0);
}

/**
 * Sanitiza UN token para usarlo como valor literal dentro de la gramática de
 * `.or()` de PostgREST (ej. `lib/consolidados/datos.ts` — búsqueda por
 * nombre/tracking/WR de `/paquetes`, `lib/subclientes/datos.ts`) — quita los
 * metacaracteres reservados de esa gramática (`,`, `(`, `)`, `*`, `:`, `.`,
 * `"`, y la barra invertida) para que un token con paréntesis/comas no rompa
 * ni altere la semántica del filtro compuesto. Un nombre, tracking o guía WR
 * normal no lleva estos caracteres, así que la sanitización es transparente
 * en el caso común.
 *
 * NUNCA se debe interpolar un token crudo dentro de un string de `.or()`. Los
 * filtros "normales" (`.ilike`/`.eq`/`.in` fuera de un `.or()`) van
 * parametrizados por supabase-js y NO necesitan esta sanitización.
 */
export function sanitizarTokenParaOr(token: string): string {
  return token.replace(/[,()*:.\\"]/g, "").trim();
}

/**
 * Aplica `sanitizarTokenParaOr` a una lista de tokens (ej. la salida de
 * `tokenizarBusqueda`), descartando los que quedan vacíos tras sanitizar (un
 * token compuesto ÚNICAMENTE por metacaracteres, ej. `"(),"`, no aporta
 * ningún filtro real).
 */
export function sanitizarTokensParaOr(tokens: readonly string[]): string[] {
  return tokens.map(sanitizarTokenParaOr).filter((token) => token.length > 0);
}

/**
 * Resuelve el orden pedido (query params crudos `orden`/`dir`) contra la
 * whitelist de columnas ordenables de una entidad. `columnasPermitidas`
 * mapea cada columna PERMITIDA (camelCase, lo que ve la UI) a su columna
 * real en la tabla (snake_case, lo que recibe `.order()`) — cualquier valor
 * de `columnaCruda` que no sea una CLAVE de ese mapa (o cuyo `direccionCruda`
 * no sea exactamente `"asc"`/`"desc"`) hace caer TODO el resultado al
 * `porDefecto` completo, nunca se interpola el valor crudo en ningún lado.
 */
export function resolverOrden<TColumna extends string>(
  columnaCruda: string | string[] | undefined,
  direccionCruda: string | string[] | undefined,
  columnasPermitidas: Record<TColumna, string>,
  porDefecto: OrdenListado<TColumna>,
): ResolucionOrden<TColumna> {
  const columnaStr = primerValor(columnaCruda);
  const direccionStr = primerValor(direccionCruda);

  const columnaEsValida =
    columnaStr !== undefined && Object.prototype.hasOwnProperty.call(columnasPermitidas, columnaStr);
  const direccionEsValida = direccionStr === "asc" || direccionStr === "desc";

  if (!columnaEsValida || !direccionEsValida) {
    return {
      pedido: porDefecto,
      columnaDb: columnasPermitidas[porDefecto.columna],
      ascending: porDefecto.direccion === "asc",
    };
  }

  const columna = columnaStr as TColumna;
  const direccion = direccionStr as Direccion;
  return {
    pedido: { columna, direccion },
    columnaDb: columnasPermitidas[columna],
    ascending: direccion === "asc",
  };
}

/**
 * Resuelve el filtro de estado (query param crudo `estado`) contra los
 * estados válidos de una entidad. `"todos"` desactiva el filtro (el caller
 * no debe agregar ningún `.eq("estado", ...)`); cualquier valor que SÍ esté
 * en `estadosValidos` se usa tal cual; cualquier otro valor — incluido
 * ausente/vacío — cae a `estadoActivo` (default de item 6: activo por
 * defecto, nunca se interpola un valor crudo no reconocido).
 */
export function resolverFiltroEstado<TEstado extends string>(
  valorCrudo: string | string[] | undefined,
  estadosValidos: readonly TEstado[],
  estadoActivo: TEstado,
): FiltroEstado<TEstado> {
  const crudo = primerValor(valorCrudo);
  if (crudo === "todos") return "todos";
  if (crudo !== undefined && (estadosValidos as readonly string[]).includes(crudo)) {
    return crudo as TEstado;
  }
  return estadoActivo;
}

/**
 * Variante de `resolverFiltroEstado` para EJES DE FILTRO OPCIONALES que NO
 * representan la noción "activo/inactivo" de una entidad (item 6) — no hay
 * un estado que se oculte por defecto, cada valor es simplemente un recorte
 * opt-in sobre una lista que por defecto muestra TODO. Ausente, vacío o un
 * valor fuera de `estadosValidos` caen SIEMPRE a `"todos"` (sin filtro),
 * nunca a un estado específico (a diferencia de `resolverFiltroEstado`, que
 * cae a `estadoActivo`).
 *
 * Uso previsto (feature "por revisar" + filtros por eje, 2026-07-22): los 4
 * filtros de `/paquetes` (`estadoRevision`/`estadoMatch`/`estadoRuta`/
 * `estadoFacturacion`, `lib/consolidados/datos.ts`) — la lista general
 * muestra todos los estados mezclados (cada fila ya lleva su propio badge);
 * los filtros existen para que los links de conteo de `/consolidados`
 * (`?estadoRevision=por_revisar`, etc.) puedan preseleccionar un recorte,
 * nunca para ocultar algo por defecto sin que el usuario lo pida.
 */
export function resolverFiltroEstadoOpcional<TEstado extends string>(
  valorCrudo: string | string[] | undefined,
  estadosValidos: readonly TEstado[],
): FiltroEstado<TEstado> {
  const crudo = primerValor(valorCrudo);
  if (crudo !== undefined && (estadosValidos as readonly string[]).includes(crudo)) {
    return crudo as TEstado;
  }
  return "todos";
}

/**
 * Parsea un query param MULTI-valor (filtros de `/paquetes` con
 * multi-selección, 2026-07-23): acepta tanto claves repetidas
 * (`?revision=ok&revision=por_revisar`, `valorCrudo` llega como array de
 * `searchParams`) como una única cadena CSV (`?revision=ok,por_revisar` —
 * formato RECOMENDADO para armar los links, ver `FiltrosPaquetes`: un string
 * atómico sobrevive intacto a `construirHrefPagina`/`construirHrefOrden`, que
 * solo saben preservar/reemplazar el VALOR de un param, no reensamblar
 * claves repetidas). Ambos formatos se soportan a la vez (si llegara un
 * array, cada elemento TAMBIÉN se separa por coma) para no romper a quien
 * arme un link con la clave repetida. Vacíos se descartan. Sin dedupe ni
 * validación acá — eso es responsabilidad de `resolverFiltroEstadoMultiple`
 * (o del caller, para valores sin whitelist como un id de consolidado).
 */
export function normalizarValoresMultiples(valorCrudo: string | string[] | undefined): string[] {
  if (valorCrudo === undefined) return [];
  const bruto = Array.isArray(valorCrudo) ? valorCrudo : [valorCrudo];
  return bruto
    .flatMap((v) => v.split(","))
    .map((v) => v.trim())
    .filter((v) => v !== "");
}

/**
 * Variante MULTI-valor de `resolverFiltroEstadoOpcional` (multi-selección de
 * filtros, 2026-07-23 — los 5 ejes de `/paquetes`: consolidado, revisión,
 * match, ruta, facturación). `[]` (sin ningún valor válido, incluido
 * ausente/vacío) significa "todos" (sin filtro) — MISMO criterio que la
 * variante single-valor, nunca cae a un estado "activo" por defecto.
 * Cualquier valor fuera de `estadosValidos` se descarta EN SILENCIO (nunca
 * se propaga tal cual); se dedupea preservando el orden de PRIMERA aparición
 * en `valorCrudo`.
 */
export function resolverFiltroEstadoMultiple<TEstado extends string>(
  valorCrudo: string | string[] | undefined,
  estadosValidos: readonly TEstado[],
): TEstado[] {
  const vistos = new Set<TEstado>();
  const resultado: TEstado[] = [];
  for (const crudo of normalizarValoresMultiples(valorCrudo)) {
    if ((estadosValidos as readonly string[]).includes(crudo) && !vistos.has(crudo as TEstado)) {
      vistos.add(crudo as TEstado);
      resultado.push(crudo as TEstado);
    }
  }
  return resultado;
}

/**
 * Ordena un array EN MEMORIA por el valor resuelto de `obtenerValor`, con
 * desempate determinista por `obtenerIdDesempate` (SIEMPRE ascendente, sin
 * importar `ascending` — mismo criterio que el segundo `.order("id", {
 * ascending: true })` a nivel SQL). `null`/`undefined` siempre van al FINAL,
 * sin importar la dirección pedida (un valor ausente no es "el más chico" ni
 * "el más grande", es una categoría aparte).
 *
 * Uso previsto: listas donde el criterio de orden pedido puede depender de
 * una columna que NO vive en la tabla principal (ej. `nombre`/`correo` de un
 * miembro de equipo, resueltos vía `usuarios` en una consulta aparte — ver
 * `obtenerEquipo` en `lib/staff/datos.ts`) y por lo tanto no se puede pasar a
 * `.order()` de Postgres directamente sin un embed. Para listas grandes
 * (subclientes, tenants) el orden SIEMPRE debe resolverse a nivel SQL
 * (`.order()` + `.range()`) — esta función es para listas chicas por
 * naturaleza (equipo de un tenant), nunca para reemplazar paginación SQL en
 * una tabla que puede crecer sin límite.
 */
export function ordenarEnMemoria<TFila>(
  filas: TFila[],
  obtenerValor: (fila: TFila) => string | number | null | undefined,
  ascending: boolean,
  obtenerIdDesempate: (fila: TFila) => string,
): TFila[] {
  const factor = ascending ? 1 : -1;

  return [...filas].sort((a, b) => {
    const va = obtenerValor(a);
    const vb = obtenerValor(b);
    const aEsNulo = va === null || va === undefined;
    const bEsNulo = vb === null || vb === undefined;

    if (aEsNulo && bEsNulo) return compararDesempate(a, b, obtenerIdDesempate);
    if (aEsNulo) return 1;
    if (bEsNulo) return -1;
    if (va === vb) return compararDesempate(a, b, obtenerIdDesempate);
    return va > vb ? factor : -factor;
  });
}

function compararDesempate<TFila>(a: TFila, b: TFila, obtenerIdDesempate: (fila: TFila) => string): number {
  const ia = obtenerIdDesempate(a);
  const ib = obtenerIdDesempate(b);
  if (ia === ib) return 0;
  return ia > ib ? 1 : -1;
}
