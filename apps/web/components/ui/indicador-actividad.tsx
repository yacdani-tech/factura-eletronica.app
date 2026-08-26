"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatearTiempoTranscurrido } from "@/lib/ui/tiempo-transcurrido";

/**
 * Indicador de ACTIVIDAD para procesos largos sin avance real reportado por el
 * servidor — importación de clientes/consolidados y acciones lentas de IA
 * (decisión de Yac 2026-08-18: "que el cliente sepa que se está haciendo algo y
 * no se quedó pegado", inspirado en el indicador de Claude "⟳ … 2m 14s").
 *
 * NO es una barra de progreso (el request es monolítico y no emite porcentaje).
 * Combina tres señales de "está vivo":
 *  1. spinner animado (`Loader2` + `animate-spin`);
 *  2. RELOJ de tiempo transcurrido — la señal más fuerte: un reloj que corre no
 *     puede verse congelado;
 *  3. mensajes de FASE que rotan en el orden REAL en que el servidor trabaja
 *     (temporizados en el cliente, no avance real). La última fase se queda fija
 *     — debe ser un mensaje neutro ("Esto puede tardar un poco…") para no
 *     afirmar que una etapa terminó cuando no se sabe.
 *
 * Los textos de `fases` viven centralizados en `lib/textos/*` (regla #12), nunca
 * hardcodeados acá.
 */
export interface IndicadorActividadProps {
  /** Arranca/reinicia el reloj y la rotación de fases; al pasar a `false` se resetea todo. Si es `false`, no renderiza nada. */
  activo: boolean;
  /** Mensajes de fase en orden. La última se mantiene fija (no cicla más allá). */
  fases: readonly string[];
  /** Cada cuánto avanza de fase (ms). Default 4000. */
  intervaloFaseMs?: number;
  /** Mostrar el reloj `(Xm Ys)`. Default `true`. */
  mostrarTiempo?: boolean;
  /** Mostrar el spinner propio. Default `true` (poner `false` cuando el contenedor ya tiene su propio spinner, ej. un botón). */
  spinner?: boolean;
  /** Variante inline (span, para meter dentro de un botón) vs bloque (div con `role="status"`). Default `false` (bloque). */
  compacto?: boolean;
  className?: string;
}

const INTERVALO_FASE_MS_DEFECTO = 4000;

/**
 * Milisegundos transcurridos desde que `activo` pasó a `true`; `0` cuando está
 * inactivo. Reinicia en cada nuevo arranque. Hook con prefijo `use` en INGLÉS a
 * propósito: un `usarX` con hooks adentro rompe `next build` por
 * `rules-of-hooks` (invisible a tsc/Vitest — aprendizaje 2026-xx en memoria).
 */
function useTiempoTranscurrido(activo: boolean): number {
  const [ms, setMs] = React.useState(0);
  React.useEffect(() => {
    if (!activo) {
      setMs(0);
      return;
    }
    const inicio = Date.now();
    setMs(0);
    const id = window.setInterval(() => {
      setMs(Date.now() - inicio);
    }, 1000);
    return () => window.clearInterval(id);
  }, [activo]);
  return ms;
}

/**
 * Índice de fase que avanza cada `intervaloMs` mientras `activo`, tope en la
 * última fase. Reinicia en cada arranque. Mismo motivo del prefijo `use` inglés.
 */
function useFaseRotativa(activo: boolean, cantidadFases: number, intervaloMs: number): number {
  const [indice, setIndice] = React.useState(0);
  React.useEffect(() => {
    if (!activo || cantidadFases <= 1) {
      setIndice(0);
      return;
    }
    setIndice(0);
    const id = window.setInterval(() => {
      setIndice((prev) => (prev < cantidadFases - 1 ? prev + 1 : prev));
    }, intervaloMs);
    return () => window.clearInterval(id);
  }, [activo, cantidadFases, intervaloMs]);
  return indice;
}

export function IndicadorActividad({
  activo,
  fases,
  intervaloFaseMs = INTERVALO_FASE_MS_DEFECTO,
  mostrarTiempo = true,
  spinner = true,
  compacto = false,
  className,
}: IndicadorActividadProps) {
  const ms = useTiempoTranscurrido(activo);
  const indiceFase = useFaseRotativa(activo, fases.length, intervaloFaseMs);

  if (!activo) return null;

  const faseActual = fases[indiceFase] ?? fases[fases.length - 1] ?? "";
  const tiempo = mostrarTiempo ? formatearTiempoTranscurrido(ms) : null;

  const contenido = (
    <>
      {spinner && <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden="true" />}
      <span>
        {faseActual}
        {tiempo && <span className="tabular-nums">{faseActual ? " " : ""}({tiempo})</span>}
      </span>
    </>
  );

  if (compacto) {
    return (
      <span role="status" aria-live="polite" className={cn("inline-flex items-center gap-1.5", className)}>
        {contenido}
      </span>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn("flex items-center justify-center gap-2 text-sm text-muted-foreground", className)}
    >
      {contenido}
    </div>
  );
}
