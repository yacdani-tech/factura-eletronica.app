import { obtenerUsuarioActual, type ContextoUsuario, type UsuarioActual } from "@/lib/auth/usuario-actual";
import { textosPermisos } from "@/lib/textos/permisos";

/**
 * Guard análogo a `exigirPermiso` (`lib/auth/exigir-permiso.ts`), pero para
 * acciones exclusivas del rol de PLATAFORMA (Super-Admin), no de un rol de
 * tenant (`rol_usuario`). Cubre la gestión de couriers (COU-1/5/6, tarea 2.1):
 * alta de courier, asignar plan, bloquear/desbloquear, y "entrar" a un tenant
 * en modo soporte — ninguna de estas acciones tiene sentido para un
 * Admin/Operador/Contador de tenant, sin importar su rol.
 *
 * Config del PROPIO tenant (COU-4/6/7: editar unidades/mínimo/redondeo/
 * moneda/tipo de cambio) NO usa este guard — usa `exigirPermiso("config_courier:editar")`,
 * que ya cubre tanto al Admin real del tenant como a un Super-Admin en modo
 * soporte (rol efectivo sintético "admin", ver `calcularMembresiaEfectiva`).
 * Este guard es solo para lo que un Super-Admin hace SOBRE cualquier tenant
 * sin necesidad de "entrar" a él primero.
 *
 * NUNCA recibe un `tenantId`/`usuarioId` de parámetro: la condición de
 * Super-Admin sale siempre de `obtenerUsuarioActual()` (sesión real, columna
 * `esSuperAdmin` derivada de `public.super_admins`). La garantía real de
 * seguridad sigue siendo RLS/los triggers de BD (`private.is_super_admin()`,
 * `forzar_usuario_super_admin_tenant_activo`) — esto es la capa de UX +
 * defensa en profundidad de la app (regla dura #3), nunca el único guardia.
 */
export interface ContextoSuperAdmin {
  usuario: UsuarioActual;
}

export type ResultadoSuperAdmin =
  | { autorizado: true; contexto: ContextoSuperAdmin }
  // `motivo` (discriminante estructurado, no un string a comparar) permite al
  // llamador decidir la acción correcta sin acoplarse al texto exacto del
  // mensaje (ej. `entrarASoporte` redirige a /login si `motivo === "sin_sesion"`,
  // pero devuelve un error explícito en cualquier otro caso — ver su comentario).
  | { autorizado: false; motivo: "sin_sesion" | "no_super_admin"; error: string };

/**
 * `contextoPrevio` (opcional): si el LLAMADOR ya tiene un `ContextoUsuario`
 * fresco de esta misma request (ej. una Server Action que ya llamó
 * `obtenerUsuarioActual()` por otra razón, o un Server Component que ya
 * resolvió el contexto para renderizar la página), puede pasarlo acá para
 * evitar una segunda ronda de 4 consultas en paralelo a Supabase.
 *
 * Sin este parámetro (el caso normal), cada Server Action vuelve a llamar
 * `obtenerUsuarioActual()` — es lo correcto por defecto: las Server Actions
 * de Next.js corren AISLADAS (sin caché ni estado compartido entre
 * invocaciones), así que no hay forma de "reusar" un contexto de una llamada
 * previa sin que alguien lo pase explícitamente. Nunca se lee de una fuente
 * más vieja que la request actual (ej. una variable de módulo cacheada) —
 * eso sí sería servir un contexto stale.
 */
export async function exigirSuperAdmin(contextoPrevio?: ContextoUsuario | null): Promise<ResultadoSuperAdmin> {
  // OJO: `contextoPrevio ?? await obtenerUsuarioActual()` sería un bug acá —
  // `??` trata un `null` EXPLÍCITO (el caller ya resolvió "no hay sesión") como
  // "no provisto" y volvería a consultar, exactamente lo que este parámetro
  // existe para evitar. Se distingue con `=== undefined` (el default real de
  // "no se pasó nada"): solo en ESE caso se vuelve a llamar a
  // `obtenerUsuarioActual()`.
  const contexto = contextoPrevio === undefined ? await obtenerUsuarioActual() : contextoPrevio;

  if (!contexto) {
    return { autorizado: false, motivo: "sin_sesion", error: textosPermisos.sinSesion };
  }

  if (!contexto.esSuperAdmin) {
    return { autorizado: false, motivo: "no_super_admin", error: textosPermisos.sinPermiso };
  }

  return { autorizado: true, contexto: { usuario: contexto.usuario } };
}
