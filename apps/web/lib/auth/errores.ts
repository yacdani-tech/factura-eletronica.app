import type { AuthError } from "@supabase/supabase-js";

import { textosAuth } from "@/lib/textos/auth";

/**
 * Traduce errores de Supabase Auth a mensajes de negocio en español.
 * Regla dura del proyecto: errores esperados -> mensaje seguro en español;
 * errores internos -> log sin exponer secretos/detalles técnicos al usuario.
 *
 * Los `code`/`status` de gotrue-js no son 100% estables entre versiones, así
 * que se matchea también por substring del mensaje en inglés como respaldo.
 */
export function mensajeErrorLogin(error: AuthError): string {
  const codigo = error.code ?? "";
  const mensaje = error.message?.toLowerCase() ?? "";

  if (codigo === "invalid_credentials" || mensaje.includes("invalid login credentials")) {
    return textosAuth.errores.credencialesInvalidas;
  }
  if (codigo === "email_not_confirmed" || mensaje.includes("email not confirmed")) {
    return textosAuth.errores.correoNoConfirmado;
  }

  // Error inesperado: se loguea server-side (fuera de este helper, en quien
  // llama) y al usuario se le muestra un mensaje genérico, nunca el crudo.
  return textosAuth.errores.generico;
}

type ClaseErrorSignUp =
  | "correo_en_uso"
  | "correo_invalido"
  | "password_debil"
  | "limite_correos"
  | "generico";

function clasificarErrorSignUp(error: AuthError): ClaseErrorSignUp {
  const codigo = error.code ?? "";
  const mensaje = error.message?.toLowerCase() ?? "";

  if (
    codigo === "user_already_exists" ||
    mensaje.includes("already registered") ||
    mensaje.includes("already exists")
  ) {
    return "correo_en_uso";
  }
  if (codigo === "email_address_invalid" || mensaje.includes("is invalid")) {
    // GoTrue valida el correo en el signup y BLOQUEA dominios de prueba
    // (test.com, example.com, TLD .test) mientras el proyecto use el email
    // integrado de Supabase — el formato ya lo validó Zod al crear la
    // invitación, así que llegar acá casi siempre es ese bloqueo (caso real:
    // maria9@test.com, 2026-07-15). Merece mensaje propio, no el genérico.
    return "correo_invalido";
  }
  if (codigo === "over_email_send_rate_limit" || mensaje.includes("email rate limit")) {
    // El email integrado de Supabase permite ~2 correos/hora sin SMTP propio;
    // probando invitaciones se agota rápido (caso real, 2026-07-15). El
    // fallback exige "email rate limit" (no "rate limit" a secas) para no
    // capturar otros límites de GoTrue (ej. over_request_rate_limit,
    // "Request rate limit reached"), que NO son de correos.
    return "limite_correos";
  }
  if (codigo === "weak_password" || mensaje.includes("password")) {
    return "password_debil";
  }

  return "generico";
}

/**
 * Traduce un error de `supabase.auth.signUp()` a un mensaje de negocio en
 * español. `mensajeCorreoEnUso` lo decide quien llama porque el texto
 * correcto depende del flujo: REG-2 cerró el signup abierto (que decía "usá
 * otro correo"), y la creación de cuenta DESDE una invitación
 * (`crearCuentaDesdeInvitacion`, `lib/auth/acciones.ts`) necesita un mensaje
 * distinto ("iniciá sesión para aceptar la invitación") — el correo de una
 * invitación no es editable, así que "usá otro correo" no aplica ahí.
 */
export function mensajeErrorSignUp(error: AuthError, mensajeCorreoEnUso: string): string {
  switch (clasificarErrorSignUp(error)) {
    case "correo_en_uso":
      return mensajeCorreoEnUso;
    case "correo_invalido":
      return textosAuth.errores.correoInvalido;
    case "limite_correos":
      return textosAuth.errores.limiteCorreosAlcanzado;
    case "password_debil":
      return textosAuth.errores.contrasenaDebil;
    default:
      return textosAuth.errores.generico;
  }
}
