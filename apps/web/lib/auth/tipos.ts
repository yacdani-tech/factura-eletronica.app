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

export const ESTADO_INICIAL_AUTH: EstadoAccionAuth = {};
