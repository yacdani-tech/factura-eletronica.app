"use client";

import * as React from "react";
import { ArrowLeft } from "lucide-react";

import { cn } from "@factura/core/utils";
import { textosListas } from "../textos";

export interface DetalleListaMobileProps {
  /** Controlado por el padre (wrapper de fila) — mismo criterio que `expandido` en `GrupoFacturacion`. */
  abierto: boolean;
  onCerrar: () => void;
  /** Título del header (se trunca a una línea). */
  titulo: React.ReactNode;
  /** `id` del nodo — lo usa `TarjetaListaMobile` para su `aria-controls`. */
  id: string;
  /** Slot opcional a la derecha del header (ej. un popover de info — mismo lugar que `popoverDesglose` en `grupo-facturacion.tsx`). */
  accesorioHeader?: React.ReactNode;
  children: React.ReactNode;
  /** Pie opcional, fuera del cuerpo con scroll (ej. acciones fijas al fondo). Si no se pasa, las acciones van dentro del cuerpo (ver `FilaSubclienteMobile`). */
  pie?: React.ReactNode;
  className?: string;
}

/** Selector estándar de elementos "tabulables" — mismo criterio que usan las libs de focus-trap habituales. */
const SELECTOR_FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Focusables VISIBLES (renderizados) dentro de `contenedor`, en orden de documento. */
function obtenerElementosFocosables(contenedor: HTMLElement): HTMLElement[] {
  return Array.from(contenedor.querySelectorAll<HTMLElement>(SELECTOR_FOCUSABLE)).filter(
    (nodo) => !nodo.hasAttribute("inert") && nodo.getClientRects().length > 0,
  );
}

/**
 * Detalle full-screen de UNA fila de lista en mobile — primitivo COMPARTIDO
 * (feature "Listas responsive", Fase 0). Espeja el overlay de
 * `GrupoFacturacion` (`components/facturacion/grupo-facturacion.tsx:411-434`),
 * con una diferencia deliberada: acá SIEMPRE es `sm:hidden` (en desktop manda
 * la tabla — nunca se muestra inline, a diferencia de Facturación).
 *
 * **Es un `<div>` plano con CSS, NO un Radix `Dialog`/`Sheet`** — decisión
 * crítica (aprendizaje 2026-08-04): un segundo `hideOthers()`/scroll-lock
 * anidado dentro de otra capa Radix (los `DropdownMenu`/`Select` que abren los
 * islotes de acciones reusados, ej. `AccionesSubcliente`) puede dejar
 * `aria-hidden="true"` pegado en el fondo tras un doble Escape. Con un `div`
 * plano, la ÚNICA capa Radix activa en cualquier momento es la del diálogo
 * interno que el usuario abra — sin riesgo de refcounts cruzados.
 *
 * El nodo del DOM está SIEMPRE montado (regla dura #14: no se desmonta al
 * cerrar, así el estado de los hijos —un formulario a medio completar—
 * sobrevive). `hidden={!abierto}` se mantiene por accesibilidad/testing, la
 * clase de display es condicional porque `[hidden]{display:none}` del
 * user-agent pierde contra una clase de autor con la misma especificidad.
 *
 * Gestión de foco MANUAL (al no ser Radix): al abrir, foco a la flecha de
 * volver; `Escape` cierra; al cerrar, se devuelve el foco al elemento que
 * disparó la apertura (capturado con `document.activeElement`).
 *
 * **Focus-trap dentro del overlay** (hallazgo de accesibilidad del revisor,
 * 2026-08-05): con Tab/Shift+Tab el foco NUNCA debe salir del overlay hacia
 * la tarjeta colapsada ni las filas hermanas — que siguen montadas, sin
 * `inert`, tapadas visualmente detrás (`fixed inset-0 z-50`) mientras dura el
 * detalle. El trap se implementa con `onKeyDown` SINTÉTICO de React en el
 * `<div>` raíz (NO un `document.addEventListener`) a propósito: los
 * controles Radix internos que este detalle puede alojar (Dialog de editar,
 * DropdownMenu de acciones, Select) montan su PROPIO focus-trap
 * (`@radix-ui/react-focus-scope`) sobre contenido PORTALADO a
 * `document.body` — físicamente fuera del DOM del overlay, pero DENTRO del
 * árbol de React (los portales de React burbujean eventos por el árbol de
 * fibras, no por el DOM), así que el `onKeyDown` de Radix —más interno—
 * corre primero y el de acá después. Este handler chequea
 * `overlay.contains(document.activeElement)` ANTES de actuar: mientras el
 * foco está dentro de un control Radix portalado, esa condición da `false` y
 * el trap de acá se desactiva por completo (no compite con el de Radix);
 * apenas el control se cierra y el foco vuelve al overlay, el trap retoma
 * solo. Los elementos focusables se recalculan en cada Tab (no se cachean)
 * consultando el DOM real del overlay (`querySelectorAll`), filtrando
 * `disabled`/`inert`/no-renderizados (`getClientRects().length === 0`).
 */
