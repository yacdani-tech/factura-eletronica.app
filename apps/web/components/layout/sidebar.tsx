"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  Settings,
  ChevronsLeft,
  ChevronsRight,
  Loader2,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { navItems, navNavegandoTexto, navSinPermisoTexto, type NavIconName } from "@/lib/nav";
import { puede } from "@/lib/permisos";
import { usePreferenciaSidebarContraida } from "@/components/layout/usar-preferencia-sidebar";
import type { RolUsuario } from "@/lib/auth/usuario-actual";

const iconMap: Record<NavIconName, LucideIcon> = {
  LayoutDashboard,
  Users,
  Settings,
};

interface SidebarProps {
  /** Rol de la membresía activa del usuario (viene de `obtenerUsuarioActual`, layout `(app)`). */
  rol: RolUsuario;
  /**
   * Nombre del courier (tenant EFECTIVO de la sesión — real o modo soporte,
   * ver `calcularMembresiaEfectiva`). `null` si no se pudo leer el branding
   * (degradación con gracia, nunca rompe el shell): conserva el wordmark
   * default "factura-eletronica.app".
   */
  tenantNombre: string | null;
  /** Logo subido por el courier (Storage), o `null` para el isotipo default. */
  logoUrl: string | null;
}

/**
 * Navegación vertical del app shell.
 *
 * Regla dura #12 (una sola interfaz): el rol habilita/deshabilita ítems, acá
 * NUNCA se arman menús distintos por rol. Un ítem sin `permiso` en
 * `lib/nav.ts` queda habilitado para cualquier rol; con `permiso`, se
 * deshabilita (visible, no clickeable, con tooltip) para quien no lo tenga
 * — se eligió "deshabilitado visible" antes que "oculto" (MASTER.md no dicta
 * esto explícitamente, pero es consistente con el espíritu de interfaz
 * única: el usuario siempre sabe qué existe, aunque no pueda entrar).
 *
 * **Modo icono en móvil — CSS-first (fix 2026-07-17 de un bug de
 * plataforma):** por debajo de `sm` (640px) el Sidebar SIEMPRE es modo icono
 * (68px). Esto se resuelve 100% con clases responsive de Tailwind (mobile
 * primero: `w-[68px]`, override `sm:w-64` solo si no está colapsado), NUNCA
 * con JavaScript/`matchMedia` — la versión anterior decidía el ancho móvil
 * con un hook `useEsViewportMovil` (`matchMedia` en un `useEffect`, con
 * estado inicial `false` para no romper la hidratación). Consecuencia real:
 * el SSR y el primer paint del cliente SIEMPRE mandaban el aside a 256px
 * (`w-64`) sin importar el viewport; recién colapsaba a 68px cuando el
 * efecto corría Y la transición CSS de 200ms terminaba — una ventana real de
 * ~250-300ms donde CUALQUIER página, en CUALQUIER viewport móvil, desbordaba
 * horizontalmente todo el documento (hallado por qa-tests en la tarea 2.2,
 * `docs/PROGRESO.md`). La lección: una decisión de LAYOUT que puede
 * expresarse en CSS (media query) nunca debe decidirse en JS — CSS aplica en
 * el primer paint, JS necesita un ciclo de render adicional (y en SSR, un
 * viaje al cliente) para actuar. `useEsViewportMovil` quedó sin consumidores
 * tras este fix y se eliminó junto con sus tests — si en el futuro hace
 * falta la MISMA lógica en JS para algo que no sea layout/visibilidad (ej.
 * cambiar un comportamiento de interacción, no solo estilos), reintroducirla
 * ahí y no antes.
 */
