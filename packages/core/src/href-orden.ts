/**
 * Arma el `href` de un link de encabezado ORDENABLE (`EncabezadoOrdenable`,
 * `components/ui/encabezado-ordenable.tsx` — ítem 1 del lote de Yac
 * 2026-07-18: "encabezados de columna ordenables en todas las listas").
 * Módulo puro, sin dependencias de Next/Supabase (mismo criterio que
 * `lib/paginacion.ts`/`lib/listas.ts`) — arma la URL, nunca decide qué
 * columnas son válidas (eso es 100% responsabilidad de `resolverOrden` en
 * `lib/listas.ts`, ya cerrado — este módulo es puramente UI).
 *
 * Mismo patrón que `construirHrefPagina` (`lib/paginacion.ts`): preserva
 * TODOS los demás query params de la URL actual (filtros, paginación de OTRA
 * lista de la misma pantalla) y solo reemplaza los params de orden — más el
 * de paginación de ESTA lista, si se pasa `paramPagina`, que se OMITE del
 * href resultante (cambiar de orden siempre vuelve a la página 1 de esa
 * lista, mismo criterio que cambiar un filtro en `FiltrosSubclientes`).
 *
 * Nombres de query param NO son siempre `orden`/`dir`: en pantallas con más
 * de una lista independiente (ej. Equipo — miembros e invitaciones, mismo
 * criterio que `paginaMiembros`/`paginaInvitaciones` en `lib/paginacion.ts`)
 * cada lista usa el suyo (`ordenMiembros`/`dirMiembros`,
 * `ordenInvitaciones`/`dirInvitaciones` — ver `lib/staff/datos.ts`,
 * `OpcionesObtenerEquipo`). Por eso `paramOrden`/`paramDireccion` son
 * configurables, con default `"orden"`/`"dir"` para el caso general de una
 * sola lista por pantalla (subclientes, consola de tenants).
 */

export interface OpcionesHrefOrden {
  /** Nombre del query param de columna. Default: `"orden"`. */
  paramOrden?: string;
  /** Nombre del query param de dirección. Default: `"dir"`. */
  paramDireccion?: string;
  /** Nombre del query param de PAGINACIÓN de esta misma lista — si se pasa, se omite del href (vuelve a la página 1). */
  paramPagina?: string;
}

/**
 * Arma el href para pedir `columna`/`direccion` sobre `basePath`, preservando
 * el resto de los `searchParamsActuales` (excepto los propios params de orden
 * y, si se pasa, el de paginación de esta lista).
 */
export function construirHrefOrden(
  basePath: string,
  searchParamsActuales: Record<string, string | string[] | undefined>,
  columna: string,
  direccion: "asc" | "desc",
  opciones: OpcionesHrefOrden = {},
): string {
  const { paramOrden = "orden", paramDireccion = "dir", paramPagina } = opciones;
  const params = new URLSearchParams();

  for (const [clave, valor] of Object.entries(searchParamsActuales)) {
    if (valor === undefined) continue;
    if (clave === paramOrden || clave === paramDireccion || clave === paramPagina) continue;
    if (Array.isArray(valor)) {
      for (const v of valor) params.append(clave, v);
    } else {
      params.set(clave, valor);
    }
  }

  params.set(paramOrden, columna);
  params.set(paramDireccion, direccion);

  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
}
