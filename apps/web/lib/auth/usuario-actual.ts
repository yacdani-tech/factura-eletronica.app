import { cache } from "react";

import type { RolUsuario } from "@factura/core/auth/tipos";

import { createClient } from "@/lib/supabase/server";

/** Roles de tenant del esqueleto: `admin` (acceso completo) y `operador` (secundario). Espejo del enum `public.rol_usuario`. Fuente única en `@factura/core`; se re-exporta acá para los consumidores existentes. */
export type { RolUsuario };

/** Mismos valores que el enum `public.estado_membresia` (20260713090200). */
export type EstadoMembresia = "activo" | "inactivo";

export interface UsuarioActual {
  id: string;
  email: string;
  nombre: string | null;
}

export interface MembresiaActual {
  tenantId: string;
  rol: RolUsuario;
  estado: EstadoMembresia;
}

/**
 * Modo soporte (SA-2, capa BD ya aplicada en 653e909): un Super-Admin de
 * plataforma tiene una fila en `super_admin_tenant_activo` seleccionando un
 * tenant para operar sin ser miembro. `tenantId` es EXACTAMENTE el valor que
 * `private.current_tenant_id()` resuelve en BD mientras dure la selección
 * (20260714221000) — nunca se construye a mano ni se acepta del cliente.
 */
export interface ModoSoporte {
  tenantId: string;
  tenantNombre: string;
}

export interface ContextoUsuario {
  usuario: UsuarioActual;
  /**
   * `null` si el usuario no tiene ninguna membresía activa real (o la única
   * que tuvo está inactiva) — incluye SIEMPRE el caso de un Super-Admin en
   * modo soporte: nunca se crea una fila falsa en `usuarios_tenants` para
   * simular una membresía (ensuciaría el staff real del tenant y el conteo
   * de "admins activos" de `impedir_tenant_sin_admin_activo`). Para saber si
   * hay "algo" operable, usar `rolEfectivo`, no este campo.
   */
  membresia: MembresiaActual | null;
  /** true si `auth.uid()` está registrado en `public.super_admins` (rol de plataforma, no un rol de tenant). */
  esSuperAdmin: boolean;
  /** No-null solo si `esSuperAdmin` y tiene selección activa en `super_admin_tenant_activo`. */
  modoSoporte: ModoSoporte | null;
  /**
   * Rol a usar para GATING (Sidebar, `puede()`, `exigirPermiso`) — NUNCA para
   * mostrar "tu rol es X" en la UI de forma literal. Reglas:
   *   - `membresia.rol` si hay membresía activa real.
   *   - si no, `"admin"` fijo cuando hay `modoSoporte` (acceso total: coincide
   *     con `private.is_admin() = true` en BD para un Super-Admin en soporte,
   *     20260714221000 — NO se puede leer `private.current_rol()` para esto
   *     porque esa función deliberadamente sigue devolviendo NULL en soporte,
   *     ver comentario de esa migración).
   *   - `null` si ninguna de las dos (sin equipo, o Super-Admin sin selección
   *     todavía — "modo plataforma").
   * Puramente derivado en memoria para esta request; no persiste nada.
   */
  rolEfectivo: RolUsuario | null;
  /**
   * `true` SOLO cuando el usuario tiene una **membresía real activa** cuyo
   * tenant está `estado='bloqueado'` (súper-admin bloqueó el courier desde la
   * consola de soporte, regla dura #15 del bloqueo manual). En ese caso el
   * layout del app shell lo expulsa (cierra sesión + `/login` con aviso) y
   * `exigirPermiso` rechaza cualquier Server Action — defensa en profundidad
   * de la app; el backstop REAL es RLS (`private.current_tenant_id()` devuelve
   * NULL para un miembro de tenant bloqueado, 20260815100000).
   *
   * Se resuelve con la RPC `public.tenant_bloqueado_propio()` (`SECURITY
   * DEFINER`, 20260815110000), NO leyendo `usuarios_tenants`/`tenants` con el
   * cliente de sesión: esa misma migración 20260815100000 hace que RLS le
   * niegue al miembro bloqueado leer su propia fila (dependencia circular), así
   * que la detección tiene que esquivar RLS.
   *
   * SIEMPRE `false` para un Super-Admin y para el modo soporte: un Super-Admin
   * de plataforma no tiene membresía real activa (opera vía
   * `super_admin_tenant_activo`), así que debe poder seguir gestionando y
   * DESBLOQUEAR un tenant bloqueado (se combina con `!esSuperAdmin` al derivar).
   */
  tenantBloqueado: boolean;
}

