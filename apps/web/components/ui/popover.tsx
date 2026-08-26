"use client";

import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";

import { cn } from "@/lib/utils";

/**
 * Popover accesible (tarea "cálculo de facturación auditable", F4 — Nivel 1
 * de revelación progresiva en `/facturacion`). Wrapper delgado sobre
 * `@radix-ui/react-popover` (mismo criterio que `dialog.tsx`/`tooltip.tsx`/
 * `select.tsx`: primitivas Radix + estilo del design system, nunca clases "a
 * mano" fuera de los tokens).
 *
 * A diferencia de `Tooltip` (pensado para una pista corta que aparece solo al
 * hover/focus y se cierra sola), `Popover` es el primitivo correcto acá
 * porque el contenido (desglose completo del cálculo) es más rico, necesita
 * quedarse abierto para leerse con calma, y debe funcionar igual con
 * mouse/teclado/touch: Radix ya maneja `onClick` del trigger (abre con
 * mouse/tap) y `Enter`/`Espacio` (abre con teclado) sin trabajo adicional acá,
 * y se cierra con `Escape`, click afuera o tocando el trigger de nuevo.
 *
 * NO existe `PopoverProvider` (a diferencia de `TooltipProvider`) — cada
 * `Popover` es independiente, no hace falta montarlo una sola vez en el
 * layout.
 */
const Popover = PopoverPrimitive.Root;
const PopoverTrigger = PopoverPrimitive.Trigger;
const PopoverAnchor = PopoverPrimitive.Anchor;

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = "center", sideOffset = 6, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      collisionPadding={8}
      className={cn(
        "z-50 rounded-md border border-border bg-popover text-popover-foreground shadow-md outline-none",
        // Mismo aprendizaje que el enlace de invitación (CLAUDE.md 2026-07-14):
        // cualquier texto sin espacios (ej. un nombre de ruta/zona largo) debe
        // poder envolver en vez de desbordar un contenedor de ancho acotado.
        "whitespace-normal break-words [overflow-wrap:anywhere]",
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
        className,
      )}
      {...props}
    />
  </PopoverPrimitive.Portal>
));
PopoverContent.displayName = PopoverPrimitive.Content.displayName;

export { Popover, PopoverTrigger, PopoverAnchor, PopoverContent };
