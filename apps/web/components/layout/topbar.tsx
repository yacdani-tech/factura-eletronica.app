import Link from "next/link";
import { Settings, User, LogOut, ShieldAlert } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TituloPagina } from "@/components/layout/titulo-pagina";
import { userMenuItems } from "@/lib/nav";
import { textosAuth } from "@/lib/textos/auth";
import { textosSoporte } from "@/lib/textos/soporte";
import { cerrarSesion } from "@/lib/auth/acciones";
import { salirDeSoporte } from "@/lib/soporte/acciones";
import type { ModoSoporte } from "@factura/db/auth/usuario-actual";

interface UsuarioTopbar {
  nombre: string | null;
  email: string;
}

interface TopbarProps {
  /** Usuario autenticado (obtenido server-side vía `obtenerUsuarioActual`). */
  usuario: UsuarioTopbar;
  /**
   * No-null solo si el usuario es un Super-Admin en modo soporte (SA-2, ver
   * `ContextoUsuario.modoSoporte`). Cuando no es null, se muestra un banner
   * SIEMPRE visible (nunca colapsable/oculto — un Super-Admin nunca debe
   * perder de vista que está operando dentro de un tenant ajeno) + un botón
   * mínimo "Salir de soporte". El botón de ENTRAR/elegir tenant (la consola
   * de super-admin) es tarea 2.1, fuera de esta pantalla.
   */
  modoSoporte?: ModoSoporte | null;
}

function iniciales({ nombre, email }: UsuarioTopbar): string {
  const partes = nombre?.trim().split(/\s+/).filter(Boolean) ?? [];
  const deNombre = partes
    .slice(0, 2)
    .map((parte) => parte[0]?.toUpperCase() ?? "")
    .join("");
  return deNombre || email.slice(0, 2).toUpperCase();
}

/**
 * Barra superior del app shell: título de la página + menú de usuario.
 * Server Component — la interactividad vive dentro de los primitivos de
 * shadcn/ui (`DropdownMenu`), no acá. "Cerrar sesión" es un form con Server
 * Action real (no un placeholder estático).
 */
export function Topbar({ usuario, modoSoporte = null }: TopbarProps) {
  return (
    // `sticky top-0`: con el shell ahora en scroll de DOCUMENTO (ver
    // `app/(app)/layout.tsx`, aprendizaje 2026-07-17), la Topbar debe
    // permanecer visible al scrollear el contenido — incluye el banner de
    // modo soporte (SA-2: un Super-Admin nunca debe perder de vista que está
    // operando dentro de un tenant ajeno). `z-20` la mantiene por encima del
    // contenido de `main` pero debajo de overlays de shadcn (Dialog/Select/
    // DropdownMenu usan `z-50`).
    <div className="sticky top-0 z-20 flex shrink-0 flex-col bg-background">
      {modoSoporte && (
        <div
          role="status"
          className="flex h-11 shrink-0 items-center justify-between gap-3 bg-alerta px-4 text-sm font-semibold text-[#451A03] sm:px-6"
        >
          <span className="flex min-w-0 items-center gap-2">
            <ShieldAlert className="h-4 w-4 shrink-0" strokeWidth={2.5} aria-hidden="true" />
            <span className="truncate">{textosSoporte.banner(modoSoporte.tenantNombre)}</span>
          </span>
          <form action={salirDeSoporte}>
            <Button
              type="submit"
              size="sm"
              variant="outline"
              className="h-7 shrink-0 border-[#451A03]/30 bg-white/60 px-3 text-xs font-semibold text-[#451A03] hover:bg-white"
            >
              {textosSoporte.botonSalir}
            </Button>
          </form>
        </div>
      )}

      <header className="flex min-h-16 shrink-0 items-center justify-between gap-4 border-b border-border bg-background px-4 py-2.5 sm:px-6">
        <TituloPagina />

        {/* Form externo referenciado por `form=` desde el botón del menú (regla:
            cerrar sesión debe ser una acción real, no un botón decorativo). */}
        <form id="form-cerrar-sesion" action={cerrarSesion} className="hidden" aria-hidden="true" />

        <DropdownMenu>
          <DropdownMenuTrigger className="flex h-11 items-center gap-2 rounded-md px-2 text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
            <Avatar className="h-8 w-8">
              <AvatarFallback>{iniciales(usuario)}</AvatarFallback>
            </Avatar>
            <span className="hidden text-left sm:block">
              <span className="block max-w-[10rem] truncate text-sm font-medium leading-tight text-foreground">
                {usuario.nombre || usuario.email}
              </span>
              <span className="block max-w-[10rem] truncate text-xs leading-tight text-muted-foreground">
                {usuario.email}
              </span>
            </span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Mi cuenta</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/cuenta/perfil" className="flex w-full items-center gap-2">
                <User />
                {userMenuItems.perfil}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/cuenta/configuracion" className="flex w-full items-center gap-2">
                <Settings />
                {userMenuItems.configuracion}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <button type="submit" form="form-cerrar-sesion" className="flex w-full items-center gap-2 text-left">
                <LogOut />
                {textosAuth.cerrarSesion}
              </button>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>
    </div>
  );
}
