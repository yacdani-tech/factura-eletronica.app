"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { textosAuth } from "@/lib/textos/auth";
import { mensajeErrorLogin } from "@/lib/auth/errores";
import { loginSchema } from "@factura/core/validaciones/auth";
import { rutaInternaSegura, rutaInternaSeguraODefecto } from "@factura/core/validaciones/redireccion";
import type { EstadoAccionAuth } from "@factura/core/auth/tipos";
import { origenSitio } from "@/lib/servidor/origen-sitio";
import { procesarPostLogin } from "@/lib/soporte/despues-de-login";

/**
 * Server Actions de autenticación del esqueleto: login por contraseña, login
 * con Google (OAuth) y cierre de sesión. Reglas: validación Zod SIEMPRE
 * server-side, nunca se acepta un `tenant_id` del cliente (estas acciones no
 * reciben ni necesitan uno — el tenant se resuelve más adelante, en el layout
 * del app shell, vía la membresía real del usuario), mensajes de error en
 * español de negocio (nunca el error crudo de gotrue-js).
 *
 * Nota: `EstadoAccionAuth` y su valor inicial viven en `lib/auth/tipos.ts` (no
 * acá): un archivo `"use server"` solo puede exportar funciones async.
 */

export async function iniciarSesionConPassword(
  _estadoPrevio: EstadoAccionAuth,
  formData: FormData,
): Promise<EstadoAccionAuth> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email") ?? undefined,
    password: formData.get("password") ?? undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? textosAuth.errores.datosInvalidos };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    console.error("[auth] iniciarSesionConPassword falló:", error.code ?? error.status, error.message);
    return { error: mensajeErrorLogin(error) };
  }

  if (!data.user) {
    console.error(
      "[auth] iniciarSesionConPassword: signInWithPassword devolvió error null pero data.user null (caso inesperado) — se omite el post-login",
    );
  }

  const nextExplicito = rutaInternaSegura(formData.get("next"));

  // `try/catch` como defensa en profundidad: `procesarPostLogin` ya nunca
  // lanza por su propio contrato, pero si se rompiera, el login NO debe fallar
  // por eso. El `redirect(next)` queda FUERA del try (Next lo implementa
  // lanzando `NEXT_REDIRECT` internamente; envolverlo lo rompería).
  let next: string;
  try {
    next = await procesarPostLogin(supabase, data.user, nextExplicito);
  } catch (postLoginError) {
    console.error(
      "[auth] iniciarSesionConPassword: procesarPostLogin lanzó de forma inesperada (no bloquea el login):",
      postLoginError instanceof Error ? postLoginError.message : postLoginError,
    );
    next = nextExplicito ?? "/dashboard";
  }

  redirect(next);
}

export async function iniciarSesionConGoogle(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const origen = await origenSitio();
  const next = rutaInternaSeguraODefecto(formData.get("next"), "/dashboard");

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${origen}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  });

  if (error || !data.url) {
    console.error("[auth] iniciarSesionConGoogle falló:", error?.code ?? error?.status, error?.message);
    redirect(`/login?error=${encodeURIComponent(textosAuth.errores.googleNoDisponible)}`);
  }

  redirect(data.url);
}

export async function cerrarSesion(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
