import { notFound } from "next/navigation";

import { PantallaCentrada } from "@/components/layout/pantalla-centrada";
import { subdominioActualNoExiste } from "@/lib/tenant/gate-subdominio";

/**
 * Layout de las pantallas de autenticación (login, registro): Card centrada,
 * FUERA del app shell (sin Sidebar/Topbar) — MASTER.md: base blanca, verde
 * solo como acento, Inter, foco visible.
 *
 * Gate "subdominio inexistente -> 404" (no login): el middleware redirige
 * TODO request sin sesión a `/login` en el MISMO host (subdominio
 * preservado) — así que un subdominio basura (`noexiste.factura-eletronica.app`)
 * terminaba mostrando el login de la plataforma como si fuera una cuenta
 * real. Ver `lib/tenant/gate-subdominio.ts` para el detalle de qué casos SÍ
 * y NO disparan el 404.
 */
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  if (await subdominioActualNoExiste()) notFound();

  return <PantallaCentrada>{children}</PantallaCentrada>;
}
