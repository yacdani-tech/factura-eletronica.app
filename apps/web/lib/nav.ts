import type { Permiso } from "@/lib/permisos";

/**
 * Ítems de navegación del app shell (esqueleto). Centralizados acá (listos
 * para i18n) para no duplicarlos en el sidebar/topbar.
 *
 * `icon` es el nombre de un componente de `lucide-react`; el layout resuelve
 * el ícono real desde un mapa (ver `components/layout/sidebar.tsx`).
 *
 * `permiso` (opcional, interfaz única: el rol habilita/deshabilita): si se
 * define, el `Sidebar` deshabilita el ítem (visible mas no clickeable, con
 * tooltip) para quien no tenga ese permiso. Ítems SIN `permiso` quedan
 * habilitados para cualquier rol.
 */
export type NavIconName = "LayoutDashboard" | "Users" | "Settings";

export interface NavItem {
  href: string;
  label: string;
  icon: NavIconName;
  permiso?: Permiso;
}

export const navItems: NavItem[] = [
  { href: "/dashboard", label: "Inicio", icon: "LayoutDashboard" },
  { href: "/usuarios", label: "Usuarios", icon: "Users", permiso: "usuarios:gestionar" },
  { href: "/configuracion", label: "Configuración", icon: "Settings", permiso: "configuracion:editar" },
];

export const navNavegandoTexto = "Navegando…";
export const navSinPermisoTexto = "Tu rol no tiene acceso a esta sección.";

export const userMenuItems = {
  perfil: "Mi perfil",
  configuracion: "Preferencias",
} as const;
