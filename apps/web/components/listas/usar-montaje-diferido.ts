import * as React from "react";

/**
 * Montaje DIFERIDO de los diálogos por fila de una lista (fix de regresión de
 * rendimiento en mobile, 2026-08-05). El patrón "1 acción + menú ⋯"
 * (`AccionesSubcliente`/`AccionesPaquete`/`BotonEditarSubclienteIcono`)
 * renderizaba TODAS sus raíces Radix `Dialog` de forma EAGER en cada fila,
 * aunque al cargar estén cerradas. Con la feature "Listas responsive" cada fila
 * pasó a montar DOS subtrees (tabla desktop + tarjeta mobile, ambos SIEMPRE
 * hidratados porque el switch es 100% CSS `hidden sm:block` / `sm:hidden`), y la
 * tarjeta mobile DUPLICA el island de acciones (una instancia en la tarjeta y
 * otra en el detalle) — ~11 raíces `Dialog` por fila × 20 filas ≈ 220 providers
 * Radix hidratando de golpe (antes de la feature: ~80). En un CPU de celular
 * (3–5× más lento que un desktop) ese trabajo de hidratación se sentía como
 * "la lista tarda demasiado en cargar".
 *
 * Este hook difiere el montaje de esos diálogos hasta la PRIMERA vez que el
 * usuario abre uno: `montado` arranca en `false` (cero diálogos en la
 * hidratación inicial — justo la causa raíz de la regresión) y `activar()` lo
 * pone en `true` de forma PERMANENTE. Como al cargar los diálogos ya arrancaban
 * cerrados, no hay ningún cambio de UX. Y como una vez montados quedan montados,
 * se conservan intactas la animación de cierre y la regla dura #14 (lo digitado
 * nunca se borra solo): tras la primera apertura el comportamiento es idéntico
 * al anterior, solo que el primer render ya no paga el costo de ~todas las
 * raíces Radix de la página.
 *
 * Uso: el island llama `activar()` en el mismo handler que abre un diálogo
 * (`() => { activar(); setDialogo("editar"); }`) y envuelve el bloque de
 * diálogos en `{montado && (<>…</>)}`. Los handlers `onOpenChange` de un diálogo
 * ya abierto NO necesitan llamar `activar()` (solo se disparan post-montaje).
 */
export function useMontajeDiferido(): readonly [boolean, () => void] {
  const [montado, setMontado] = React.useState(false);
  const activar = React.useCallback(() => setMontado(true), []);
  return [montado, activar];
}
