"use client";

import * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Blindaje contra el "reset" nativo que React 19 dispara sobre el `<form>`
 * al iniciar el submit de un `<form action={...}>` gobernado por
 * `useActionState` — ANTES de invocar la Server Action, éxito o error
 * (`requestFormReset` dentro de `startHostTransition`, ver
 * `react-dom/cjs/react-dom-client.development.js`: llama
 * `fiber.stateNode.reset()`, el `.reset()` NATIVO del DOM, durante el commit
 * de la transición).
 *
 * `@radix-ui/react-select` escucha ese evento nativo `"reset"` en el
 * `<form>` ancestro de CADA `<Select>` y llama `setValue(initialValueRef.current)`
 * — el valor que tenía la primera vez que el Select se montó (ver
 * `@radix-ui/react-select/dist/index.mjs`, ~L79-87: `initialValueRef` se fija
 * una sola vez con `useRef(value)` y el listener de `"reset"` hace
 * `setValue(initialValueRef.current)`). Para un Select CONTROLADO, esa
 * `setValue` — vía `useControllableState`, `@radix-ui/react-use-controllable-state`
 * — dispara `onValueChange(valorAlMontar)` si ese valor difiere del actual, y
 * como en todos nuestros forms `onValueChange` está cableado directo a un
 * `setState` de React, esto SOBREESCRIBE la selección real del usuario antes
 * de que la Server Action siquiera corra — viola la regla dura #14.
 *
 * Fix: un listener de `"reset"` en FASE DE CAPTURA sobre `document`. Por el
 * algoritmo de despacho de eventos del DOM, un listener de captura en un
 * ANCESTRO del `<form>` corre SIEMPRE antes que cualquier listener atado al
 * propio `<form>` (el de Radix incluido) — es orden de FASE, no de registro,
 * así que no depende de qué `useEffect` montó primero. Mientras ese evento
 * se procesa, se prende un flag global; el wrapper `Select` de este archivo
 * ignora cualquier `onValueChange` que llegue con el flag activo, así el
 * reset sintético de React nunca toca el estado del consumidor. El flag se
 * apaga en un microtask: el despacho nativo del evento es 100% sincrónico,
 * así que para cuando el microtask corre, el reset (y el eventual
 * `onValueChange` descartado) ya terminó — no hace falta esperar a que el
 * evento termine de burbujear.
 *
 * Esto es seguro para el reseteo LEGÍTIMO tras un éxito que descarta el
 * form: en este proyecto ese caso se resuelve SIEMPRE cerrando el
 * diálogo/desmontando el form (o remontándolo con un `key` nuevo, ver
 * `FormularioSubcliente`/`FormularioRuta`), nunca llamando a un `.reset()`
 * nativo — no hay, ni debería haber, ningún consumidor que dependa de que un
 * `<Select>` reaccione a un `"reset"` nativo del DOM.
 */
let procesandoResetNativoDeFormulario = false;

if (typeof document !== "undefined") {
  document.addEventListener(
    "reset",
    () => {
      procesandoResetNativoDeFormulario = true;
      queueMicrotask(() => {
        procesandoResetNativoDeFormulario = false;
      });
    },
    { capture: true },
  );
}

/**
 * Wrapper de `SelectPrimitive.Root` (nunca un re-export directo, ver comentario
 * arriba) — misma API pública (`value`, `defaultValue`, `onValueChange`,
 * `disabled`, etc.), pero ignora el `onValueChange` que Radix dispara como
 * reacción al `"reset"` nativo del `<form>` ancestro.
 */
function Select({
  onValueChange,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Root>) {
  const manejarCambioDeValor = React.useCallback(
    (valor: string) => {
      if (procesandoResetNativoDeFormulario) return;
      onValueChange?.(valor);
    },
    [onValueChange],
  );

  return <SelectPrimitive.Root {...props} onValueChange={manejarCambioDeValor} />;
}
const SelectGroup = SelectPrimitive.Group;
const SelectValue = SelectPrimitive.Value;

const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={cn(
      // `text-left`: el trigger es un <button>, que trae `text-align:center` por
      // defecto del user-agent. Como el trigger es flex, eso no mueve los ítems,
      // pero el <span> del valor (SelectValue) HEREDA el center y centra su texto;
      // con un valor largo que se trunca (line-clamp), el span queda más ancho que
      // el texto visible y aparece un "espacio adelante" (visible sobre todo en
      // mobile). Forzar `text-left` deja el valor siempre pegado a la izquierda.
      "flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3.5 py-2 text-left text-sm text-foreground",
      "placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      "disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1",
      "aria-[invalid=true]:border-destructive",
      className,
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
));
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName;

const SelectScrollUpButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollUpButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollUpButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollUpButton
    ref={ref}
    className={cn("flex cursor-default items-center justify-center py-1", className)}
    {...props}
  >
    <ChevronUp className="h-4 w-4" />
  </SelectPrimitive.ScrollUpButton>
));
SelectScrollUpButton.displayName = SelectPrimitive.ScrollUpButton.displayName;

const SelectScrollDownButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollDownButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollDownButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollDownButton
    ref={ref}
    className={cn("flex cursor-default items-center justify-center py-1", className)}
    {...props}
  >
    <ChevronDown className="h-4 w-4" />
  </SelectPrimitive.ScrollDownButton>
));
SelectScrollDownButton.displayName = SelectPrimitive.ScrollDownButton.displayName;

const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = "popper", ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      position={position}
      className={cn(
        "relative z-50 max-h-[--radix-select-content-available-height] min-w-[8rem] overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-md",
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
        position === "popper" && "translate-y-1",
        className,
      )}
      {...props}
    >
      <SelectScrollUpButton />
      <SelectPrimitive.Viewport className={cn("p-1", position === "popper" && "w-full min-w-[var(--radix-select-trigger-width)]")}>
        {children}
      </SelectPrimitive.Viewport>
      <SelectScrollDownButton />
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
));
SelectContent.displayName = SelectPrimitive.Content.displayName;

const SelectLabel = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Label
    ref={ref}
    className={cn("px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground", className)}
    {...props}
  />
));
SelectLabel.displayName = SelectPrimitive.Label.displayName;

const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex w-full cursor-default select-none items-center rounded-sm py-2 pl-8 pr-2 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className,
    )}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <Check className="h-4 w-4" />
      </SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
));
SelectItem.displayName = SelectPrimitive.Item.displayName;

const SelectSeparator = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Separator ref={ref} className={cn("-mx-1 my-1 h-px bg-border", className)} {...props} />
));
SelectSeparator.displayName = SelectPrimitive.Separator.displayName;

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
  SelectScrollUpButton,
  SelectScrollDownButton,
};
