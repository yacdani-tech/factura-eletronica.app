"use client";

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { textosListas } from "@/lib/textos/listas";
import { cn } from "@factura/core/utils";

const LIMITE_DEFECTO = 20;

interface TextoTruncadoConTooltipProps {
  texto: string;
  /** Cantidad de caracteres antes de truncar con "…". Default: 20 (ítem 4 del lote de Yac 2026-07-18). */
  limite?: number;
  className?: string;
}

/**
 * Texto largo (ej. nota interna de un subcliente) truncado a `limite`
 * caracteres con "…", con el texto COMPLETO disponible en un tooltip flotante
 * — reusable en cualquier lista del sitio que muestre texto libre.
 *
 * Accesible por TECLADO, no solo hover (regla de UX del encargo): el trigger
 * es un `<button>` real (enfocable, `Tab` lo alcanza), y Radix Tooltip ya
 * dispara con `onFocus`/`onBlur` además de `onMouseEnter`/`onMouseLeave` — ver
 * `components/ui/tooltip.tsx`. Si el texto NO supera el límite, se muestra
 * tal cual (sin botón, sin tooltip: no hay nada que expandir).
 *
 * `TooltipProvider` LOCAL (además del global de `app/layout.tsx`): Radix
 * exige que todo `Tooltip` cuelgue de un `Provider` en el árbol — anidar uno
 * acá hace que este componente sea AUTOSUFICIENTE (se puede testear/usar en
 * aislamiento sin depender de que el árbol de arriba ya tenga uno montado);
 * un `Provider` anidado nunca choca con el global, React Context solo usa el
 * más cercano.
 */
export function TextoTruncadoConTooltip({ texto, limite = LIMITE_DEFECTO, className }: TextoTruncadoConTooltipProps) {
  if (texto.length <= limite) {
    return <span className={className}>{texto}</span>;
  }

  const truncado = `${texto.slice(0, limite)}…`;

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={cn(
              "cursor-default rounded-sm text-left underline decoration-dotted decoration-muted-foreground/60 underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
              className,
            )}
            aria-label={`${textosListas.verNotaCompleta}: ${texto}`}
          >
            {truncado}
          </button>
        </TooltipTrigger>
        <TooltipContent>{texto}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
