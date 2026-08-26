/**
 * Textos GENÉRICOS/TRANSVERSALES — a diferencia del resto de `lib/textos/*`
 * (uno por pantalla/dominio: `facturacion.ts`, `subclientes.ts`, etc.), este
 * módulo es para texto que no pertenece a NINGUNA pantalla en particular:
 * los boundaries de error de la app (`app/(app)/error.tsx`,
 * `app/global-error.tsx` — blindaje 2026-08-12, red de seguridad app-wide
 * tras el `error.tsx` puntual de `/facturacion`) y la página 404 genérica
 * (`app/not-found.tsx` — feature "subdominio inexistente", 2026-08-18).
 * Módulo PURO — sin imports de Next/React/Supabase — para que
 * `global-error.tsx` (que debe ser autosuficiente, sin arrastrar el resto
 * del shell) lo pueda importar sin riesgo.
 */
export const textosComun = {
  errorInesperado: {
    /**
     * Boundary GENÉRICO (`app/(app)/error.tsx`): cubre cualquier ruta
     * autenticada que NO tenga su propio `error.tsx` más específico (ej.
     * `/facturacion`, que sigue con el suyo propio — gana por especificidad,
     * regla de Next: el boundary más profundo/cercano al error es el que
     * atrapa). Mismo criterio que `textosFacturacion.pantalla.errorInesperado*`:
     * mensaje SIEMPRE genérico (regla dura #8 — nunca `error.message` crudo),
     * el detalle completo se loguea server-side vía `console.error`.
     */
    titulo: "Algo salió mal",
    descripcion: "Ocurrió un error inesperado. Probá de nuevo en unos minutos.",
    reintentar: "Reintentar",
  },
  /**
   * `app/not-found.tsx` — 404 genérico de toda `apps/web`. Lo dispara
   * `notFound()` desde los gates de `(auth)/layout.tsx` y `(app)/layout.tsx`
   * cuando el subdominio del request no corresponde a ningún tenant, y
   * también cubre cualquier URL no matcheada (comportamiento nativo de
   * Next). El texto es DELIBERADAMENTE genérico (regla dura #8): nunca debe
   * distinguirse de cara al visitante si el subdominio "no existe" o si
   * existe pero el tenant está bloqueado (ese caso no pasa por acá — sigue
   * el flujo normal de login/expulsión).
   */
  paginaNoExiste: {
    titulo: "Esta página no existe",
    descripcion:
      "La dirección que ingresaste no corresponde a ninguna cuenta. Revisá el enlace e intentá de nuevo.",
  },
} as const;
