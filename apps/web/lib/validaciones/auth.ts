import { z } from "zod";

/**
 * Esquemas Zod de autenticación (esqueleto). MISMO esquema para cliente (UX) y
 * servidor (Server Actions) — la validación real es siempre server-side.
 */

export const emailSchema = z
  .string({ required_error: "Ingresá tu correo." })
  .trim()
  .min(1, "Ingresá tu correo.")
  .max(254, "Ese correo es demasiado largo.")
  .email("Ingresá un correo válido.");

export const loginSchema = z.object({
  email: emailSchema,
  // En login no se re-valida el largo/complejidad de la contraseña: alcanza
  // con que no venga vacía.
  password: z.string({ required_error: "Ingresá tu contraseña." }).min(1, "Ingresá tu contraseña."),
});

export type LoginInput = z.infer<typeof loginSchema>;

/** UUID de una entidad (ej. tenant) recibido del cliente en una acción de plataforma. */
export const idSchema = z.string({ required_error: "Identificador inválido." }).uuid("Identificador inválido.");

/** Extrae el primer mensaje de error de un resultado Zod fallido, ya en español. */
export function primerErrorZod(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Revisá los datos ingresados.";
}
