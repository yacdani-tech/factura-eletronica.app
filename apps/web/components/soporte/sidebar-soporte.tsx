"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard } from "lucide-react";

import { cn } from "@/lib/utils";
import { textosSoporte } from "@/lib/textos/soporte";

/**
 * `"use client"`: NO puede importar VALORES desde módulos server-only (nada
 * que arrastre `next/headers`/Supabase) — solo `lucide-react`, `lib/utils`
 * (puro) y `lib/textos/soporte.ts` (módulo puro).
 */

const t = textosSoporte.sidebar;

const NAV: ReadonlyArray<{ label: string; href: string }> = [{ label: t.nav.resumen, href: "/soporte" }];

function esActivo(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  if (href === "/soporte") return pathname === "/soporte";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Sidebar del shell de "modo plataforma" (super-admin sin tenant
 * seleccionado). Ancho fijo 248px en `sm:` hacia arriba; por debajo, modo
 * icono (68px), mismo patrón CSS-first que `components/layout/sidebar.tsx`.
 */
export function SidebarSoporte() {
  const pathname = usePathname();

  return (
    <aside className="sticky top-0 flex h-dvh w-[68px] shrink-0 flex-col border-r border-border bg-background sm:w-[248px]">
      <div className="flex shrink-0 flex-col items-center gap-1.5 border-b border-border px-2 py-3 sm:items-start sm:px-4">
        <Link
          href="/soporte"
          className="flex flex-col items-start gap-1 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-isotipo.svg" alt="" aria-hidden="true" className="h-8 w-8 shrink-0" />
          <span className="hidden text-base font-bold leading-none text-foreground sm:inline">
            plataforma<span className="text-[hsl(var(--verde-texto))]">.app</span>
          </span>
          <span className="hidden text-[0.6875rem] font-semibold uppercase tracking-wider text-muted-foreground sm:inline">
            {t.sobreEtiqueta}
          </span>
          <span className="sr-only">{textosSoporte.consola.tituloShell}</span>
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <ul className="flex flex-col gap-1">
          {NAV.map((item) => {
            const activo = esActivo(pathname, item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={activo ? "page" : undefined}
                  title={item.label}
                  className={cn(
                    "flex h-11 items-center justify-center gap-3 rounded-md border-l-2 border-transparent px-0 text-sm font-medium text-muted-foreground transition-colors",
                    "hover:bg-accent hover:text-foreground",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                    activo &&
                      "border-l-primary bg-primary/[0.06] font-semibold text-foreground hover:bg-primary/[0.08]",
                    "sm:justify-start sm:px-3",
                  )}
                >
                  <LayoutDashboard
                    className={cn(
                      "h-5 w-5 shrink-0",
                      activo ? "text-[hsl(var(--verde-texto))]" : "text-muted-foreground",
                    )}
                    strokeWidth={2}
                    aria-hidden="true"
                  />
                  <span className="hidden truncate sm:inline">{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