interface FilaUsuario {
  id: string;
  email: string;
  nombre: string | null;
}

interface FilaMembresia {
  tenant_id: string;
  rol: RolUsuario;
  estado: EstadoMembresia;
}

interface FilaSuperAdmin {
  usuario_id: string;
}

interface FilaSoporteActivo {
  tenant_id: string;
}

interface FilaTenantNombre {
  nombre: string;
}

/**
 * Contexto del usuario autenticado: sesión + fila de `usuarios` + membresía
 * (`usuarios_tenants`, con rol y estado) + modo soporte de Super-Admin
 * (`super_admins` / `super_admin_tenant_activo`, capa BD de SA-2, commit
 * 653e909). Cuatro consultas en PARALELO (no encadenadas) — un solo
 * round-trip efectivo para el caso normal, sin depender de la sintaxis de
 * embed de PostgREST entre tablas para mantener esto simple de verificar. Si
 * el usuario resulta ser un Super-Admin CON selección activa, hace falta una
 * quinta consulta secuencial (leer el nombre del tenant seleccionado) — solo
 * ese caso paga el round-trip extra.
 *
 * Devuelve `null` si NO hay sesión (el llamador decide qué hacer — el layout
 * del app shell redirige a `/login`, defensa en profundidad además del
 * middleware). Si hay sesión pero sin membresía ACTIVA, `membresia` viene en
 * `null`: la política `usuarios_tenants_ver_mismo_tenant` (20260713090200)
 * ya filtra por `tenant_id = private.current_tenant_id()`, que a su vez solo
 * resuelve membresías con `estado = 'activo'` (20260713090000) — así que si
 * la consulta no devuelve fila, o bien no existe membresía, o bien la única
 * que existió está inactiva (mismo resultado desde el punto de vista de la
 * UI: "no pertenece a un equipo activo"). Igual se re-valida `estado`
 * explícitamente acá por regla dura #3 (el backend bloquea de verdad, nunca
 * confía ciegamente en que RLS ya filtró todo).
 *
 * NUNCA recibe ni acepta un `tenant_id` de parámetro: el tenant sale
 * exclusivamente de la membresía real del usuario autenticado, o (modo
 * soporte) de `super_admin_tenant_activo` — ambos leídos con el cliente del
 * propio usuario, protegidos por RLS, nunca de algo que mande el cliente.
 *
 * Memoizado con `React.cache`: en un mismo render de servidor esta función se
 * invoca varias veces (el Server Component la llama directo Y cada
 * `exigirPermiso` de una Server Action la vuelve a llamar), y cada invocación
 * pagaba un `auth.getUser()` (round-trip a GoTrue, la operación más lenta) +
 * 5 consultas. `cache` deduplica todo eso a UNA sola ejecución por request
 * (scope por-request, sin argumentos: hay exactamente un usuario autenticado
 * por request, así que la clave vacía es correcta y no cruza tenants). Es una
 * optimización PURA: no cambia el resultado ni la lógica de resolución de
 * tenant.
 */
