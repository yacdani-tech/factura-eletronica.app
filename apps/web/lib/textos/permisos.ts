/**
 * Textos de los mensajes de negocio que devuelve `exigirPermiso` (guard de
 * Server Actions, `lib/auth/exigir-permiso.ts`). Centralizados acá (mismo
 * patrón que `lib/nav.ts`/`lib/textos/auth.ts`) para no duplicar strings
 * entre las Server Actions que lo van a usar (staff, config, documentos...).
 */
export const textosPermisos = {
  sinSesion: "Tu sesión expiró. Iniciá sesión de nuevo.",
  sinEquipo: "Tu cuenta no pertenece a ningún equipo todavía.",
  sinPermiso: "Tu rol no tiene permiso para hacer esto.",
  courierBloqueado: "Este courier fue bloqueado. Contactá a soporte para más información.",
} as const;
