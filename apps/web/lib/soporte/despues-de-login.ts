import type { SupabaseClient, User } from "@supabase/supabase-js";

import { esRutaConsolaSoporte, RUTA_CONSOLA_SOPORTE } from "@/lib/soporte/rutas";

/**
 * Función PURA (sin I/O) — mismo patrón que `decidirVistaAppShell`/
 * `calcularRolEfectivo` (`lib/auth/usuario-actual.ts`): la REGLA de decisión
 * del destino post-login, testeable sin mockear Supabase (pedido explícito
 * del reviewer, ronda 2026-07-16). La única pieza con I/O
 * (`esSuperAdminActual`, más abajo) NO decide nada por sí sola — solo
 * resuelve el booleano `esSuperAdmin` que alimenta a esta función.
 *
 * Contrato (decisión de Yac 2026-07-17): un Super-Admin aterriza SIEMPRE en
 * `/soporte` (la consola), CON UNA excepción — si `nextExplicito` ya apunta a
 * la propia consola o una sub-ruta suya (`esRutaConsolaSoporte`, ej.
 * `/soporte/couriers/nuevo`), se respeta ese deep-link tal cual. Cualquier
 * otro `next` (ej. `/dashboard`, `/configuracion/equipo`) se IGNORA para un
 * Super-Admin. Cualquier otro usuario (rol de tenant): `nextExplicito` GANA
 * SIEMPRE; sin `next`, cae en `/dashboard`.
 */
export function calcularDestinoPostLogin(
  nextExplicito: string | null,
  esSuperAdmin: boolean,
): string {
  if (esSuperAdmin) {
    return esRutaConsolaSoporte(nextExplicito) ? (nextExplicito as string) : RUTA_CONSOLA_SOPORTE;
  }
  return nextExplicito ?? "/dashboard";
}

/**
 * ÚNICA parte de `calcularDestinoPostLogin` con I/O: resuelve si `userId` es
 * un Super-Admin de plataforma. Usa el MISMO cliente de sesión ya
 * autenticado del caller — NUNCA `service_role` (regla dura #9): la política
 * `super_admins_solo_super_admin` (20260713090200) ya garantiza 0 filas para
 * cualquiera que no sea super-admin, así que el resultado de esta única
 * consulta YA ES la respuesta, sin necesidad de validar el rol dos veces.
 *
 * Nunca lanza: cualquier fallo (error de Postgres, o incluso una excepción
 * síncrona si el cliente no expone `.from`, como en algunos mocks mínimos de
 * test) se loguea y degrada a `false` (se trata como "no es Super-Admin") —
 * el post-login jamás debe romper el redirect real del login.
 */
export async function esSuperAdminActual(
  supabase: SupabaseClient,
  userId: string | null | undefined,
): Promise<boolean> {
  if (!userId) return false;

  try {
    const { data, error } = await supabase
      .from("super_admins")
      .select("usuario_id")
      .eq("usuario_id", userId)
      .maybeSingle();

    if (error) {
      console.error("[soporte] esSuperAdminActual: error leyendo super_admins:", error.message);
      return false;
    }

    return Boolean(data);
  } catch (excepcion) {
    console.error(
      "[soporte] esSuperAdminActual: excepción inesperada leyendo super_admins:",
      excepcion instanceof Error ? excepcion.message : excepcion,
    );
    return false;
  }
}

/**
 * Borra (best-effort) la fila PROPIA de selección activa de soporte en
 * `super_admin_tenant_activo`. Pieza interna de `procesarPostLogin` — nunca
 * se exporta ni se llama sola: no tiene sentido de negocio por fuera de "esto
 * pasó porque el usuario que acaba de loguear es Super-Admin".
 *
 * Regla dura #1: `usuarioId` viene SIEMPRE del `user.id` de la sesión recién
 * creada (nunca de un parámetro externo) — el único caller
 * (`procesarPostLogin`) lo pasa directo desde `user.id`, jamás desde
 * `nextExplicito` ni ningún otro dato controlado por el cliente.
 *
 * Nunca lanza (mismo criterio que `esSuperAdminActual` y que
 * `salirDeSoporte`, `lib/soporte/acciones.ts`, de donde se copia el patrón de
 * manejo de errores): un fallo acá (error de Postgres o excepción síncrona)
 * se loguea y se ignora — el login JAMÁS debe romperse ni degradarse por
 * esto. En el peor caso (el delete falla) el Super-Admin simplemente
 * conserva la fila vieja de selección un ciclo más; el destino post-login
 * sigue siendo `/soporte` de todos modos (lo decide `calcularDestinoPostLogin`
 * de forma independiente, no depende de que este delete haya funcionado).
 */
