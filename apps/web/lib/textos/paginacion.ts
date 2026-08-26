/**
 * Textos del control de paginación genérico (`components/ui/paginacion.tsx`)
 * — reutilizable en toda lista paginada del sitio (Equipo hoy; paquetes/
 * subclientes/facturas después). Centralizados acá (mismo patrón que
 * `lib/textos/staff.ts`/`lib/textos/permisos.ts`), en español CR con voseo.
 */

/**
 * Separador de miles para el texto "N resultados" (decisión de Yac
 * 2026-07-30: el total nunca se muestra "en bruto"). Sin decimales — es un
 * CONTEO de filas, no un monto (distinto de `formatearMontoLocal`, que sí
 * depende del catálogo de monedas).
 *
 * A propósito NO usa `Intl.NumberFormat("es-CR")`: en Node con ICU completo
 * ese locale agrupa con NBSP (U+00A0), no con un punto — mismo defecto ya
 * documentado en CLAUDE.md (2026-07-24/29, "nunca asumir el carácter
 * separador de un `Intl.*`"). Yac aprobó explícitamente el punto como
 * separador ("1.234 resultados"), así que se agrupa a mano con una regexp,
 * garantizando el carácter sin depender del locale del entorno.
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
  /** Texto `sr-only` que acompaña al spinner cuando la página nueva se está cargando tras tocar Anterior/Siguiente (feedback de navegación, ver `ContenidoBotonPagina`). */
  cargando: "Cargando…",
  /** aria-label del `<nav>` que envuelve los controles — recibe una etiqueta de la lista (ej. "miembros", "invitaciones") para que sea distinguible si hay varias listas paginadas en la misma pantalla. */
  navegacion: (etiquetaLista: string) => `Paginación de ${etiquetaLista}`,
  indicador: (paginaActual: number, totalPaginas: number) => `Página ${paginaActual} de ${totalPaginas}`,
  /**
   * Total de registros del set FILTRADO (`count: "exact"` que ya calcula la
   * capa de datos — NUNCA recalculado en la UI, ver `TotalResultados`) — se
   * muestra a la par del selector "Filas por página" en toda lista paginada
   * del sitio (decisión de Yac 2026-07-30). Singular exacto sin separador de
   * miles ("1 resultado"); plural con separador de miles con PUNTO ("1.234
   * resultados", ver `formatearMiles`).
   */
  resultados: (total: number) => (total === 1 ? "1 resultado" : `${formatearMiles(total)} resultados`),
} as const;
