/**
 * Paginación genérica (server-driven, sin estado de cliente): módulo puro y
 * testeable, sin dependencias de Next/Supabase, pensado para ser el PATRÓN
 * GENERAL de toda lista paginada del sitio (hoy: Equipo — miembros e
 * invitaciones; mañana: paquetes, subclientes, facturas). Nada de esto sabe
 * nada de la forma de la fila — solo números y query params.
 *
 * Flujo esperado (ver `app/(app)/configuracion/equipo/page.tsx` para el caso
 * de referencia):
 *   1. La página (Server Component) parsea el query param crudo con
 *      `parsearPagina()` — nunca confía en que sea un entero >= 1.
 *   2. La capa de datos (`lib/staff/datos.ts`) recibe esa página ya parseada,
 *      arma el rango con `calcularRango()` y lo pasa a `.range()` de
 *      Supabase junto con `{ count: "exact" }`; devuelve `{ filas, total }`.
 *   3. La página vuelve a usar `calcularTotalPaginas()` + `clampPagina()`
 *      para lo que se MUESTRA en el control `<Paginacion>` (indicador
 *      "Página X de Y" y habilitación de Anterior/Siguiente) — si la página
 *      pedida cae fuera de rango (ej. alguien edita la URL a mano a
 *      `?pagina=999`), la lista de filas queda vacía para esa página (el
 *      `.range()` de Supabase simplemente no matchea nada) pero el
 *      indicador SIEMPRE muestra un rango válido y consistente con `total`,
 *      y ningún link de Anterior/Siguiente generado por `<Paginacion>` puede
 *      llevar fuera de rango — no hace falta una segunda consulta para
 *      corregir la página antes de consultar.
 *   4. `construirHrefPagina()` arma el `href` de cada link de paginación
 *      preservando el resto de los query params de la URL (en particular el
 *      param de paginación de la OTRA lista de la misma pantalla).
 */

/** Tamaño de página por defecto para toda lista nueva del sitio (salvo que la pantalla pida otro explícitamente). */
export const TAMANO_PAGINA_DEFECTO = 20;

export interface RangoPaginacion {
  /** Índice (0-based, inclusive) del primer registro — 1er argumento de `.range()`. */
  desde: number;
  /** Índice (0-based, inclusive) del último registro — 2do argumento de `.range()`. */
  hasta: number;
}

/**
 * Parseo seguro de un query param de página: acepta el valor crudo tal como
 * llega de `searchParams` (string, array si el param viene repetido, o
 * `undefined` si no vino). Cualquier valor no numérico, no entero, o menor a
 * 1 cae al default (1) — NUNCA se propaga un número negativo/NaN/decimal río
 * abajo hacia una query real.
 */
export function parsearPagina(valor: string | string[] | undefined, porDefecto = 1): number {
  const crudo = Array.isArray(valor) ? valor[0] : valor;
  if (crudo === undefined || crudo === "") return porDefecto;

  const numero = Number(crudo);
  if (!Number.isInteger(numero) || numero < 1) return porDefecto;

  return numero;
}

/**
 * Parseo seguro de un query param de TAMAÑO de página (ej. `?tam=`) contra
 * una whitelist server-side — mismo espíritu que `parsearPagina`, pero la
 * whitelist de valores válidos vive en CADA pantalla (fuente de verdad
 * server-side, distinta pantalla puede ofrecer distintas opciones — ver
 * `TAMANOS_PAGINA_*` en cada `page.tsx`). Cualquier valor fuera de
 * `opciones` (o ausente/no numérico) cae a `porDefecto` — nunca se propaga
 * un tamaño arbitrario a `.range()`/`.slice()`.
 */
export function parsearTamanoPagina(
  valor: string | string[] | undefined,
  opciones: readonly number[],
  porDefecto: number = TAMANO_PAGINA_DEFECTO,
): number {
  const crudo = Array.isArray(valor) ? valor[0] : valor;
  const numero = Number(crudo);
  return opciones.includes(numero) ? numero : porDefecto;
}

/**
 * Rango (0-based, inclusive) para `.range(desde, hasta)` de Supabase, dada
 * una página 1-based y un tamaño.
 *
 * `Number.isFinite` ANTES de `Math.max`/`Math.trunc` (hallazgo de ronda de
 * revisión, tarea 2.1): `Math.max(1, Math.trunc(NaN))` da `NaN` — a
 * diferencia de negativos/0/decimales, que `Math.max`/`Math.trunc` sí
 * sanean solos, un `NaN` los "envenena" (cualquier comparación con `NaN` da
 * `false`, así que `Math.max` nunca lo descarta) y se propagaba tal cual a
 * `.range(NaN, NaN)`. En la práctica, todo caller de este proyecto ya limpia
 * la página con `parsearPagina()`/`clampPagina()` antes de llegar acá (ninguno
 * de los dos deja pasar `NaN`), pero esta función no debe depender de que
 * SIEMPRE la llamen así — es la única capa que arma el argumento real de
 * `.range()`, y debe ser segura por sí misma.
 */
export function calcularRango(pagina: number, tamano: number = TAMANO_PAGINA_DEFECTO): RangoPaginacion {
  const paginaSegura = Number.isFinite(pagina) ? Math.max(1, Math.trunc(pagina)) : 1;
  const tamanoSeguro = Number.isFinite(tamano) ? Math.max(1, Math.trunc(tamano)) : TAMANO_PAGINA_DEFECTO;
  const desde = (paginaSegura - 1) * tamanoSeguro;
  return { desde, hasta: desde + tamanoSeguro - 1 };
}

/** Total de páginas para `total` registros con `tamano` filas por página. Nunca menor a 1 (una lista vacía sigue teniendo "página 1"). */
export function calcularTotalPaginas(total: number, tamano: number = TAMANO_PAGINA_DEFECTO): number {
  if (!Number.isFinite(total) || total <= 0) return 1;
  const tamanoSeguro = Math.max(1, Math.trunc(tamano));
  return Math.max(1, Math.ceil(total / tamanoSeguro));
}

/** Ajusta `pagina` al rango `[1, totalPaginas]` — para lo que se MUESTRA en el control de paginación, nunca para lo que se consulta. */
export function clampPagina(pagina: number, totalPaginas: number): number {
  const totalSeguro = Math.max(1, Math.trunc(totalPaginas));
  if (!Number.isFinite(pagina)) return 1;
  const entero = Math.trunc(pagina);
  if (entero < 1) return 1;
  if (entero > totalSeguro) return totalSeguro;
  return entero;
}

/**
 * Arma el `href` de un link de paginación sobre `basePath`, preservando
 * TODOS los demás query params de la URL actual (en particular el param de
 * paginación de la otra lista de la misma pantalla) y solo reemplazando
 * `parametro` por `pagina`. Si `pagina` es 1, el param se OMITE de la URL
 * (una página 1 "limpia" es más prolijo y evita `?paginaMiembros=1` en el
 * link por defecto).
 */
export function construirHrefPagina(
  basePath: string,
  searchParamsActuales: Record<string, string | string[] | undefined>,
  parametro: string,
  pagina: number,
): string {
  const params = new URLSearchParams();

  for (const [clave, valor] of Object.entries(searchParamsActuales)) {
    if (valor === undefined) continue;
    if (Array.isArray(valor)) {
      for (const v of valor) params.append(clave, v);
    } else {
      params.set(clave, valor);
    }
  }

  if (pagina <= 1) {
    params.delete(parametro);
  } else {
    params.set(parametro, String(pagina));
  }

  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
}
