import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "./button";
import { ContenidoBotonPagina } from "./contenido-boton-pagina";
import { construirHrefPagina } from "@factura/core/paginacion";
import { textosPaginacion } from "./textos";

export interface PaginacionProps {
  /** Página actual (ya clampeada a `[1, totalPaginas]` por el caller — ver `lib/paginacion.ts`). */
  paginaActual: number;
  totalPaginas: number;
  /** Nombre del query param que esta lista controla (ej. `"paginaMiembros"`, `"paginaInvitaciones"`) — cada lista de una pantalla usa el suyo para no interferirse entre sí. */
  parametro: string;
  /** Ruta (pathname) sobre la que se arman los links. */
  basePath: string;
  /** `searchParams` actuales de la URL — se preservan al navegar (incluye el param de paginación de OTRAS listas de la misma pantalla). */
  searchParams: Record<string, string | string[] | undefined>;
  /** Etiqueta de la lista para el aria-label del `<nav>` (ej. "miembros"). */
  etiquetaLista: string;
  /**
   * `true` fuerza a mostrar el control INCLUSO con una sola página (decisión
   * de Yac 2026-07-29 para `/subclientes`: "la paginación nunca puede
   * desaparecer"). En ese caso se ve "Página 1 de 1" con ambos botones
   * deshabilitados. Default `false` (comportamiento histórico: se oculta con
   * ≤1 página — el que sigue usando `/paquetes`, equipo, soporte, etc.).
   */
  siempreVisible?: boolean;
}

/**
 * Layout ícono+texto del CONTENIDO de cada botón (Anterior/Siguiente) — se
 * aplica EXPLÍCITAMENTE tanto en el `<span>` (estado deshabilitado, `Comp`
 * nativo `<button>`) como en el `<Link>` (estado habilitado, vía
 * `asChild`/Radix `Slot`).
 *
 * Causa raíz del bug de superposición: las clases flex/gap del `Button`
 * (`buttonVariants`) actúan sobre SU hijo directo, que acá es SIEMPRE un
 * único elemento (el `<span>` o el `<Link>`) — con un solo hijo, `gap-2`
 * no tiene nada entre qué poner espacio. En el estado HABILITADO, Radix
 * `Slot` sí termina fusionando esas clases sobre el `<Link>` (que renderiza
 * `<a>`), así que el ícono y el texto — hijos DIRECTOS de esa ancla — quedan
 * en fila con gap. Pero en el estado DESHABILITADO el hijo es un `<span>`
 * plano (no pasa por `Slot`) que NUNCA recibe ese flex/gap: ícono y texto
 * caen en flujo inline por defecto, pegados sin espacio — con el `viewBox`
 * del ícono y el `line-height` del texto, visualmente se leen encimados.
 * Por eso el bug aparecía justo en "Anterior" (deshabilitado en la página 1,
 * el caso por defecto) y no en "Siguiente". Fix: darle a AMBOS (span y Link)
 * su propio `inline-flex items-center gap-2`, sin depender de qué clases
 * decida fusionar `Slot` — layout garantizado sea cual sea el elemento raíz.
 */
const CONTENIDO_BOTON = "inline-flex items-center justify-center gap-2 whitespace-nowrap";

/**
 * Control de paginación GENÉRICO y reutilizable — Server Component puro (los
 * links son navegación real vía `searchParams`, sin estado de cliente; cada
 * click es una nueva request de servidor que re-ejecuta la página con la
 * página pedida). Pensado como el PATRÓN GENERAL de toda lista paginada del
 * sitio: no sabe nada de la forma de los datos, solo de números de página.
 *
 * Se oculta por completo (devuelve `null`) cuando hay una sola página — no
 * tiene sentido mostrar controles de navegación para una lista que entera
 * cabe en una página. EXCEPCIÓN: `siempreVisible` (opt-in) lo mantiene en
 * pantalla como "Página 1 de 1" con ambos botones deshabilitados (ver esa
 * prop) — para pantallas donde el control nunca debe desaparecer.
 *
 * Responsive: el `<nav>` es `flex flex-wrap` — en contenedores angostos
 * (celular, o el shell hoy sin sidebar colapsable) el indicador "Página X de
 * Y" y el par de botones se acomodan en su propia línea en vez de
 * desbordar o recortarse. Los botones nunca se angostan por debajo de su
 * contenido (`shrink-0`): el `flex-wrap` del padre es lo que absorbe el
 * espacio faltante, no la compresión del botón.
 */
export function Paginacion({
  paginaActual,
  totalPaginas,
  parametro,
  basePath,
  searchParams,
  etiquetaLista,
  siempreVisible = false,
}: PaginacionProps) {
  if (totalPaginas <= 1 && !siempreVisible) return null;

  const puedeAnterior = paginaActual > 1;
  const puedeSiguiente = paginaActual < totalPaginas;

  return (
    <nav
      aria-label={textosPaginacion.navegacion(etiquetaLista)}
      className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2 pt-3"
    >
      <span className="text-sm text-muted-foreground">
        {textosPaginacion.indicador(paginaActual, totalPaginas)}
      </span>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={!puedeAnterior}
          asChild={puedeAnterior}
          className="shrink-0"
        >
          {puedeAnterior ? (
            <Link
              href={construirHrefPagina(basePath, searchParams, parametro, paginaActual - 1)}
              className={CONTENIDO_BOTON}
            >
              <ContenidoBotonPagina direccion="anterior" />
            </Link>
          ) : (
            <span className={CONTENIDO_BOTON}>
              <ChevronLeft aria-hidden="true" />
              {textosPaginacion.anterior}
            </span>
          )}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!puedeSiguiente}
          asChild={puedeSiguiente}
          className="shrink-0"
        >
          {puedeSiguiente ? (
            <Link
              href={construirHrefPagina(basePath, searchParams, parametro, paginaActual + 1)}
              className={CONTENIDO_BOTON}
            >
              <ContenidoBotonPagina direccion="siguiente" />
            </Link>
          ) : (
            <span className={CONTENIDO_BOTON}>
              {textosPaginacion.siguiente}
              <ChevronRight aria-hidden="true" />
            </span>
          )}
        </Button>
      </div>
    </nav>
  );
}
