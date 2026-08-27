/**
 * Tipos y constantes compartidos entre las Server Actions de auth
 * (`lib/auth/acciones.ts`) y los componentes cliente que las invocan vía
 * `useActionState`. Separado del archivo `"use server"` porque un módulo
 * marcado `"use server"` SOLO puede exportar funciones async — cualquier
 * otro export (constantes, objetos) rompe el build de Next.
 */
export interface EstadoAccionAuth {
  error?: string;
  ok?: boolean;
}

/**
 * Rol de un usuario dentro de un tenant. Fuente única de verdad del tipo,
 * promovida a `@factura/core` para que la capa de permisos pura
 * (`permisos.ts`) la use sin depender de código de app; `apps/web` la
 * re-exporta desde `lib/auth/usuario-actual.ts`.
 */
export type RolUsuario = "admin" | "operador";

export const ESTADO_INICIAL_AUTH: EstadoAccionAuth = {};