async function borrarSeleccionActivaDeSoporte(supabase: SupabaseClient, usuarioId: string): Promise<void> {
  try {
    const { error } = await supabase.from("super_admin_tenant_activo").delete().eq("usuario_id", usuarioId);

    if (error) {
      console.error(
        "[soporte] procesarPostLogin: error al borrar la selección activa de soporte:",
        error.message,
      );
    }
  } catch (excepcion) {
    console.error(
      "[soporte] procesarPostLogin: excepción inesperada borrando la selección activa de soporte:",
      excepcion instanceof Error ? excepcion.message : excepcion,
    );
  }
}

/**
 * ÚNICO punto de orquestación post-login: se llama tras CUALQUIER
 * autenticación exitosa que deje una sesión nueva — hoy son dos
 * (`app/auth/callback/route.ts` para Google/OAuth y confirmación de correo,
 * `iniciarSesionConPassword` en `lib/auth/acciones.ts` para login por
 * contraseña) — para no duplicar el mismo wiring en cada uno por separado.
 *
 * HISTORIA (para no repetir el mismo ciclo): esta función fusiona lo que
 * antes eran DOS funciones separadas (`despuesDeLoginExitoso`, no-op desde
 * el retiro de la auto-selección de tenant, y `resolverDestinoPostLogin`).
 * Bug reportado por Yac 2026-07-17 (ronda 2, tras el fix "Super-Admin siempre
 * a /soporte post-login"): un Super-Admin que se desloguea desde DENTRO de
 * un tenant sin usar "Salir de soporte" conserva su fila en
 * `super_admin_tenant_activo` — al volver a loguear, `calcularDestinoPostLogin`
 * ya lo manda bien a `/soporte`, pero el layout `(app)` seguía viendo esa
 * fila vieja y envolvía la consola en el shell del TENANT (sidebar de
 * cliente + consola de soporte mezclados en la misma pantalla).
 *
 * Decisión de Yac: "cada vez que se loguea un superuser va directo al
 * dashboard de soporte" — loguearse es una sesión de plataforma FRESCA. Por
 * eso, en CADA login exitoso de un Super-Admin, se borra su selección activa
 * (best-effort, `borrarSeleccionActivaDeSoporte`) ANTES de devolver el
 * destino: así el próximo render del layout siempre cae en `modo_plataforma`
 * y la consola se muestra limpia dentro de `<ShellSoporte/>`, sin sidebar de
 * tenant. La navegación EN CALIENTE no cambia: `entrarASoporte`/
 * `salirDeSoporte` (`lib/soporte/acciones.ts`) y el caso "Super-Admin en
 * soporte navega manualmente a /soporte para cambiar de courier" siguen
 * exactamente igual — esto solo afecta el momento del LOGIN.
 *
 * UNA sola consulta a `super_admins` por login (no dos, ni una por cada
 * función separada de antes): se resuelve `esSuperAdmin` una única vez y se
 * reutiliza tanto para decidir si corresponde el borrado como para calcular
 * el destino final.
 *
 * Nunca lanza, por construcción: `esSuperAdminActual` y
 * `borrarSeleccionActivaDeSoporte` atrapan internamente cualquier error
 * (Postgres o excepción síncrona) y `calcularDestinoPostLogin` es pura y
 * síncrona — el post-login jamás debe romper el redirect real del login. Los
 * dos callers igual envuelven su invocación en un `try/catch` propio como
 * defensa en profundidad (mismo criterio que ya se probaba para
 * `despuesDeLoginExitoso`): si este contrato alguna vez se rompiera, el
 * login no debe fallar por eso.
 */
export async function procesarPostLogin(
  supabase: SupabaseClient,
  user: User | null,
  nextExplicito: string | null,
): Promise<string> {
  const esSuperAdmin = await esSuperAdminActual(supabase, user?.id);

  if (esSuperAdmin && user?.id) {
    await borrarSeleccionActivaDeSoporte(supabase, user.id);
  }

  return calcularDestinoPostLogin(nextExplicito, esSuperAdmin);
}
