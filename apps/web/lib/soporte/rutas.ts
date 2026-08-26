/**
 * Rutas de la consola de soporte de Super-Admin (SA-2 + tarea 2.1, fase 3).
 * Función PURA (sin I/O) para que `app/(app)/layout.tsx` decida si, estando
 * en "modo plataforma" (Super-Admin sin selección de tenant activa), debe
 * dejar pasar `children` (la consola en sí, o el alta de courier — ambas
 * viven bajo esta ruta y sus sub-rutas) en vez de redirigir a la consola.
 *
 * Sin esto, CUALQUIER ruta pedida por un Super-Admin sin selección caería en
 * el mismo placeholder/redirect genérico, y la propia consola (`/soporte`) o
 * el alta de courier (`/soporte/couriers/nuevo`) nunca podrían renderizarse
 * para ese usuario — exactamente el caso que más la necesita.
 */
export const RUTA_CONSOLA_SOPORTE = "/soporte";

/** `true` si `pathname` es la consola de soporte o una sub-ruta suya (ej. `/soporte/couriers/nuevo`). */
export function esRutaConsolaSoporte(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return pathname === RUTA_CONSOLA_SOPORTE || pathname.startsWith(`${RUTA_CONSOLA_SOPORTE}/`);
}
