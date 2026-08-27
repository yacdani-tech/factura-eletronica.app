import {
  obtenerUsuarioActual,
  calcularMembresiaEfectiva,
  type MembresiaActual,
  type UsuarioActual,
} from "./usuario-actual";
import { puede, type Permiso } from "@factura/core/permisos";
import { textosPermisos } from "./textos-permisos";

/**
 * Guard reutilizable para Server Actions (regla dura #3: "toda acción
 * verifica rol y permiso ANTES de ejecutar. La UI solo muestra/oculta; el
 * backend bloquea de verdad").
 *
 * Devuelve un resultado estructurado (mismo espíritu que `EstadoAccionAuth`
 * en `lib/auth/tipos.ts`: `{ error?: string }` listo para retornarse tal
 * cual desde una Server Action) en vez de lanzar, para que el llamador pueda
 * hacer:
 *
 * ```ts
 * const resultado = await exigirPermiso("staff:gestionar");
 * if (!resultado.autorizado) return { error: resultado.error };
 * const { membresia } = resultado.contexto; // tenantId + rol, tipados sin null
 * ```
 *
 * Importante: esto es UX + defensa en profundidad de la capa de app. La
 * garantía real de aislamiento por tenant y por rol es RLS en la base
 * (`private.is_admin()`, políticas de `usuarios_tenants`/`invitaciones`/
 * `tenants`, 20260714201000) — un bug acá nunca debería poder filtrar datos
 * de otro tenant ni de otro rol, solo dar una peor experiencia (un 42501
 * crudo de Postgres en vez de un mensaje de negocio en español).
 *
 * NUNCA recibe un `tenantId` de parámetro: el tenant/rol salen siempre de
 * `obtenerUsuarioActual()` (sesión real), nunca de algo que mande el
 * llamador.
 *
 * MODO SOPORTE (SA-2): un Super-Admin en soporte no tiene membresía real
 * (`contexto.membresia` viene `null`), pero SÍ tiene acceso total en el
 * tenant que seleccionó (`private.is_admin() = true` en BD, 20260714221000).
 * Sin este caso, el gating de Sidebar (que sí respeta `rolEfectivo`, ver
 * `app/(app)/layout.tsx`) mostraría la nav habilitada pero CADA acción real
 * fallaría acá con "sin equipo" — literalmente "romper" al Super-Admin, lo
 * que esta fase debe evitar. Por eso, si no hay membresía real pero sí
 * `modoSoporte`, se arma una `MembresiaActual` SINTÉTICA en memoria
 * (`tenantId` = `modoSoporte.tenantId`, idéntico a lo que
 * `private.current_tenant_id()` ya resuelve en BD para este usuario; `rol:
 * "admin"` fijo, acceso total) — nunca se escribe una fila falsa en
 * `usuarios_tenants` para esto, es puramente un valor derivado para esta
 * request. El `tenantId` usado para INSERT/UPDATE (ej. `crearInvitacion`)
 * sigue siendo correcto: es el mismo valor que ya autoriza la RLS del tenant
 * seleccionado.
 */
export interface ContextoAutorizado {
  usuario: UsuarioActual;
  membresia: MembresiaActual;
  /** true si este contexto viene de un Super-Admin en modo soporte (sin membresía real) — por si algún llamador necesita distinguirlo (ej. logs). */
  modoSoporte: boolean;
}

export type ResultadoPermiso =
  | { autorizado: true; contexto: ContextoAutorizado }
  | { autorizado: false; error: string };

export async function exigirPermiso(permiso: Permiso): Promise<ResultadoPermiso> {
  const contexto = await obtenerUsuarioActual();

  if (!contexto) {
    return { autorizado: false, error: textosPermisos.sinSesion };
  }

  // Courier bloqueado (regla dura #15): un miembro real de un tenant
  // `estado='bloqueado'` no puede ejecutar NINGUNA Server Action gateada —
  // backstop de app además de la expulsión del layout y de la RLS
  // (`current_tenant_id()` NULL, 20260815100000). El Super-Admin NUNCA entra
  // acá con `tenantBloqueado=true` (no tiene membresía real activa), pero se
  // exige `!esSuperAdmin` explícito como defensa en profundidad para que jamás
  // se le bloquee gestionar/desbloquear un tenant.
  if (contexto.tenantBloqueado && !contexto.esSuperAdmin) {
    return { autorizado: false, error: textosPermisos.courierBloqueado };
  }

  const modoSoporte = contexto.modoSoporte;
  const membresiaEfectiva = calcularMembresiaEfectiva(contexto.membresia, modoSoporte);

  if (!membresiaEfectiva) {
    return { autorizado: false, error: textosPermisos.sinEquipo };
  }

  if (!puede(membresiaEfectiva.rol, permiso)) {
    return { autorizado: false, error: textosPermisos.sinPermiso };
  }

  return {
    autorizado: true,
    contexto: {
      usuario: contexto.usuario,
      membresia: membresiaEfectiva,
      modoSoporte: modoSoporte !== null,
    },
  };
}
