import type { RolUsuario } from "@/lib/auth/usuario-actual";

/**
 * Mapa central de permisos por rol (esqueleto de plataforma).
 *
 * Interfaz ÚNICA: estos permisos NO arman pantallas distintas por rol — sirven
 * para (a) habilitar/deshabilitar acciones o ítems de la MISMA pantalla, y (b)
 * que las Server Actions bloqueen ANTES de ejecutar. La garantía real de
 * seguridad sigue siendo RLS en la base; esto es la capa de UX + defensa en
 * profundidad de la app, nunca el único guardia.
 *
 * Conjunto GENÉRICO mínimo para el esqueleto multi-tenant: gestión de usuarios
 * del equipo y edición de configuración. `plataforma:soporte` es un permiso de
 * PLATAFORMA (super-admin) — no lo tiene ningún rol de tenant; se representa
 * acá para documentar la superficie, pero el gating real de super-admin pasa
 * por `exigirSuperAdmin` (`lib/auth/exigir-super-admin.ts`), no por `puede()`.
 */
export type Permiso =
  | "usuarios:invitar"
  | "usuarios:gestionar"
  | "configuracion:editar"
  | "plataforma:soporte";

/**
 * `admin` es deliberadamente exhaustivo (acceso completo) en vez de listarse
 * aparte: un permiso nuevo agregado a `Permiso` sin actualizar este arreglo es
 * un error de tipos, no un olvido silencioso.
 */
const TODOS_LOS_PERMISOS: readonly Permiso[] = [
  "usuarios:invitar",
  "usuarios:gestionar",
  "configuracion:editar",
  "plataforma:soporte",
];

const PERMISOS_POR_ROL: Record<RolUsuario, ReadonlySet<Permiso>> = {
  // El Admin del tenant NO recibe `plataforma:soporte` (es de super-admin) —
  // se filtra explícitamente para no darlo por el "acceso completo".
  admin: new Set<Permiso>(TODOS_LOS_PERMISOS.filter((p) => p !== "plataforma:soporte")),
  operador: new Set<Permiso>([]),
};

/**
 * `puede(rol, permiso)` — función pura, sin dependencias de Next/Supabase:
 * usable en Server Components/Actions y Client Components por igual.
 *
 * `rol` puede ser `null`/`undefined` (usuario sin membresía activa, o todavía
 * no resuelto): siempre `false`, nunca revienta.
 */
export function puede(rol: RolUsuario | null | undefined, permiso: Permiso): boolean {
  if (!rol) return false;
  return PERMISOS_POR_ROL[rol].has(permiso);
}

/** Lista de permisos habilitados para un rol (útil para debug/tests). */
export function permisosDe(rol: RolUsuario | null | undefined): readonly Permiso[] {
  if (!rol) return [];
  return Array.from(PERMISOS_POR_ROL[rol]);
}
