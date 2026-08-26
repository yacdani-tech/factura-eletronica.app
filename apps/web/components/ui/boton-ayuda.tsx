"use client";

import * as React from "react";
import { Info } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface BotonAyudaProps {
  /** Texto/contenido de ayuda que se revela al hacer click/tap sobre el ícono. */
  children: React.ReactNode;
  /**
   * Etiqueta accesible del botón (lo que anuncia el lector de pantalla al
   * enfocarlo) — una descripción corta de a qué campo/opción ayuda. Es
   * OBLIGATORIA: el ícono no tiene texto visible, así que sin esto el control
   * quedaría sin nombre accesible.
   */
  ariaLabel: string;
  /** Alineación del popover respecto al ícono (default `"start"`). */
  align?: "start" | "center" | "end";
  /** Clases extra para el botón del ícono (ej. tamaño/color puntual). */
  className?: string;
}

/**
 * Ícono de ayuda (ⓘ) que revela un texto explicativo al hacer **CLICK/TAP** —
 * reemplazo del patrón viejo basado en `Tooltip` (hover), que en MOBILE no
 * dispara: en touch no hay hover, así que la ayuda quedaba inalcanzable con el
 * dedo (bug reportado por Yac 2026-08-01).
 *
 * Se apoya en `Popover` (Radix) por exactamente la razón documentada en
 * `components/ui/popover.tsx`: funciona igual con mouse (click), teclado
 * (`Enter`/`Espacio` sobre el trigger, `Escape` para cerrar) y touch (tap),
 * sin depender de hover. Es el componente COMPARTIDO para toda ayuda inline de
 * un solo campo/opción en la app — cualquier "iconito de info" nuevo debe usar
 * esto, no un `Tooltip`. (Para un desglose más rico que un párrafo corto,
 * seguir usando un `Popover` a medida, ej. `DesgloseMontoPopover`.)
 *
 * Funciona anidado dentro de un `Dialog` (ej. el diálogo de vincular
 * subcliente): el `Popover` de Radix registra su capa como descendiente en el
 * stack de capas, así que tocar el contenido de la ayuda NO cierra el diálogo
 * padre (solo cierra la ayuda), y `Escape` cierra primero la ayuda y luego el
 * diálogo.
 */
export function BotonAyuda({ children, ariaLabel, align = "start", className }: BotonAyudaProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          className={cn(
            "inline-flex items-center rounded-full text-muted-foreground/70 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
            className,
          )}
        >
          <Info className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align={align} className="w-[min(260px,calc(100vw-2rem))] p-3 text-xs text-muted-foreground">
        {children}
      </PopoverContent>
    </Popover>
  );
}
