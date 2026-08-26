"use client";

import * as React from "react";
import { X } from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface InputBusquedaProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /**
   * Se invoca al pulsar la "X" de limpiar. El consumidor debe vaciar el estado
   * de búsqueda y navegar de inmediato (sin esperar el debounce) — limpiar es
   * una acción explícita del usuario, no un tecleo más. Ver `FiltrosPaquetes`/
   * `FiltrosSubclientes`/`FiltrosFacturacion`.
   */
  onLimpiar: () => void;
  /** `aria-label` del botón de limpiar (texto centralizado, multi-idioma-ready). */
  etiquetaLimpiar: string;
}

/**
 * Campo de búsqueda con un botón "X" para limpiar EMBEBIDO a la derecha del
 * input (decisión de Yac 2026-07-31: "a la par del search un botón para
 * borrar" — resuelto con el patrón universal de icono dentro del campo, más
 * elegante que un botón etiquetado suelto en una fila de filtros ya densa).
 *
 * El botón solo se muestra cuando hay texto (no deja un control muerto), y su
 * `click` NO pasa por el debounce del consumidor: limpia y navega en el acto.
 * El input reserva padding derecho solo cuando el botón está visible para que
 * el texto no quede debajo de la "X".
 */
export const InputBusqueda = React.forwardRef<HTMLInputElement, InputBusquedaProps>(
  ({ onLimpiar, etiquetaLimpiar, className, value, ...props }, ref) => {
    const hayTexto = typeof value === "string" && value.length > 0;
    return (
      <div className="relative">
        {/*
          Fondo levemente tintado (#F9FAFB, no blanco puro) para que el campo de
          BÚSQUEDA se lea de inmediato como "para llenar" y se distinga del resto
          de la superficie blanca (decisión de Yac 2026-08-06, junto al UI/UX).
          Va antes que `className` del consumidor para que este pueda anularlo si
          alguna vez hace falta. `bg-background` del `Input` base queda pisado por
          tailwind-merge (última clase de background gana).
        */}
        <Input ref={ref} value={value} className={cn("bg-[#F9FAFB]", hayTexto && "pr-10", className)} {...props} />
        {hayTexto ? (
          <button
            type="button"
            onClick={onLimpiar}
            aria-label={etiquetaLimpiar}
            className="absolute inset-y-0 right-0 flex items-center rounded-md px-3 text-muted-foreground transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : null}
      </div>
    );
  },
);
InputBusqueda.displayName = "InputBusqueda";
