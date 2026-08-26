/**
 * Textos TRANSVERSALES de listas (ítems 1+3+4+6 del lote de Yac 2026-07-18):
 * usados por el componente reusable `EncabezadoOrdenable`
 * (`components/ui/encabezado-ordenable.tsx`) y por la celda de nota truncada
 * (`components/ui/texto-truncado-con-tooltip.tsx`) en CUALQUIER lista del
 * sitio. Centralizado acá (mismo patrón que `lib/textos/paginacion.ts`) para
 * no duplicar el mismo string en subclientes/tenants/equipo.
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
   * (`components/listas/`) en CUALQUIER lista del sitio (subclientes,
   * paquetes, consolidados, equipo, tenants, rutas/zonas, modelos de entrega).
   */
  /** `aria-label` del botón de volver del detalle full-screen mobile. */
  detalleVolver: "Volver",
  /** `aria-label` del botón que abre el detalle full-screen de una tarjeta mobile — `nombre` identifica la fila (nombre, identificador, etc.). */
  abrirDetalle: (nombre: string) => `Ver detalle de ${nombre}`,
} as const;
