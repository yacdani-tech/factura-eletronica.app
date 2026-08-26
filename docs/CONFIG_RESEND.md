# Configuración de correo (Resend)

La plataforma envía correo transaccional con [Resend](https://resend.com). La
capa genérica de envío vive en `apps/web/lib/correo/enviar.ts`
(`enviarCorreo(...)`), es **server-only** y **nunca lanza**: ante cualquier
problema de configuración o de la API, loguea y devuelve
`{ enviado: false, motivo }`, de modo que la acción de negocio que disparó el
correo puede seguir adelante.

## Variables de entorno

Todas viven en `apps/web/.env.local` (gitignoreado) y como variables de entorno
del deploy. Plantilla en `apps/web/.env.example`.

| Variable | Requerida | Descripción |
|---|---|---|
| `RESEND_API_KEY` | Sí (para enviar) | Llave de API de Resend (SOLO servidor). Sin ella, el envío se OMITE sin error (`motivo: "sin_api_key"`). |
| `RESEND_FROM_EMAIL` | Sí (para enviar) | Remitente verificado en el dominio propio (ej. `no-reply@tu-dominio.app`). Si falta, se usa un placeholder que Resend rechazará hasta configurar el dominio. |
| `RESEND_ENVIO` | No | Kill-switch. **Solo el valor exacto `off`** desactiva el envío real (dev/test/E2E): en ese modo el correo se LOGUEA en vez de enviarse. Cualquier otro valor, o su ausencia, deja el envío ACTIVO (fail-safe hacia enviar). Producción/preview no deben setearla. |

## Alta en Resend (una vez)

1. Crear una cuenta en [resend.com](https://resend.com).
2. **Verificar el dominio** de envío: Resend > Domains > Add Domain. Agregar los
   registros DNS que indica (SPF/`TXT`, DKIM/`CNAME` y, opcional pero
   recomendado, DMARC) en el proveedor DNS del dominio. Esperar a que Resend lo
   marque como *Verified* — hasta entonces, los envíos con un `from` de ese
   dominio se rechazan.
3. Crear una **API Key** (Resend > API Keys). Copiarla a `RESEND_API_KEY`.
4. Definir `RESEND_FROM_EMAIL` con una dirección del dominio verificado
   (ej. `no-reply@tu-dominio.app`). Debe pertenecer al dominio verificado en el
   paso 2.

## Comportamiento del kill-switch por entorno

- **Desarrollo local / tests / E2E**: `RESEND_ENVIO=off`. No se envía nada; los
  correos se loguean. No hace falta `RESEND_API_KEY` para trabajar.
- **Preview / Producción**: NO setear `RESEND_ENVIO` (o cualquier valor distinto
  de `off`), y configurar `RESEND_API_KEY` + `RESEND_FROM_EMAIL` reales.

## Plantillas de notificación

El asunto y cuerpo de cada evento son configurables por tenant en la tabla
`public.plantillas_notificacion` (migración
`20260819120000_plantillas_notificacion_base.sql`): columnas `clave` (clave
genérica del evento, definida por la aplicación), `asunto`, `cuerpo`, `activa`,
por `idioma`, con RLS multi-tenant. El proyecto derivado crea las plantillas de
forma perezosa por tenant y resuelve los placeholders al enviar.

## Cron de generación (relación con `CRON_SECRET`)

Independiente de Resend, la generación diaria de facturas de suscripción corre
por Vercel Cron (`apps/web/vercel.json` → `/api/cron/generar-suscripciones`),
autorizada por `CRON_SECRET`. Ver `apps/web/.env.example`.
