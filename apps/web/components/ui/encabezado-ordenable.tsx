import Link from "next/link";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

import { TableHead } from "@/components/ui/table";
import { construirHrefOrden, type OpcionesHrefOrden } from "@factura/core/href-orden";
import { textosListas } from "@/lib/textos/listas";
import { cn } from "@factura/core/utils";
import type { Direccion, OrdenListado } from "@factura/core/listas";

export interface EncabezadoOrdenableProps<TColumna extends string> extends OpcionesHrefOrden {
  /** Columna que este encabezado ordena (debe estar en la whitelist ordenable de la entidad — ver `lib/listas.ts`). */
  columna: TColumna;
  /** Texto visible del encabezado (ej. "Nombre", "Fecha de creación"). */
  etiqueta: string;
  /** Orden EFECTIVO ya resuelto de la lista (`resolverOrden(...).pedido` — server-side, con el default ya aplicado). */
  ordenActual: OrdenListado<TColumna>;
  /** Ruta (pathname) sobre la que se arman los links — mismo criterio que `<Paginacion>`. */
  basePath: string;
  /** `searchParams` actuales de la URL — se preservan al navegar (ver `construirHrefOrden`). */
  searchParams: Record<string, string | string[] | undefined>;
  className?: string;
  /**
   * Texto completo para el `title` (tooltip nativo del navegador) — para
   * cuando `etiqueta` viene ABREVIADA por espacio (ej. "Creado" con
   * `tituloCompleto="Fecha de creación"`, ver `/paquetes`). `undefined` = sin
   * tooltip (caso normal: la mayoría de columnas ya muestran su texto
   * completo).
   */
  tituloCompleto?: string;
  /**
   * Densidad COMPACTA (padding/alto del encabezado reducidos) — opt-in POR
   * TABLA (ej. `/paquetes`, que con muchas columnas desborda a 1280px, ver
   * `TablaPaquetes`), nunca el default global: el resto de listas del sitio
   * (subclientes, tenants, miembros, invitaciones) sigue con el tamaño
   * normal (`h-11 px-3`) sin tocar una sola línea de su código. Default:
   * `false`.
   */
  compacto?: boolean;
}

/**
 * Encabezado de columna ORDENABLE (ítem 1 del lote de Yac 2026-07-18):
 * componente reusable para TODA lista del sitio con columnas ordenables
 * (subclientes, consola de tenants, miembros, invitaciones). Server Component
 * puro — un link de navegación real (mismo espíritu que `<Paginacion>`), sin
 * estado de cliente: cada click es una nueva request de servidor que
 * re-resuelve `orden`/`dir` vía `resolverOrden` (`lib/listas.ts`) y vuelve a
 * pintar la tabla ya ordenada.
 *
 * Comportamiento de click: si la columna NO es la activa, ordena ASC (primer
 * click siempre ascendente); si ya es la activa, ALTERNA la dirección
 * (asc↔desc) — nunca hay un tercer estado "sin orden" para una columna
 * individual, siempre queda alguna columna activa (la que sea, por default
 * `creadoEn` DESC).
 *
 * Indicador visual: `ArrowUp`/`ArrowDown` (verde-oscuro vía `text-foreground`,
 * NUNCA solo color — el ícono ya es la señal, más `aria-sort` en el `<th>`
 * para lectores de pantalla) cuando la columna está activa; `ArrowUpDown`
 * atenuado (`text-muted-foreground/60`) cuando no lo está, para comunicar que
 * IGUAL es ordenable. Tap target: el link ocupa el alto completo de la celda
 * (`h-11` = 44px, mismo tamaño que `TableHead` por defecto) y todo su ancho.
 *
 * NUNCA se usa para la columna de acciones (excepción explícita del ítem 1) —
 * esa sigue siendo un `<TableHead>` plano en cada tabla.
 */
export function EncabezadoOrdenable<TColumna extends string>({
  columna,
  etiqueta,
  ordenActual,
  basePath,
  searchParams,
  paramOrden,
  paramDireccion,
  paramPagina,
  className,
  tituloCompleto,
  compacto = false,
}: EncabezadoOrdenableProps<TColumna>) {
  const activa = ordenActual.columna === columna;
  const direccionNueva: Direccion = activa && ordenActual.direccion === "asc" ? "desc" : "asc";
  const href = construirHrefOrden(basePath, searchParams, columna, direccionNueva, {
    paramOrden,
    paramDireccion,
    paramPagina,
  });

  const Icono = activa ? (ordenActual.direccion === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  const ariaSort: "ascending" | "descending" | "none" = !activa
    ? "none"
    : ordenActual.direccion === "asc"
      ? "ascending"
      : "descending";

  return (
    <TableHead aria-sort={ariaSort} className={cn("p-0", className)}>
      <Link
        href={href}
        title={tituloCompleto}
        aria-label={textosListas.ordenar(tituloCompleto ?? etiqueta, direccionNueva)}
        className={cn(
          "flex w-full items-center text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          compacto ? "h-9 gap-1 px-2" : "h-11 gap-1.5 px-3",
        )}
      >
        <span>{etiqueta}</span>
        <Icono
          className={cn("h-3.5 w-3.5 shrink-0", activa ? "text-foreground" : "text-muted-foreground/60")}
          aria-hidden="true"
        />
      </Link>
    </TableHead>
  );
}