export function Sidebar({ rol, tenantNombre, logoUrl }: SidebarProps) {
  const pathname = usePathname();
  // Colapso MANUAL (botón "Contraer menú"), solo relevante en `sm:` hacia
  // arriba — el botón que lo controla está oculto por debajo de ese
  // breakpoint (ver el `div` del toggle, más abajo), así que este estado
  // nunca puede alternarse desde un viewport móvil ni necesita saber en qué
  // viewport está: el CSS ya fuerza modo icono en móvil sin consultarlo.
  //
  // Persistencia (Yac 2026-07-31): la preferencia vive en localStorage, pero
  // el SSR y el PRIMER paint del cliente arrancan SIEMPRE expandido (`false`)
  // — el className del `aside` es SSR-crítico, así que inicializar desde
  // localStorage causaría un mismatch de hidratación (el mismo tipo de bug
  // de primer paint que motivó todo el diseño CSS-first de este componente).
  // La preferencia guardada se aplica en un efecto de montaje, y la
  // transición de ancho se habilita recién después (ver `preferenciaAplicada`
  // en el className) para que la corrección expandido→contraído del primer
  // render sea INSTANTÁNEA, sin animar el estado inicial. La lógica vive en el
  // hook compartido `usePreferenciaSidebarContraida` (misma clave que el
  // switch de Configuración de cuenta, que la sincroniza en vivo).
  const { contraida: collapsed, aplicada: preferenciaAplicada, setContraida } =
    usePreferenciaSidebarContraida();

  /**
   * Feedback inmediato de "navegando" (rendimiento percibido — encargo de
   * Yac): al hacer click en un ítem habilitado se
   * guarda su `href` acá; el `useEffect` de abajo lo limpia en cuanto
   * `usePathname()` refleja la ruta nueva (o cualquier otra navegación —
   * incluida una hecha por fuera del Sidebar, ej. un botón "Volver"). El
   * `Sidebar` NUNCA se desmonta entre navegaciones (vive en el layout raíz
   * de `(app)`, compartido por todas estas rutas), así que este estado
   * sobrevive el viaje completo sin necesitar Context ni una librería nueva.
   *
   * Deliberadamente NO se usa `useLinkStatus` (Next 15.3+): este proyecto
   * está en Next ^15.1.0, donde ese hook no existe todavía — ver
   * `apps/web/package.json`. Tampoco se reemplaza `<Link>` por
   * `useRouter().push`: eso perdería el prefetch automático de `<Link>`.
   */
  const [hrefPendiente, setHrefPendiente] = React.useState<string | null>(null);

  React.useEffect(() => {
    setHrefPendiente(null);
  }, [pathname]);

  const nombreAccesible = tenantNombre ?? "factura-eletronica.app";

  return (
    <aside
      className={cn(
        // `sticky top-0`: con el shell en scroll de documento (ver
        // `app/(app)/layout.tsx`, aprendizaje 2026-07-17) el Sidebar queda
        // fijo en pantalla mientras el documento scrollea. El `nav` de abajo
        // conserva su propio `overflow-y-auto` — es una región ACOTADA (el
        // menú), no el contenido principal del shell, así que no viola la
        // regla de "un solo scroll".
        // Mobile-first: `w-[68px]` es el ancho base (aplica también en
        // desktop colapsado); `sm:w-64` lo overridea SOLO si no está
        // colapsado y el viewport ya es `sm+` — así el primer paint en
        // móvil siempre nace angosto, sin ventana de desborde. La
        // transición de ancho también queda acotada a `sm:` para que nunca
        // anime el estado inicial en móvil (no hay nada que animar ahí: el
        // ancho móvil es fijo).
        "sticky top-0 flex h-dvh w-[68px] shrink-0 flex-col border-r border-border bg-background",
        // Transición habilitada SOLO tras aplicar la preferencia persistida
        // (efecto de montaje): así el primer paint no anima el estado inicial
        // ni la corrección de expandido→contraído; solo los toggles manuales
        // posteriores animan.
        preferenciaAplicada && "sm:transition-[width] sm:duration-200",
        !collapsed && "sm:w-64",
      )}
    >
      {/* Logo + nombre del courier (pedido de Yac 2026-07-17: "necesito ver
          claramente el nombre del courier debajo del logo"). Layout vertical:
          logo arriba, nombre (o el wordmark default si no hay branding)
          debajo — un solo `Link` a /dashboard con un solo focus ring. */}
      <div
        className={cn(
          "flex shrink-0 flex-col items-center gap-1.5 border-b border-border px-2 py-3",
          !collapsed && "sm:items-start sm:px-4",
        )}
      >
        <Link
          href="/dashboard"
          title={nombreAccesible}
          className="flex flex-col items-start gap-1.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {logoUrl ? (
            // Logo remoto del courier (Storage de cualquier tenant): <img>
            // plano, no next/image (evita configurar dominios remotos
            // permitidos solo para este preview) — mismo criterio que
            // `FormularioLogoCourier`.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoUrl}
              alt=""
              aria-hidden="true"
              className="h-10 w-10 shrink-0 rounded-md border border-border object-contain"
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src="/logo-isotipo.svg" alt="" aria-hidden="true" className="h-10 w-10 shrink-0" />
          )}
          {!collapsed &&
            (tenantNombre ? (
              <span className="hidden max-w-full truncate text-sm font-semibold leading-tight text-foreground sm:inline">
                {tenantNombre}
              </span>
            ) : (
              <span className="hidden text-base font-bold leading-none text-foreground sm:inline">
                plataforma<span className="text-[hsl(var(--verde-texto))]">.app</span>
              </span>
            ))}
          <span className="sr-only">{nombreAccesible} — Ir al resumen</span>
        </Link>
      </div>

      {/* Navegación */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <ul className="flex flex-col gap-1">
          {navItems.map((item) => {
            const Icon = iconMap[item.icon];
            const active = pathname === item.href || pathname?.startsWith(`${item.href}/`);
            const habilitado = !item.permiso || puede(rol, item.permiso);

            if (!habilitado) {
              return (
                <li key={item.href}>
                  <span
                    aria-disabled="true"
                    title={navSinPermisoTexto}
                    className={cn(
                      "flex h-11 cursor-not-allowed items-center justify-center gap-3 rounded-md border-l-2 border-transparent px-0 text-sm font-medium text-muted-foreground/50",
                      !collapsed && "sm:justify-start sm:px-3",
                    )}
                  >
                    <Icon className="h-5 w-5 shrink-0 text-muted-foreground/50" strokeWidth={2} />
                    {!collapsed && <span className="hidden truncate sm:inline">{item.label}</span>}
                  </span>
                </li>
              );
            }

            // "Navegando" = este ítem fue el clickeado y la ruta todavía no
            // cambió — nunca se marca el ítem YA activo (clickearlo de nuevo
            // no dispara ninguna navegación real, no hay nada que esperar).
            const navegando = !active && hrefPendiente === item.href;
            const IconoAMostrar = navegando ? Loader2 : Icon;

            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  aria-busy={navegando || undefined}
                  title={item.label}
                  onClick={() => {
                    if (!active) setHrefPendiente(item.href);
                  }}
                  className={cn(
                    "flex h-11 items-center justify-center gap-3 rounded-md border-l-2 border-transparent px-0 text-sm font-medium text-muted-foreground transition-colors",
                    "hover:bg-accent hover:text-foreground",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                    active &&
                      "border-l-primary bg-primary/[0.06] font-semibold text-foreground hover:bg-primary/[0.08]",
                    !collapsed && "sm:justify-start sm:px-3",
                  )}
                >
                  <IconoAMostrar
                    className={cn(
                      "h-5 w-5 shrink-0",
                      active ? "text-[hsl(var(--verde-texto))]" : "text-muted-foreground",
                      navegando && "animate-spin",
                    )}
                    strokeWidth={2}
                    aria-hidden="true"
                  />
                  {!collapsed && <span className="hidden truncate sm:inline">{item.label}</span>}
                  {navegando && <span className="sr-only">{navNavegandoTexto}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Colapsar / expandir — oculto en móvil vía CSS (`hidden sm:block`):
          por debajo del breakpoint el modo icono es el ÚNICO posible (el
          ancho ya lo fuerza el CSS del `aside`), así que el toggle no
          tendría ningún efecto útil y confundiría más de lo que ayuda. */}
      <div className="hidden shrink-0 border-t border-border p-3 sm:block">
        <button
          type="button"
          onClick={() => setContraida(!collapsed)}
          aria-pressed={collapsed}
          className={cn(
            "flex h-11 w-full items-center gap-3 rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors",
            "hover:bg-accent hover:text-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            collapsed && "justify-center px-0",
          )}
        >
          {collapsed ? (
            <ChevronsRight className="h-5 w-5 shrink-0" strokeWidth={2} />
          ) : (
            <ChevronsLeft className="h-5 w-5 shrink-0" strokeWidth={2} />
          )}
          {!collapsed && <span>Contraer menú</span>}
          <span className="sr-only">{collapsed ? "Expandir menú" : "Contraer menú"}</span>
        </button>
      </div>
    </aside>
  );
}
