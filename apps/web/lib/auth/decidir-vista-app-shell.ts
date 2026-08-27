import type { ContextoUsuario } from "@factura/db/auth/usuario-actual";

/**
 * Qué renderiza `app/(app)/layout.tsx` para una sesión YA autenticada
 * (sin sesión, el layout redirige a /login ANTES de llegar acá — esa rama no
 * es parte de esta función pura).
 *
 *   - "courier_bloqueado": el usuario es MIEMBRO real de un tenant que el
 *     súper-admin bloqueó (`tenantBloqueado`). Se evalúa PRIMERO: el layout lo
 *     expulsa (cierra sesión + `/login` con aviso) antes que cualquier otra
 *     vista. Nunca aplica a un Super-Admin (debe poder gestionar/desbloquear).
 *   - "shell": el app shell normal — cubre membresía real Y Super-Admin en
 *     modo soporte por igual (interfaz única, regla dura #12); la Topbar es
 *     la que distingue el caso soporte con su banner.
 *   - "modo_plataforma": Super-Admin de plataforma SIN selección de tenant
 *     todavía. El layout decide qué mostrar según la ruta pedida (tarea 2.1,
 *     fase 3): la consola de soporte (`/soporte` y sub-rutas, ver
 *     `lib/soporte/rutas.ts`) renderiza normal dentro de `<ShellSoporte/>`;
 *     cualquier otra ruta redirige a la consola.
 *   - "sin_equipo": usuario normal sin membresía en ningún tenant.
 */
export type VistaAppShell = "courier_bloqueado" | "shell" | "modo_plataforma" | "sin_equipo";

/**
 * Función PURA (sin I/O) para poder testear la decisión de branch sin
 * mockear Supabase/Next — el layout solo llama a esto y renderiza según el
 * resultado.
 */
export function decidirVistaAppShell(
  contexto: Pick<ContextoUsuario, "rolEfectivo" | "esSuperAdmin" | "tenantBloqueado">,
): VistaAppShell {
  // PRIMERO: un miembro real de un tenant bloqueado se expulsa, gane o no
  // `rolEfectivo`. `tenantBloqueado` ya es `false` para todo Super-Admin (no
  // tiene membresía real activa), así que este branch nunca lo alcanza —
  // igual se exige `!esSuperAdmin` explícito como defensa en profundidad.
  if (contexto.tenantBloqueado && !contexto.esSuperAdmin) return "courier_bloqueado";
  if (contexto.rolEfectivo) return "shell";
  if (contexto.esSuperAdmin) return "modo_plataforma";
  return "sin_equipo";
}