export function DetalleListaMobile({
  abierto,
  onCerrar,
  titulo,
  id,
  accesorioHeader,
  children,
  pie,
  className,
}: DetalleListaMobileProps) {
  const botonVolverRef = React.useRef<HTMLButtonElement>(null);
  const overlayRef = React.useRef<HTMLDivElement>(null);
  const elementoDisparadorRef = React.useRef<HTMLElement | null>(null);

  React.useEffect(() => {
    if (!abierto) return undefined;
    elementoDisparadorRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // El foco se mueve tras el paint siguiente: recién ahí el nodo dejó de
    // tener `hidden` y es efectivamente focusable.
    const idFrame = window.requestAnimationFrame(() => botonVolverRef.current?.focus());
    return () => window.cancelAnimationFrame(idFrame);
  }, [abierto]);

  React.useEffect(() => {
    if (abierto) return undefined;
    const disparador = elementoDisparadorRef.current;
    elementoDisparadorRef.current = null;
    disparador?.focus();
    return undefined;
  }, [abierto]);

  React.useEffect(() => {
    if (!abierto) return undefined;
    function alTeclado(evento: KeyboardEvent) {
      if (evento.key !== "Escape") return;
      // Si hay un control Radix interno abierto (Dialog/DropdownMenu/Select),
      // su `DismissableLayer` instala un listener nativo en `document` con
      // `{capture:true}` y llama `event.preventDefault()` al descartarse — la
      // fase de captura de un mismo target SIEMPRE corre completa antes que
      // la fase de burbuja del MISMO target, así que para cuando este
      // listener (burbuja, sin `capture`) se ejecuta, `defaultPrevented` ya
      // es `true` si Radix consumió el Escape. Verificado en vivo (Playwright)
      // contra Dialog, DropdownMenu y Select — los 3 primitivos que puede
      // alojar un detalle mobile.
      if (evento.defaultPrevented) return;
      evento.preventDefault();
      onCerrar();
    }
    document.addEventListener("keydown", alTeclado);
    return () => document.removeEventListener("keydown", alTeclado);
  }, [abierto, onCerrar]);

  function atraparTab(evento: React.KeyboardEvent<HTMLDivElement>) {
    if (evento.key !== "Tab" || evento.defaultPrevented) return;
    const overlay = overlayRef.current;
    const activo = document.activeElement;
    if (!overlay || !(activo instanceof HTMLElement) || !overlay.contains(activo)) {
      // El foco está dentro de un control Radix portalado a `document.body`
      // (Dialog/DropdownMenu/Select abierto desde este detalle) — ese
      // control ya trae su propio focus-trap; no interferir.
      return;
    }
    const focosables = obtenerElementosFocosables(overlay);
    if (focosables.length === 0) return;
    const primero = focosables[0];
    const ultimo = focosables[focosables.length - 1];
    if (evento.shiftKey) {
      if (activo === primero) {
        evento.preventDefault();
        ultimo.focus();
      }
    } else if (activo === ultimo) {
      evento.preventDefault();
      primero.focus();
    }
  }

  return (
    <div
      id={id}
      ref={overlayRef}
      hidden={!abierto}
      onKeyDown={atraparTab}
      className={cn(
        abierto ? "flex flex-col" : "hidden",
        "sm:hidden",
        abierto && "max-sm:fixed max-sm:inset-0 max-sm:z-50 max-sm:overflow-y-auto max-sm:bg-background",
        className,
      )}
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <button
          ref={botonVolverRef}
          type="button"
          onClick={onCerrar}
          aria-label={textosListas.detalleVolver}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="h-5 w-5" aria-hidden="true" />
        </button>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{titulo}</span>
        {accesorioHeader}
      </div>

      <div className="flex flex-1 flex-col gap-4 p-3">{children}</div>

      {pie && <div className="shrink-0 border-t border-border p-3">{pie}</div>}
    </div>
  );
}
