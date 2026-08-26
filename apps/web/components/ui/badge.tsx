import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * Badges de estado — MASTER.md: color + texto siempre (nunca color solo).
 * Variantes mapeadas a los "colores funcionales" del manual (éxito/alerta/
 * error/info) + neutro para estados sin carga semántica (ej. "cancelada").
 * `neutroSolido` (2026-08-25): chip gris SÓLIDO (Gris Oscuro #374151 de la
 * paleta de marca + texto blanco), para categorías SIN carga de estado — hoy el
 * modo de transporte "Aéreo", distinguiéndolo del "Marítimo" (`info`, azul). Se
 * usa gris a propósito: los colores funcionales (verde/ámbar/rojo) tienen
 * significado de estado fijo y ya conviven en la misma fila (facturado=verde,
 * por revisar=ámbar) — un modo no es un estado. El `neutro` (token `muted`)
 * quedaba casi invisible; este sólido sí se ve (encargo de Yac). On-brand: el
 * color sale de la paleta del manual v3.0, no se inventa a mano.
 */
const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors",
  {
    variants: {
      variant: {
        neutro: "border-transparent bg-muted text-muted-foreground",
        exito: "border-transparent bg-[#27B85A1a] text-[hsl(var(--verde-texto))]",
        alerta: "border-transparent bg-[#F59E0B1a] text-[#92400E]",
        error: "border-transparent bg-[#DC26261a] text-[#991B1B]",
        info: "border-transparent bg-[#3B82F61a] text-[#1E40AF]",
        neutroSolido: "border-transparent bg-[#374151] text-white",
      },
    },
    defaultVariants: {
      variant: "neutro",
    },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