export const obtenerUsuarioActual = cache(async function obtenerUsuarioActual(): Promise<ContextoUsuario | null> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const [usuarioResp, membresiaResp, superAdminResp, soporteResp, bloqueadoResp] = await Promise.all([
    supabase.from("usuarios").select("id, email, nombre").eq("id", user.id).maybeSingle<FilaUsuario>(),
    supabase
      .from("usuarios_tenants")
      .select("tenant_id, rol, estado")
      .eq("usuario_id", user.id)
      .maybeSingle<FilaMembresia>(),
    // RLS `super_admins_solo_super_admin` (20260713090200): solo un
    // super-admin ve su propia fila (y las de los demás — "for all" sin
    // filtrar usuario_id — pero acá igual se filtra explícito por claridad
    // y para no traer más de una fila). Para cualquier otro usuario, 0 filas.
    supabase
      .from("super_admins")
      .select("usuario_id")
      .eq("usuario_id", user.id)
      .maybeSingle<FilaSuperAdmin>(),
    // RLS `super_admin_tenant_activo_propia_fila` (20260714220000): solo el
    // propio Super-Admin ve su propia selección. Para cualquier otro
    // usuario (incluido un Super-Admin sin selección), 0 filas.
    supabase
      .from("super_admin_tenant_activo")
      .select("tenant_id")
      .eq("usuario_id", user.id)
      .maybeSingle<FilaSoporteActivo>(),
    // Detección del BLOQUEO propio (feature "bloquear courier expulsa",
    // 20260815110000). NO se puede derivar leyendo `usuarios_tenants`/`tenants`
    // con el cliente de sesión: la migración 20260815100000 hace que
    // `current_tenant_id()` sea NULL para un miembro de tenant bloqueado, y las
    // policies de SELECT de ambas tablas dependen de esa función — así que RLS
    // le niega leer su PROPIA fila justo en el caso que hay que detectar
    // (dependencia circular). La RPC `public.tenant_bloqueado_propio()` es
    // `SECURITY DEFINER` y esquiva RLS: devuelve `true` solo si el usuario
    // tiene membresía ACTIVA en un tenant `estado='bloqueado'`.
    supabase.rpc("tenant_bloqueado_propio"),
  ]);

  if (usuarioResp.error) {
    console.error("[auth] obtenerUsuarioActual: error leyendo usuarios:", usuarioResp.error.message);
  }
  if (membresiaResp.error) {
    console.error(
      "[auth] obtenerUsuarioActual: error leyendo usuarios_tenants:",
      membresiaResp.error.message,
    );
  }
  if (superAdminResp.error) {
    console.error("[auth] obtenerUsuarioActual: error leyendo super_admins:", superAdminResp.error.message);
  }
  if (bloqueadoResp.error) {
    console.error(
      "[auth] obtenerUsuarioActual: error leyendo tenant_bloqueado_propio:",
      bloqueadoResp.error.message,
    );
  }
  if (soporteResp.error) {
    console.error(
      "[auth] obtenerUsuarioActual: error leyendo super_admin_tenant_activo:",
      soporteResp.error.message,
    );
  }

  // La fila de `usuarios` la crea el trigger `trg_auth_users_crear_usuario`
  // en la MISMA transacción del signup — no debería faltar nunca para una
  // sesión válida, pero por si hay una carrera real (justo después del
  // signup) o un error de lectura, se arma un fallback mínimo con lo que ya
  // sabe Supabase Auth en vez de reventar la página.
  const usuario: UsuarioActual = usuarioResp.data
    ? { id: usuarioResp.data.id, email: usuarioResp.data.email, nombre: usuarioResp.data.nombre }
    : { id: user.id, email: user.email ?? "", nombre: null };

  const filaMembresia = membresiaResp.data;
  const membresia: MembresiaActual | null =
    filaMembresia && filaMembresia.estado === "activo"
      ? { tenantId: filaMembresia.tenant_id, rol: filaMembresia.rol, estado: filaMembresia.estado }
      : null;

  const esSuperAdmin = Boolean(superAdminResp.data);

  // `tenantBloqueado`: resultado de la RPC `tenant_bloqueado_propio()`
  // (`SECURITY DEFINER`, esquiva la circularidad de RLS — ver el comentario de
  // la 5ª consulta). `true` solo para un miembro real activo de un tenant
  // `estado='bloqueado'`. Se combina con `!esSuperAdmin` como defensa en
  // profundidad para garantizar que un Super-Admin JAMÁS quede marcado como
  // bloqueado (debe poder gestionar/desbloquear) — aunque la RPC ya devuelve
  // `false` para él (no tiene membresía real activa). Ante un error de la RPC,
  // `data` es `null` -> `false` (fail-open en la DETECCIÓN de UX, nunca en la
  // seguridad: el backstop real es la RLS de 20260815100000, que niega los
  // datos igual).
  const tenantBloqueado = bloqueadoResp.data === true && !esSuperAdmin;

  let modoSoporte: ModoSoporte | null = null;
  // Defensa en profundidad: aunque `super_admin_tenant_activo` solo puede
  // tener filas de Super-Admins reales (guardia de BD, trigger
  // `forzar_usuario_super_admin_tenant_activo`, 20260714220000), acá igual se
  // exige `esSuperAdmin` explícito antes de confiar en la selección — nunca
  // se activa modo soporte solo porque la tabla devolvió una fila.
  if (esSuperAdmin && soporteResp.data) {
    const tenantId = soporteResp.data.tenant_id;
    // Solo se paga este round-trip extra en el caso raro (Super-Admin CON
    // selección activa). La policy `tenants_ver_propio_o_super_admin`
    // (20260713090200) deja ver CUALQUIER tenant a un Super-Admin, sin
    // importar cuál tenga seleccionado.
    const tenantResp = await supabase
      .from("tenants")
      .select("nombre")
      .eq("id", tenantId)
      .maybeSingle<FilaTenantNombre>();

    if (tenantResp.error) {
      console.error(
        "[auth] obtenerUsuarioActual: error leyendo tenants (modo soporte):",
        tenantResp.error.message,
      );
    }

    if (tenantResp.data) {
      modoSoporte = { tenantId, tenantNombre: tenantResp.data.nombre };
    } else {
      // No debería pasar (FK de super_admin_tenant_activo.tenant_id ->
      // tenants.id): se loguea sin exponer nada sensible y se deja
      // modoSoporte en null (el layout cae al placeholder "modo plataforma"
      // en vez de mostrar un shell con nombre de tenant vacío).
      console.error(
        "[auth] obtenerUsuarioActual: super_admin_tenant_activo apunta a un tenant no legible:",
        tenantId,
      );
    }
  }

  const rolEfectivo = calcularRolEfectivo(membresia, modoSoporte);

  return { usuario, membresia, esSuperAdmin, modoSoporte, rolEfectivo, tenantBloqueado };
});

