"use client";

import { cn } from "@/lib/utils";

/** Una opción del control segmentado. `T` es el tipo del valor (union de strings del caller, ej. `"tabla" | "tarjetas"`). */
export interface OpcionControlSegmentado<T extends string = string> {
  valor: T;
  /** Texto visible del botón — provisto por el caller, centralizado en su propio módulo de textos (este primitivo no hardcodea ningún string). */
  etiqueta: string;
}

export interface ControlSegmentadoProps<T extends string = string> {
  opciones: OpcionControlSegmentado<T>[];
  /** Valor actualmente seleccionado — controlado, sin estado interno. */
  valorActivo: T;
  onCambiar: (valor: T) => void;
  /**
   * Texto accesible del grupo (obligatorio: describe qué controla el
   * segmented, ej. "Vista de la lista") — expuesto como `aria-label` del
   * contenedor `role="group"`.
   */
  ariaLabel: string;
  className?: string;
}

/**
 * Control segmentado genérico y controlado (primitivo compartido, sistema de
 * diseño). Presentacional puro: NO cablea navegación ni ningún efecto
 * secundario — quien lo use decide qué hacer en `onCambiar` (ej. un
 * `router.push` con searchParams, mismo patrón que `FiltrosTenants`).
 *
 * Accesibilidad: contenedor `role="group"` con `aria-label`; cada opción es
 * un `<button aria-pressed>` (grupo de botones con estado presionado, más
 * simple de navegar con teclado — tab normal, sin roving tabindex — que un
 * `radiogroup` con flechas; suficiente para esta cantidad chica de opciones).
 */
export function ControlSegmentado<T extends string = string>({
  opciones,
  valorActivo,
  onCambiar,
  ariaLabel,
  className,
}: ControlSegmentadoProps<T>) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn("inline-flex items-center gap-0.5 rounded-lg border border-border bg-muted p-1", className)}
    >
      {opciones.map((opcion) => {
        const activo = opcion.valor === valorActivo;
        return (
          <button
            key={opcion.valor}
            type="button"
            aria-pressed={activo}
            onClick={() => onCambiar(opcion.valor)}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              activo ? "bg-background font-semibold text-foreground shadow-sm" : "hover:text-foreground",
            )}
          >
            {opcion.etiqueta}
          </button>
        );
      })}
    </div>
  );
}
