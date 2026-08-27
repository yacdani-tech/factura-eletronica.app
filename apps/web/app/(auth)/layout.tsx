import { PantallaCentrada } from "@/components/layout/pantalla-centrada";

/**
 * Layout de las pantallas de autenticación (login, registro): Card centrada,
 * FUERA del app shell (sin Sidebar/Topbar) — MASTER.md: base blanca, verde
 * solo como acento, Inter, foco visible.
 *
 * Modelo de tenant POR SESIÓN (este producto NO usa subdominio por tenant):
 * el dashboard se sirve en un host FIJO (`web.`) y el tenant se resuelve del
 * login/membresía, no del subdominio. Por eso NO hay gate de "subdominio
 * inexistente -> 404" (a diferencia del framework casilleros, que sí lo tenía).
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <PantallaCentrada>{children}</PantallaCentrada>;
}