/**
 * Deriva el rol EFECTIVO de gating a partir de la membresía real y del modo
 * soporte — función PURA (sin I/O), extraída así para poder testearla sin
 * mockear Supabase y para que `exigirPermiso` (Server Actions) use EXACTAMENTE
 * la misma regla que `obtenerUsuarioActual` (Sidebar/Server Components), sin
 * duplicar la lógica en dos archivos.
 *
 * Reglas (ver también el comentario de `ContextoUsuario.rolEfectivo`):
 *   1. Membresía real activa -> su `rol` (Admin/Operador/Contador tal cual).
 *   2. Sin membresía pero con `modoSoporte` -> `"admin"` fijo (acceso total,
 *      coherente con `private.is_admin() = true` en BD, 20260714221000).
 *   3. Ninguna de las dos -> `null` (sin acceso: sin equipo, o Super-Admin
 *      todavía sin seleccionar tenant — "modo plataforma").
 */
export function calcularRolEfectivo(
  membresia: MembresiaActual | null,
  modoSoporte: ModoSoporte | null,
): RolUsuario | null {
  if (membresia) return membresia.rol;
  if (modoSoporte) return "admin";
  return null;
}

/**
 * Arma la `MembresiaActual` a usar para gating de Server Actions
 * (`exigirPermiso`): la real si existe, o una SINTÉTICA en memoria para modo
 * soporte (`tenantId` = `modoSoporte.tenantId` — idéntico a lo que
 * `private.current_tenant_id()` ya resuelve en BD para este usuario; `rol:
 * "admin"` fijo). NUNCA escribe nada en `usuarios_tenants`: es un valor
 * derivado puro, solo para esta request. `null` si no hay ninguna de las dos
 * (sin acceso).
 */
export function calcularMembresiaEfectiva(
  membresia: MembresiaActual | null,
  modoSoporte: ModoSoporte | null,
): MembresiaActual | null {
  if (membresia) return membresia;
  if (modoSoporte) return { tenantId: modoSoporte.tenantId, rol: "admin", estado: "activo" };
  return null;
}
