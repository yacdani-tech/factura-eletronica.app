import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Cliente de Supabase con la llave `service_role` — bypassea RLS por
 * completo. Regla dura #9 del proyecto: "service_role solo en código
 * server-side estrictamente justificado; JAMÁS en el cliente ni expuesto."
 *
 * Justificación puntual (F3.4, tarea 2.1 — logo del courier, spec COU-4;
 * decisión de `arquitecto-db`/Yac, 2026-07-16): el bucket `logos-couriers`
 * es público de LECTURA con **cero políticas de escritura** — limitación
 * real de Supabase hosted descubierta al aplicar la migración: las políticas
 * de `storage.objects` no se pueden crear por SQL de este proyecto (el owner
 * de esa tabla es `supabase_storage_admin`, fuera del alcance de nuestras
 * migraciones). Con "deny-by-default" en Storage, la ÚNICA vía de escritura
 * posible es este cliente admin — usado EXCLUSIVAMENTE desde
 * `subirLogoCourier` (`lib/couriers/acciones.ts`) para el `.storage.upload()`
 * (el UPDATE de `tenants.logo_url` en la misma acción sigue con el cliente
 * de SESIÓN normal, donde RLS aplica como siempre).
 *
 * Con esta llave bypasseando RLS, la autorización real de la escritura queda
 * 100% en la capa de aplicación que llama a este cliente: `subirLogoCourier`
 * exige `exigirPermiso("config_courier:editar")` ANTES de tocar Storage, y el
 * path de destino (`<tenantId>/logo-<hash>.png`) SIEMPRE se arma con el
 * `tenantId` que sale del contexto de sesión (`resultado.contexto.membresia`),
 * nunca de un parámetro que mande el cliente (regla dura #1) — sin esas dos
 * garantías, cualquier código que use este cliente podría escribir en el
 * prefijo de CUALQUIER tenant.
 *
 * `import "server-only"` (paquete oficial de Next.js): hace fallar el BUILD
 * si este módulo se importa alguna vez desde un Client Component, en vez de
 * depender únicamente de la disciplina de no hacerlo.
 *
 * CALL SITES PERMITIDOS (la lista autoritativa y las reglas para sumar uno
 * nuevo viven en `docs/arquitectura/contratos-transversales.md` §b — leer ahí
 * ANTES de agregar otro; esa lista puede tener call sites adicionales para
 * seeds sembrados desde `crearCourier` como Super-Admin en modo plataforma —
 * ej. perfiles de cobro, modelos de entrega, plantillas de notificación —
 * mismo motivo de RLS): (1) `subirLogoCourier` (`lib/couriers/acciones.ts`,
 * Storage, descrito arriba); (2) `registrarSubclientePublico`
 * (`lib/registro-publico/acciones.ts`, tarea 2.3 fase 4) — alta pública de
 * subcliente SIN sesión desde `/registro-cliente`, tenant resuelto por
 * subdominio; (3) `generarYSubirPdfDocumento` (`lib/documentos/generar-y-subir.ts`,
 * tarea 2.7) — subida + signed URL sobre el bucket PRIVADO `documentos`
 * (deny-by-default real, única vía posible; lecturas de tablas siguen con el
 * cliente de sesión). Ver §b/§g del documento de contratos para el detalle.
 *
 * (4) `reportarPagoSuscripcion` (`lib/suscripcion/acciones.ts`, feature
 * "cobro de la suscripción a los couriers", aprobada por Yac 2026-08-15) —
 * el tenant sube su comprobante de pago (imagen/PDF) al bucket PRIVADO
 * `comprobantes-suscripcion` (bucket-only, deny-by-default, migración
 * `20260815093000`); (5) `verComprobanteSuscripcion`
 * (`lib/soporte/suscripciones/acciones.ts`) — el super-admin genera una
 * signed URL de corta duración (60s) para VER ese mismo comprobante. Mismo
 * patrón EXACTO que el caso 3 (bucket privado, escritura/lectura exclusiva
 * vía `service_role`, tablas de negocio siguen con el cliente de sesión —
 * `suscripcion_facturas` se muta SIEMPRE vía RPC `SECURITY DEFINER`, nunca
 * con este cliente admin). PENDIENTE: sumar estos 2 casos al inventario
 * autoritativo de `docs/arquitectura/contratos-transversales.md` §b
 * (responsabilidad de `arquitecto-app`, no hecho en esta entrega de
 * `backend-app`).
 *
 * (6) `flushAvisosCreacionSuscripcion` (`lib/notificaciones/flush-suscripcion-facturada.ts`,
 * Parte B del plan "correo al administrador cuando se crea su factura de
 * suscripción", aprobado por Yac 2026-08-17) — invocado SIN NINGUNA sesión
 * de usuario desde `app/api/cron/flush-suscripcion-facturada/route.ts`
 * (puente de un Cron de Vercel, protegido por `CRON_SECRET`, nunca por
 * cookies de Supabase). Llama a 2 RPC `SECURITY DEFINER` otorgadas
 * EXCLUSIVAMENTE a `service_role` (`listar_avisos_creacion_suscripcion_pendientes`/
 * `marcar_aviso_creacion_suscripcion`, migración `20260817092000`) y,
 * dentro de la misma request, reusa el mismo cliente admin para
 * `obtenerCorreosAdminsTenant` (lectura de `usuarios_tenants`/`usuarios`) y
 * `registrarEnvio` (`INSERT` en `log_envios`) — MISMA extensión de
 * superficie ya documentada para el caso 3 arriba (§b del documento de
 * contratos), aplicada a un llamador sin sesión distinto (un cron, no un
 * visitante `anon`). El `tenantId` de cada correo sale SIEMPRE de la propia
 * fila que devuelve la RPC de pendientes, nunca de un parámetro de la
 * request HTTP (no hay ningún `tenant_id` que un cliente pueda mandar: esta
 * ruta no tiene body). Sumado al inventario autoritativo de
 * `docs/arquitectura/contratos-transversales.md` §b (caso 10, y ver también
 * el caso 7 más abajo) en esta misma
 * entrega — a diferencia de los casos 4/5, todavía marcados como pendiente.
 *
 * (7) `flushNotificacionesEmision` (`lib/notificaciones/flush-notificaciones-emision.ts`,
 * outbox de email de `documento_emitido` diferido, migración
 * `20260818080000_outbox_email_documentos_pendientes.sql`) -- mismo patrón
 * EXACTO que el caso 6: sin sesión de usuario, invocado desde
 * `app/api/cron/flush-notificaciones-emision/route.ts` (cron protegido por
 * `CRON_SECRET`) y también desde un `after()` al final de `emitirDocumentos`
 * (`lib/facturacion/acciones.ts`) tras el mismo request que ya tiene sesión
 * -- se reusa el cliente admin ahí también para no depender de que la sesión
 * siga viva durante el callback de `after()`. Llama a la RPC `SECURITY
 * DEFINER` `listar_documentos_pendientes_notificacion_emision` (otorgada
 * exclusivamente a `service_role`) y reusa `notificarDocumentoEmitido`
 * (`lib/notificaciones/notificar-emision.ts`) con este mismo cliente admin.
 * El `tenantId` de cada documento sale SIEMPRE de la propia fila que
 * devuelve la RPC (cron) o del `tenantId` ya resuelto de sesión del lote
 * recién emitido (`after()`), nunca de un parámetro de una request externa.
 * PENDIENTE: sumar este caso al inventario autoritativo de
 * `docs/arquitectura/contratos-transversales.md` §b (no hecho en esta
 * entrega de `backend-app`, mismo estado que los casos 4/5).
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "createAdminClient: faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el entorno del servidor.",
    );
  }

  return createSupabaseClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
