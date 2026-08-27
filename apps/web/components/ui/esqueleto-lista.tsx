import { cn } from "@factura/core/utils";

/**
 * Piezas de skeleton COMPARTIDAS por los `loading.tsx` de las pantallas de
 * lista/formulario del app shell (consolidados, paquetes, subclientes,
 * equipo, configuración…) — evita repetir el mismo patrón
 * `animate-pulse bg-muted` en cada archivo. Mismo estilo que el primer
 * `loading.tsx` del proyecto (`app/(app)/soporte/loading.tsx`).
 *
 * Server Components puros (sin `"use client"`): un `loading.tsx` de Next se
 * renderiza en el servidor mientras el Server Component real resuelve, así
 * que estas piezas no necesitan interactividad ni estado propio.
 *
 * El `role="status"`/`aria-label="Cargando"` (una sola región anunciada por
 * pantalla, no por pieza) vive en el `<div>` raíz de CADA `loading.tsx`, no
 * acá — para que una pantalla que combina varias de estas piezas (ej.
 * `/configuracion/equipo`, con dos listas) no duplique la región ARIA.
 */

/** Fila del skeleton de la barra de filtros (`BarraFiltrosSheet`): input de búsqueda (ocupa el espacio libre) + botón "Filtros". */
export function EsqueletoBarraFiltros() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="h-10 min-w-[200px] flex-1 animate-pulse rounded-md bg-muted" />
      <div className="h-10 w-28 shrink-0 animate-pulse rounded-md bg-muted" />
    </div>
  );
}

/**
 * Una fila de tabla: varias barras de ancho distinto simulando columnas.
 * `anchos` son clases de Tailwind ya completas (`w-*` o `flex-1`), en el
 * orden en que deben pintarse — cada pantalla pasa una aproximación de sus
 * propias columnas (ver los `loading.tsx` que la consumen).
 */
export function EsqueletoFilaTabla({ anchos = ["w-8", "flex-1", "w-20", "w-16"] }: { anchos?: string[] }) {
  return (
    <div className="flex h-12 items-center gap-4 border-b border-border/60 px-1 last:border-b-0">
      {anchos.map((ancho, i) => {
        // "flex-1" (la columna "ancha", ej. nombre) NO lleva `shrink-0` —
        // shrink-0 + flex-1 en el MISMO elemento son clases en conflicto
        // (`flex-1` ya define su propio `flex-shrink: 1`); todas las demás
        // (`w-*`, ancho fijo) sí lo llevan para no achicarse dentro del
        // wrapper con scroll horizontal (`EsqueletoFilasTabla`).
        const esFlexible = ancho === "flex-1";
        return (
          <div
            key={i}
            className={cn(
              "h-4 animate-pulse rounded bg-muted",
              esFlexible ? "min-w-[40px]" : "shrink-0",
              ancho,
            )}
          />
        );
      })}
    </div>
  );
}

/**
 * `cantidad` filas de `EsqueletoFilaTabla` seguidas, mismas `anchos` para
 * todas (una tabla real tiene todas sus filas con las mismas columnas).
 *
 * `overflow-x-auto`: mismo contrato que el wrapper real de `<Table>`
 * (`components/ui/table.tsx`, `"relative w-full overflow-auto"`) — con
 * varias columnas de ancho fijo (`shrink-0`) la fila suma más de lo que
 * entra en un viewport de 375px; sin este wrapper ese desborde se filtraría
 * al documento entero (violaría "un solo scroll, el del navegador" y el
 * check de "sin desborde horizontal a 375px"). Acá el scroll queda ACOTADO
 * a esta región, igual que en una tabla real con muchas columnas.
 */
export function EsqueletoFilasTabla({ cantidad = 8, anchos }: { cantidad?: number; anchos?: string[] }) {
  return (
    <div className="w-full overflow-x-auto">
      <div className="flex min-w-fit flex-col">
        {Array.from({ length: cantidad }).map((_, i) => (
          <EsqueletoFilaTabla key={i} anchos={anchos} />
        ))}
      </div>
    </div>
  );
}

/** Pie de una lista paginada: selector "Filas por página" + total (izquierda) + control Anterior/Siguiente (derecha) — mismo layout que arman `SelectorTamanoPagina` + `TotalResultados` + `Paginacion` juntos. */
export function EsqueletoPiePagina() {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 pt-1">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="h-9 w-40 animate-pulse rounded-md bg-muted" />
        <div className="h-4 w-24 animate-pulse rounded bg-muted" />
      </div>
      <div className="h-9 w-48 animate-pulse rounded-md bg-muted" />
    </div>
  );
}

/** Fila de acciones a la derecha del encabezado (ej. "Importar consolidado", "Nuevo paquete") — cada `ancho` es un botón. */
export function EsqueletoAccionesEncabezado({ anchos = ["w-40"] }: { anchos?: string[] }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-3">
      <div className="flex flex-wrap items-start gap-2">
        {anchos.map((ancho, i) => (
          <div key={i} className={cn("h-10 animate-pulse rounded-md bg-muted", ancho)} />
        ))}
      </div>
    </div>
  );
}

/** Un campo de formulario: label corta + input de ancho completo — usado por los `loading.tsx` de las pantallas de Configuración. */
export function EsqueletoCampoFormulario({ anchoInput = "w-full" }: { anchoInput?: string }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="h-3 w-24 animate-pulse rounded bg-muted" />
      <div className={cn("h-10 animate-pulse rounded-md bg-muted", anchoInput)} />
    </div>
  );
}

/**
 * Tarjeta de un ítem de lista tipo "fila con acciones" (`FilaRuta`/
 * `FilaModelo`): título + badge a la izquierda, 1-2 botones a la derecha, y
 * opcionalmente un bloque de contenido anidado debajo (zonas de una ruta,
 * plantilla de un modelo).
 */
export function EsqueletoTarjetaFila({ conContenido = false }: { conContenido?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-card p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="h-4 w-32 animate-pulse rounded bg-muted" />
          <div className="h-5 w-16 animate-pulse rounded-full bg-muted" />
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <div className="h-9 w-20 animate-pulse rounded-md bg-muted" />
          <div className="h-9 w-24 animate-pulse rounded-md bg-muted" />
        </div>
      </div>
      {conContenido && (
        <div className="mt-4 flex flex-col gap-2 border-t border-border pt-4">
          <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
          <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
        </div>
      )}
    </div>
  );
}
