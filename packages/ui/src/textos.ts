/**
 * Textos UI-genéricos del paquete `@factura/ui` (relocalizados desde
 * `apps/web/lib/textos/{listas,paginacion}.ts` al extraer el paquete de UI
 * compartida — Fase 3). Son cadenas 100 % transversales, sin lógica de
 * negocio ni dependencia hacia la app, usadas por los componentes reusables
 * de listas y paginación (`EncabezadoOrdenable`, `TextoTruncadoConTooltip`,
 * `TarjetaListaMobile`, `DetalleListaMobile`, `Paginacion`, `TotalResultados`,
 * `ContenidoBotonPagina`). Si un consumidor necesita texto específico de la
 * app, se pasa por PROP, nunca importando `@/lib/*` desde este paquete.
 */

export const textosListas = {
  /**
   * aria-label del link de cada encabezado ordenable — anuncia la ACCIÓN que
   * va a pasar al hacer click (no el estado actual, que ya lo comunica
   * `aria-sort` en el `<th>`). `direccionNueva` es la dirección a la que va a
   * quedar la columna DESPUÉS de este click.
   */
  ordenar: (etiquetaColumna: string, direccionNueva: "asc" | "desc") =>
    `Ordenar por ${etiquetaColumna}, ${direccionNueva === "asc" ? "ascendente" : "descendente"}`,
  /** Texto visible (`sr-only` en pantallas chicas si hiciera falta) para el botón que expande una nota truncada. */
  verNotaCompleta: "Ver nota completa",

  /**
   * Primitivos compartidos de listas responsive (feature "Listas responsive",
   * Fase 0, 2026-08-05) — usados por `TarjetaListaMobile`/`DetalleListaMobile`
   * en CUALQUIER lista del sitio.
   */
  /** `aria-label` del botón de volver del detalle full-screen mobile. */
  detalleVolver: "Volver",
  /** `aria-label` del botón que abre el detalle full-screen de una tarjeta mobile — `nombre` identifica la fila (nombre, identificador, etc.). */
  abrirDetalle: (nombre: string) => `Ver detalle de ${nombre}`,
} as const;

/**
 * Separador de miles para el texto "N resultados". Sin decimales — es un
 * CONTEO de filas, no un monto. A propósito NO usa `Intl.NumberFormat("es-CR")`
 * (agrupa con NBSP en Node con ICU completo): se agrupa a mano con una regexp
 * para garantizar el PUNTO como separador sin depender del locale del entorno.
 */
function formatearMiles(numero: number): string {
  const signo = numero < 0 ? "-" : "";
  const entero = Math.trunc(Math.abs(numero)).toString();
  const agrupado = entero.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${signo}${agrupado}`;
}

export const textosPaginacion = {
  anterior: "Anterior",
  siguiente: "Siguiente",
  /** Texto `sr-only` que acompaña al spinner cuando la página nueva se está cargando tras tocar Anterior/Siguiente. */
  cargando: "Cargando…",
  /** aria-label del `<nav>` que envuelve los controles — recibe una etiqueta de la lista para distinguir varias listas paginadas en la misma pantalla. */
  navegacion: (etiquetaLista: string) => `Paginación de ${etiquetaLista}`,
  indicador: (paginaActual: number, totalPaginas: number) => `Página ${paginaActual} de ${totalPaginas}`,
  /**
   * Total de registros del set FILTRADO (nunca recalculado en la UI). Singular
   * exacto sin separador ("1 resultado"); plural con separador de PUNTO
   * ("1.234 resultados", ver `formatearMiles`).
   */
  resultados: (total: number) => (total === 1 ? "1 resultado" : `${formatearMiles(total)} resultados`),
} as const;
