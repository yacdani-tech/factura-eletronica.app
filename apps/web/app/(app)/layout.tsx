import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";

import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { SinEquipo } from "@/components/auth/sin-equipo";
import { ShellSoporte } from "@/components/soporte/shell-soporte";
import { calcularMembresiaEfectiva, obtenerUsuarioActual } from "@/lib/auth/usuario-actual";
import { decidirVistaAppShell } from "@/lib/auth/decidir-vista-app-shell";
import { obtenerBrandingTenant } from "@/lib/tenant/branding";
import { PATHNAME_HEADER } from "@/lib/servidor/pathname-header";
import { esRutaConsolaSoporte, RUTA_CONSOLA_SOPORTE } from "@/lib/soporte/rutas";
import { subdominioActualNoExiste } from "@/lib/tenant/gate-subdominio";

/**
 * Layout del app shell. Una sola interfaz para todos los roles
 * (Admin / Operador / Contador): el rol habilita o deshabilita acciones,
 * nunca hay pantallas separadas por rol.
 *
 * Defensa en profundidad (además del middleware, que ya redirige sin
 * sesión): si por lo que sea llegara una request sin sesión hasta acá,
 * redirige a /login.
 *
 * Orden de branches (SA-2 — modo soporte de Super-Admin, capa BD en
 * 653e909):
 *   1. Sin sesión -> /login.
 *   2. `rolEfectivo` no-null -> shell normal. Cubre DOS casos con el MISMO
 *      shell (interfaz única, regla dura #12): membresía real (`rol` de
 *      `usuarios_tenants`), o Super-Admin en modo soporte (`rolEfectivo`
 *      fijo en `"admin"`, ver `lib/auth/usuario-actual.ts`) — la Topbar
 *      recibe `modoSoporte` para mostrar el banner + "Salir de soporte"
 *      cuando aplica; el Sidebar no distingue el caso, solo recibe el rol
 *      efectivo.
 *   3. Sin `rolEfectivo` pero `esSuperAdmin` -> "modo plataforma": el
 *      Super-Admin todavía no seleccionó ningún tenant. Desde la tarea 2.1
 *      (fase 3, UI), si la ruta pedida es la consola de soporte (`/soporte`
 *      o una sub-ruta, ej. `/soporte/couriers/nuevo` — ver
 *      `lib/soporte/rutas.ts`), se deja pasar `children` envuelto en
 *      `<ShellSoporte/>` (sin Sidebar: no hay tenant del que mostrar nav,
 *      pero con "Cerrar sesión" siempre accesible). Para CUALQUIER otra
 *      ruta, redirige a la consola — un Super-Admin sin selección nunca debe
 *      quedar viendo una pantalla que asume un tenant activo.
 *   4. Usuario normal sin membresía -> `<SinEquipo/>` (igual que antes).
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Gate "subdominio inexistente -> 404" en PARALELO con la resolución de
  // sesión (no suma latencia perceptible: ambas son queries indexadas). Se
  // aplica también a usuarios YA logueados (decisión de Yac) — cubre el caso
  // de una sesión vieja en un host que dejó de existir. Ver
  // `lib/tenant/gate-subdominio.ts` para el detalle de qué casos SÍ y NO
  // disparan el 404 (ej. `bloqueado` NO dispara: preserva la expulsión de
  // courier bloqueado más abajo).
  const [contexto, subdominioNoExiste] = await Promise.all([obtenerUsuarioActual(), subdominioActualNoExiste()]);

  if (subdominioNoExiste) notFound();

  if (!contexto) {
    redirect("/login");
  }

  const vista = decidirVistaAppShell(contexto);

  // Courier bloqueado (regla dura #15, bloqueo manual del súper-admin): un
  // miembro real de un tenant `estado='bloqueado'` se EXPULSA — se cierra su
  // sesión y vuelve a /login con aviso. El signOut no puede hacerse acá (un
  // Server Component no puede mutar cookies en render); se delega al route
  // handler `/salir` (GET), que limpia la sesión ANTES de caer en /login
  // (evita el loop /login <-> /dashboard). La RLS ya le niega los datos
  // (`current_tenant_id()` NULL, 20260815100000); esto es la expulsión visible.
  if (vista === "courier_bloqueado") {
    redirect("/salir?motivo=courier_bloqueado");
  }

  if (vista === "modo_plataforma") {
    const encabezados = await headers();
    // Fallback explícito (ronda de revisión): si `PATHNAME_HEADER` faltara o
    // viniera vacío — el middleware no llegó a setearlo (ej. una navegación
    // interna de RSC que no pasara por el matcher, o cualquier otro camino
    // no previsto) — `encabezados.get(...)` devuelve `null`.
    // `esRutaConsolaSoporte(null)` ya devuelve `false` (ver su propio guard
    // `if (!pathname) return false`), así que este caso cae solo en la MISMA
    // rama seguro-por-defecto que "cualquier otra ruta": redirige a la
    // consola (`/soporte`), el home natural de un Super-Admin sin tenant
    // seleccionado. Nunca se interpreta la ausencia del header como "sí es
    // la consola" — eso sería el sentido menos seguro del fallback.
    const pathname = encabezados.get(PATHNAME_HEADER);

    if (esRutaConsolaSoporte(pathname)) {
      return <ShellSoporte usuario={contexto.usuario}>{children}</ShellSoporte>;
    }

    redirect(RUTA_CONSOLA_SOPORTE);
  }

  if (vista === "sin_equipo") {
    return <SinEquipo />;
  }

  // vista === "shell" -> `rolEfectivo` es no-null por construcción de
  // `decidirVistaAppShell` (única forma de llegar acá), pero TypeScript no
  // puede inferir esa relación entre dos campos distintos del mismo objeto
  // — se re-chequea explícito para que el tipo de `Sidebar.rol` (no-nulo)
  // quede satisfecho sin recurrir a un `!` no verificado.
  if (!contexto.rolEfectivo) {
    return <SinEquipo />;
  }

  // Branding del tenant EFECTIVO (real o modo soporte, misma regla que
  // `rolEfectivo`) para el Sidebar (logo + nombre del courier, pedido de Yac
  // 2026-07-17). `calcularMembresiaEfectiva` es no-null acá por construcción
  // (mismo argumento que el re-chequeo de `rolEfectivo` de arriba: la vista
  // "shell" solo se llega con membresía real o `modoSoporte`), pero se
  // degrada con gracia a branding default si por lo que sea diera `null` —
  // nunca debe romper el shell.
  const membresiaEfectiva = calcularMembresiaEfectiva(contexto.membresia, contexto.modoSoporte);
  const branding = membresiaEfectiva ? await obtenerBrandingTenant(membresiaEfectiva.tenantId) : null;

  return (
    // Scroll de DOCUMENTO (un solo scrollbar — el del navegador), no un
    // contenedor `overflow-y-auto` interno (aprendizaje 2026-07-17, ver
    // `.claude/agents/ui-app.md`): el wrapper ya NO fija `h-dvh`/
    // `overflow-hidden`, así que el único elemento que scrollea es el
    // documento. El `Sidebar` se mantiene fijo con `sticky top-0 h-dvh` (ver
    // ese componente) y la `Topbar` con `sticky top-0` (incluye el banner de
    // modo soporte, que nunca debe perderse de vista al scrollear).
    <div className="flex min-h-dvh bg-background">
      <Sidebar rol={contexto.rolEfectivo} tenantNombre={branding?.nombre ?? null} logoUrl={branding?.logoUrl ?? null} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar usuario={contexto.usuario} modoSoporte={contexto.modoSoporte} />
        <main className="flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
