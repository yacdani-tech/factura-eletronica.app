import "server-only";
import { Resend } from "resend";

/**
 * Capa de correo GENÉRICA de la plataforma (Resend) — wrapper mínimo y
 * SERVER-ONLY sobre el SDK de Resend.
 *
 * Contrato "NUNCA LANZA": sin `RESEND_API_KEY`, con `RESEND_ENVIO=off`, o ante
 * cualquier error de Resend, se loguea y se devuelve `{ enviado:false, motivo }`.
 * El llamador SIEMPRE puede seguir adelante (la acción de negocio que disparó
 * el correo ya fue exitosa antes de llegar acá).
 *
 * Kill-switch `RESEND_ENVIO=off` (dev/test/E2E): desactiva TODO envío real de
 * correo. Solo el valor EXACTO `"off"` desactiva (fail-safe hacia enviar:
 * producción/preview nunca setean la var, así que el envío siempre ocurre donde
 * importa). Cuando está apagado se LOGUEA el correo en vez de enviarlo. Se lee
 * en cada llamada a propósito (los tests/Playwright la alternan por proceso).
 */

export interface ResultadoEnvioCorreo {
  enviado: boolean;
  /** Motivo si no se envió (para logs; nunca se muestra tal cual al usuario). */
  motivo?: string;
}

/** Un adjunto binario (ej. un PDF) — `content` es el Buffer crudo, Resend lo codifica internamente. */
export interface AdjuntoCorreo {
  filename: string;
  content: Buffer;
}

export interface EnviarCorreoInput {
  /** Uno o varios destinatarios. */
  para: string | string[];
  asunto: string;
  /** Cuerpo HTML del correo. Al menos uno de `html`/`texto` debe venir. */
  html?: string;
  /** Cuerpo en texto plano (fallback / correos simples). */
  texto?: string;
  /** Remitente. Si se omite, se usa `RESEND_FROM_EMAIL` (o el default de plataforma). */
  desde?: string;
  attachments?: AdjuntoCorreo[];
}

/**
 * Remitente por defecto: `RESEND_FROM_EMAIL` (dominio verificado en Resend) o,
 * si falta, un placeholder de plataforma. Debe ser un remitente verificado en
 * el dominio propio para que Resend acepte el envío.
 */
function remitentePorDefecto(): string {
  return process.env.RESEND_FROM_EMAIL || "no-reply@factura-electronica.app";
}

function envioDeCorreoDesactivado(): boolean {
  return process.env.RESEND_ENVIO === "off";
}

/**
 * Envía un correo genérico vía Resend. Nunca lanza (ver contrato del módulo).
 */
export async function enviarCorreo(input: EnviarCorreoInput): Promise<ResultadoEnvioCorreo> {
  const destinatarios = Array.isArray(input.para) ? input.para : [input.para];
  if (destinatarios.length === 0) {
    return { enviado: false, motivo: "sin_destinatarios" };
  }
  if (!input.html && !input.texto) {
    return { enviado: false, motivo: "sin_cuerpo" };
  }

  if (envioDeCorreoDesactivado()) {
    console.info(
      `[correo] RESEND_ENVIO=off: se omite el envío (dev/test). Para=${destinatarios.join(", ")} Asunto="${input.asunto}"`,
    );
    return { enviado: false, motivo: "envio_desactivado" };
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.info("[correo] RESEND_API_KEY no configurada: se omite el envío.");
    return { enviado: false, motivo: "sin_api_key" };
  }

  try {
    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({
      from: input.desde || remitentePorDefecto(),
      to: destinatarios,
      subject: input.asunto,
      // Resend exige al menos uno; enviamos ambos cuando están disponibles.
      ...(input.html ? { html: input.html } : {}),
      ...(input.texto ? { text: input.texto } : {}),
      ...(input.attachments && input.attachments.length > 0
        ? { attachments: input.attachments.map((a) => ({ filename: a.filename, content: a.content })) }
        : {}),
    } as Parameters<Resend["emails"]["send"]>[0]);

    if (error) {
      console.error("[correo] Resend devolvió error:", error.message);
      return { enviado: false, motivo: error.message };
    }
    return { enviado: true };
  } catch (error) {
    console.error("[correo] excepción enviando vía Resend:", error instanceof Error ? error.message : error);
    return { enviado: false, motivo: "excepcion" };
  }
}
