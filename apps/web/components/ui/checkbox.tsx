"use client";

import * as React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check, Minus } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Checkbox (shadcn + Radix), primer uso: selección múltiple de paquetes
 * `por_revisar` (Parte 4 del plan `el-numero-de-wr-cuddly-pretzel.md`,
 * 2026-07-22 — `components/paquetes/checkbox-fila-paquete.tsx`).
 *
 * A diferencia de `components/ui/select.tsx`, este control NUNCA vive dentro
 * de un `<form action>` (la selección de paquetes es puro estado de cliente,
 * las acciones `confirmarRevisionPaquetes`/`descartarPaquetes` se invocan
 * directo con `ids: string[]`, no vía submit de formulario) — el bug de
 * React 19 documentado en `select.tsx` (reset nativo del `<form>` pisando el
 * valor controlado) no aplica acá, así que este wrapper no necesita el mismo
 * blindaje.
 *
 * Soporta el estado `"indeterminate"` (checkbox "seleccionar todos" cuando
 * hay selección PARCIAL — ver `EncabezadoSeleccionarTodosPaquetes`).
 *
 * Tamaño visual 20px (`h-5 w-5`): el tap target real lo da el padding de la
 * `TableCell`/`TableHead` que lo contiene (`p-3`/`h-11` ya definidos en
 * `components/ui/table.tsx`, que además ya trae `[&:has([role=checkbox])]:pr-0`
 * — este componente es exactamente el caso que ese selector anticipa), no
 * hace falta un hitSlop adicional en el propio botón.
 */
const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      "peer h-5 w-5 shrink-0 rounded-[4px] border border-input ring-offset-background transition-colors",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      "disabled:cursor-not-allowed disabled:opacity-50",
      "data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground",
      "data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground",
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator className="flex items-center justify-center text-current">
      {props.checked === "indeterminate" ? <Minus className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = CheckboxPrimitive.Root.displayName;

export { Checkbox };
