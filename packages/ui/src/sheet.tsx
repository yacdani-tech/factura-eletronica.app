"use client";

import * as React from "react";
import * as SheetPrimitive from "@radix-ui/react-dialog";
import { cva, type VariantProps } from "class-variance-authority";
import { X } from "lucide-react";

import { cn } from "@factura/core/utils";

// Panel deslizante (drawer) construido sobre la misma primitiva Radix Dialog
// que `dialog.tsx` — mismo Portal + Overlay + foco atrapado + Escape para
// cerrar. La diferencia es el POSICIONAMIENTO: en vez de centrarse, se ancla a
// un borde del viewport (`side`) y entra deslizándose. En `/facturacion` se usa
// para el panel de filtros (lateral derecho en desktop, inferior en mobile) y
// para la pantalla de detalle de cliente en mobile.
//
// El overlay cubre TODO el viewport (`fixed inset-0`), incluido el rail del
// Sidebar — es el comportamiento correcto de un drawer modal.

const Sheet = SheetPrimitive.Root;
const SheetTrigger = SheetPrimitive.Trigger;
const SheetClose = SheetPrimitive.Close;
const SheetPortal = SheetPrimitive.Portal;

const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/50",
      // BUG DE ACCESIBILIDAD (QA, 2026-08-04): la animación de SALIDA
      // (`data-[state=closed]`) se desactiva a propósito — ver el comentario
      // largo en `sheetVariants` más abajo, misma causa raíz.
      "data-[state=open]:animate-in data-[state=closed]:!animate-none data-[state=open]:fade-in-0",
      className,
    )}
    {...props}
  />
));
SheetOverlay.displayName = SheetPrimitive.Overlay.displayName;

const sheetVariants = cva(
  cn(
    "fixed z-50 flex flex-col gap-4 border-border bg-background shadow-lg transition ease-in-out",
    // BUG DE ACCESIBILIDAD (QA, 2026-08-04): doble-Escape con un `MultiSelect`
    // (Radix DropdownMenu) abierto DENTRO de este `Sheet` (Radix Dialog) dejaba
    // un `aria-hidden="true"` pegado en el fondo (ver `hideOthers`/`aria-hidden`,
    // `components/ui/multi-select.tsx`) — causa raíz real: Radix `Presence`
    // (`@radix-ui/react-presence`) desmonta el Dialog recién cuando su propia
    // animación CSS de SALIDA (`animate-out`) dispara `animationend`; si el
    // DropdownMenu ANIDADO (portaleado aparte, también con su propia
    // animación de salida) cierra casi al mismo tiempo, el evento
    // `dismissableLayer.update` que dispara al desregistrarse fuerza un
    // re-render del `DismissableLayer` del propio Sheet justo mientras SU
    // animación de salida está en pleno vuelo — confirmado en vivo (reproducido
    // con un `MutationObserver`/patch de `setAttribute`) que en ese escenario
    // el `animationend` del Sheet NUNCA llega: `Presence` queda atascado en
    // `unmountSuspended` para siempre, el Dialog NUNCA desmonta de verdad (su
    // overlay sigue en el DOM aunque invisible) y por lo tanto su cleanup de
    // `hideOthers` (que restaura `aria-hidden`) tampoco corre jamás. Se
    // reprodujo AISLADO (sin el DropdownMenu) que el Sheet solo, cerrado por
    // mouse o por un solo Escape, SIEMPRE limpia bien — el bug es
    // específicamente la carrera entre dos `Presence` animadas cerrándose casi
    // a la vez. Fix: eliminar la animación de SALIDA del Sheet (mantiene la de
    // ENTRADA/apertura intacta) — sin animación de salida, `Presence` ve
    // `animationName === "none"` y desmonta el Dialog de inmediato, sin
    // esperar ningún evento, eliminando la ventana de la carrera. El
    // `MultiSelect` aplica el mismo criterio a su propio `DropdownMenuContent`
    // (ver ese archivo) — hace falta desactivar AMBAS mitades: se probó
    // exhaustivamente (8+ corridas) que desactivar solo una de las dos NO
    // basta, deben ser las DOS.
    "data-[state=open]:animate-in data-[state=closed]:!animate-none data-[state=open]:duration-500",
  ),
  {
    variants: {
      side: {
        top: "inset-x-0 top-0 border-b data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top",
        bottom:
          "inset-x-0 bottom-0 border-t data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
        left: "inset-y-0 left-0 h-full w-3/4 border-r data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left sm:max-w-sm",
        right:
          "inset-y-0 right-0 h-full w-3/4 border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right sm:max-w-sm",
      },
    },
    defaultVariants: {
      side: "right",
    },
  },
);

interface SheetContentProps
  extends React.ComponentPropsWithoutRef<typeof SheetPrimitive.Content>,
    VariantProps<typeof sheetVariants> {}

const SheetContent = React.forwardRef<React.ElementRef<typeof SheetPrimitive.Content>, SheetContentProps>(
  ({ side = "right", className, children, ...props }, ref) => (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Content
        ref={ref}
        // `[&>*]:min-w-0`: misma defensa que en `dialog.tsx` — un hijo directo
        // de flex/grid tiene `min-width: auto` y se niega a encogerse por
        // debajo de su contenido; sin esto un token largo (nombre de cliente,
        // enlace) inflaría el panel más allá de su ancho.
        className={cn(sheetVariants({ side }), "[&>*]:min-w-0", className)}
        {...props}
      >
        {children}
        <SheetPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none">
          <X className="h-4 w-4" />
          <span className="sr-only">Cerrar</span>
        </SheetPrimitive.Close>
      </SheetPrimitive.Content>
    </SheetPortal>
  ),
);
SheetContent.displayName = SheetPrimitive.Content.displayName;

const SheetHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col gap-1.5 text-left", className)} {...props} />
);
SheetHeader.displayName = "SheetHeader";

const SheetFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)} {...props} />
);
SheetFooter.displayName = "SheetFooter";

const SheetTitle = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Title>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold leading-none tracking-tight text-foreground", className)}
    {...props}
  />
));
SheetTitle.displayName = SheetPrimitive.Title.displayName;

const SheetDescription = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Description>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Description ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
));
SheetDescription.displayName = SheetPrimitive.Description.displayName;

export {
  Sheet,
  SheetPortal,
  SheetOverlay,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
};
