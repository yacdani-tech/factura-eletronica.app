"use client";

import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";

import { cn } from "@factura/core/utils";

/**
 * Tooltip accesible (ítem 4 del lote de Yac 2026-07-18 — nota truncada en
 * `TextoTruncadoConTooltip`). Wrapper delgado sobre `@radix-ui/react-tooltip`
 * (mismo criterio que `dialog.tsx`/`select.tsx`: primitivas Radix + estilo del
 * design system, nunca clases "a mano" fuera de los tokens).
 *
 * Radix Tooltip ya maneja teclado out-of-the-box (`onFocus`/`onBlur` del
 * trigger, no solo `onMouseEnter`/`onMouseLeave`) — con un trigger enfocable
 * (`<button>`, nunca un `<span>` sin `tabIndex`) esto cumple "accesible por
 * teclado, no solo hover" sin trabajo adicional acá.
 *
 * `TooltipProvider` se monta UNA sola vez en `app/layout.tsx` (envuelve toda
 * la app) — nunca por pantalla individual.
 */
const TooltipProvider = TooltipPrimitive.Provider;
const Tooltip = TooltipPrimitive.Root;
const TooltipTrigger = TooltipPrimitive.Trigger;

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 6, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        "z-50 max-w-xs rounded-md border border-border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md",
        // El texto de una nota interna puede no tener espacios en algún tramo
        // (un link, un código) — `overflow-wrap: anywhere` evita que ese
        // tramo desborde el tooltip (mismo aprendizaje que el enlace de
        // invitación, ver CLAUDE.md 2026-07-14).
        "whitespace-normal break-words [overflow-wrap:anywhere]",
        "data-[state=delayed-open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=delayed-open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=delayed-open]:zoom-in-95",
        className,
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
