"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import { textosListas } from "@/lib/textos/listas";

export interface TarjetaListaMobileProps {
  /** Checkbox/indicador a la izquierda, alineado `mt-0.5` (mismo criterio que el `Checkbox` de `grupo-facturacion.tsx`). */
  slotInicio?: React.ReactNode;
  /** Título de la tarjeta (nombre, identificador, etc.) — se trunca a una línea. */
  titulo: React.ReactNode;
  /**
   * Texto plano equivalente a `titulo`, usado para armar el `aria-label` del
   * botón "abrir detalle" (`titulo` puede ser JSX y no siempre es texto
   * plano). Requerido en la práctica cuando se pasa `onAbrir` — sin él, el
   * botón cae al texto visible como nombre accesible (aceptable pero menos
   * explícito que `textosListas.abrirDetalle(nombre)`).
   */
  nombreAccesible?: string;
  /** Badge junto al título (ej. estado de revisión). */
  badge?: React.ReactNode;
  /** Valor principal arriba-derecha, en columna, `tabular-nums` (ej. casillero, monto, peso). */
  valor?: React.ReactNode;
  /** Subvalor atenuado debajo de `valor` (ej. monto en moneda local bajo el monto en USD). */
  subvalor?: React.ReactNode;
  /**
   * Líneas secundarias atenuadas, apiladas bajo el título — la PRIMERA en
   * `text-gray-700` (más marcada), el resto en `text-muted-foreground` (mismo
   * criterio de dos niveles de atenuación que `grupo-facturacion.tsx:384-391`).
   */
  secundarios?: ReadonlyArray<React.ReactNode>;
  /**
   * Si existe, la zona título/valor pasa a ser un `button` (abre el detalle
   * full-screen). Sin `onAbrir`, esa zona es un `div` no clicable — para
   * tarjetas de solo lectura.
   */
  onAbrir?: () => void;
  /** Estado actual del detalle que este botón controla — solo afecta `aria-expanded` (con `onAbrir`). */
  abierto?: boolean;
  /** `id` del nodo de `DetalleListaMobile` que este botón controla (`aria-controls`). */
  idDetalle?: string;
  /**
   * Islote de acciones (botón primario + menú "⋯", por ejemplo) — se renderiza
   * al PIE de la tarjeta, FUERA del `button` de abrir/cerrar (nunca se anida
   * un botón dentro de otro, regla de accesibilidad + HTML válido).
   */
  acciones?: React.ReactNode;
  className?: string;
}

/**
 * Tarjeta colapsada de UNA fila de lista en mobile (`sm:hidden`) — primitivo
 * COMPARTIDO por todas las listas del sistema (feature "Listas responsive",
 * Fase 0). Espeja la tarjeta mobile de `GrupoFacturacion`
 * (`components/facturacion/grupo-facturacion.tsx:361-402`), que es el patrón
 * de referencia aprobado por Yac — pero es 100% presentacional (sin estado
 * propio: el `abierto`/`onAbrir` los controla el wrapper de cada fila,
 * ej. `FilaSubclienteMobile`).
 *
 * 100% CSS Tailwind: no hay `matchMedia`/`useMediaQuery` (aprendizaje
 * 2026-07-17) — el breakpoint `sm` (640px) decide en CSS si esta tarjeta se
 * muestra o si manda la tabla de escritorio.
 */
export function TarjetaListaMobile({
  slotInicio,
  titulo,
  nombreAccesible,
  badge,
  valor,
  subvalor,
  secundarios,
  onAbrir,
  abierto = false,
  idDetalle,
  acciones,
  className,
}: TarjetaListaMobileProps) {
  const contenidoTitulo = (
    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
      {/* Nombre = título de la tarjeta: envuelve a varias líneas si hace falta
          y SIEMPRE se ve completo — nunca se trunca ni lo tapa el badge (que
          ahora va en su propia línea, abajo). */}
      <span className="min-w-0 break-words text-[13.5px] font-semibold text-foreground">{titulo}</span>
      {/* Badge de estado en su PROPIA línea: no compite por ancho con el
          nombre ni con el valor. Un badge largo (ej. "Revisar el WhatsApp") se
          reubica aquí y, si hiciera falta, envuelve — jamás se encima al
          nombre ni al número (encargo de Yac 2026-08-05). */}
      {badge && <span className="flex flex-wrap items-center gap-1">{badge}</span>}
      {secundarios?.map((linea, indice) => (
        <span
          key={indice}
          className={cn(
            // Wrap, NO truncate: teléfonos/correos largos se envuelven en vez
            // de cortarse con elipsis (encargo de Yac 2026-08-05).
            "break-words tabular-nums",
            indice === 0 ? "text-[11.5px] text-gray-700" : "text-[10.5px] text-muted-foreground",
          )}
        >
          {linea}
        </span>
      ))}
    </span>
  );

  const contenidoValor =
    valor !== undefined && valor !== null ? (
      // Cap al 45%: el valor (casillero, monto, peso) queda arriba-derecha en
      // posición estable, pero NUNCA le gana la mayoría del ancho al nombre —
      // si es largo (ej. un número de casillero) envuelve dentro de su propia
      // columna en vez de estrujar el título (encargo de Yac 2026-08-05).
      <span className="flex max-w-[45%] flex-col items-end">
        <span className="break-words text-right text-[13px] font-semibold tabular-nums text-foreground">
          {valor}
        </span>
        {subvalor !== undefined && subvalor !== null && (
          <span className="break-words text-right text-[11px] tabular-nums text-muted-foreground">{subvalor}</span>
        )}
      </span>
    ) : null;

  return (
    <div className={cn("flex flex-col gap-2 p-3 sm:hidden", className)}>
      <div className="flex items-start gap-2">
        {slotInicio}
        {onAbrir ? (
          <button
            type="button"
            onClick={onAbrir}
            aria-expanded={abierto}
            aria-controls={idDetalle}
            aria-label={nombreAccesible ? textosListas.abrirDetalle(nombreAccesible) : undefined}
            className="flex min-w-0 flex-1 items-start justify-between gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {contenidoTitulo}
            {contenidoValor}
          </button>
        ) : (
          <div className="flex min-w-0 flex-1 items-start justify-between gap-2">
            {contenidoTitulo}
            {contenidoValor}
          </div>
        )}
      </div>
      {acciones && (
        // El `pl-6` alinea las acciones con el título SOLO cuando hay
        // `slotInicio` (checkbox ~16px + gap-2 8px = 24px); sin él (listas de
        // solo lectura como Consolidados/Tenants) no debe sangrarse.
        <div className={cn("flex items-center gap-1", slotInicio && "pl-6")}>{acciones}</div>
      )}
    </div>
  );
}
