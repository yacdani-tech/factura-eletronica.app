import { LogOut } from "lucide-react";

import { Avatar, AvatarFallback } from "@factura/ui/avatar";
import { Button } from "@factura/ui/button";
import { SidebarSoporte } from "@/components/soporte/sidebar-soporte";
import { cerrarSesion } from "@/lib/auth/acciones";
import { textosSoporte } from "@/lib/textos/soporte";

interface ShellSoporteProps {
  usuario: { nombre: string | null; email: string };
  children: React.ReactNode;
}

function iniciales({ nombre, email }: { nombre: string | null; email: string }): string {
  const partes = nombre?.trim().split(/\s+/).filter(Boolean) ?? [];
  const deNombre = partes
    .slice(0, 2)
    .map((parte) => parte[0]?.toUpperCase() ?? "")
    .join("");
  return deNombre || email.slice(0, 2).toUpperCase();
}

/**
 * Shell para un Super-Admin SIN tenant seleccionado ("modo plataforma",
 * rediseño estructural fase 1, 2026-08-13): sidebar fija (`SidebarSoporte`,
 * ancho 248px en `sm:` / modo icono debajo) + una columna derecha con topbar
 * (chip de usuario + "Cerrar sesión") y el contenido. Reemplaza el header
 * suelto anterior (sin sidebar) — mismo espíritu de "Cerrar sesión siempre
 * accesible" que el placeholder que reemplazó originalmente
 * (`<ModoPlataforma/>`), pero ahora con navegación real.
 *
 * Server Component — la única interactividad (resaltar el ítem de nav
 * activo) vive en `SidebarSoporte` (`"use client"`), montado adentro.
 *
 * Scroll de DOCUMENTO (aprendizaje 2026-07-17, `.claude/agents/ui-app.md`):
 * "una página = UN solo scroll vertical, el del documento" — el wrapper NO
 * lleva `overflow-hidden`/`h-dvh`; lo que antes dependía de que un
 * contenedor interno scrolleara (mantener el sidebar y la topbar fijos)
 * se resuelve con `sticky` en cada uno (mismo criterio que
 * `app/(app)/layout.tsx`).
 */
export function ShellSoporte({ usuario, children }: ShellSoporteProps) {
  return (
    <div className="flex min-h-dvh bg-background">
      <SidebarSoporte />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* `sticky top-0 z-20`: mismo criterio que la Topbar del tenant — por
            encima del contenido de `main`, debajo de overlays de shadcn
            (Dialog/Select/DropdownMenu usan z-50). "Cerrar sesión" debe
            seguir siempre accesible sin depender de scrollear de vuelta
            arriba. */}
        <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center justify-end gap-3 border-b border-border bg-background px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <Avatar className="h-8 w-8">
              <AvatarFallback>{iniciales(usuario)}</AvatarFallback>
            </Avatar>
            <span className="hidden text-left sm:block">
              <span className="block max-w-[12rem] truncate text-sm font-medium leading-tight text-foreground">
                {usuario.nombre || usuario.email}
              </span>
              <span className="block max-w-[12rem] truncate text-xs leading-tight text-muted-foreground">
                {usuario.email}
              </span>
            </span>
          </div>
          <form action={cerrarSesion}>
            <Button type="submit" variant="outline" size="sm" className="gap-1.5">
              <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
              {textosSoporte.modoPlataforma.botonCerrarSesion}
            </Button>
          </form>
        </header>
        <main className="flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
