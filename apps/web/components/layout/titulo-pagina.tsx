"use client";

import { usePathname } from "next/navigation";

import { resolverTituloPagina } from "@/lib/nav-titulo-pagina";

/**
 * Título + descripción de la pantalla actual, mostrados en la Topbar.
 *
 * Client Component A PROPÓSITO (usa `usePathname`, mismo patrón que el
 * `Sidebar`): el layout `(app)` es un Server Component que NO se vuelve a
 * ejecutar en las navegaciones del lado del cliente (App Router comparte el
 * layout entre rutas hermanas), así que leer el `pathname` vía `headers()` en
 * el layout daba el título de la PRIMERA carga y se quedaba pegado al navegar.
 * `usePathname` sí se actualiza en cada navegación, dentro del mismo shell.
 */
export function TituloPagina() {
  const pathname = usePathname();
  const { titulo, subtitulo } = resolverTituloPagina(pathname);

  return (
    <div className="min-w-0">
      <h1 className="truncate text-lg font-semibold leading-tight text-foreground">{titulo}</h1>
      {subtitulo && <p className="truncate text-sm leading-tight text-muted-foreground">{subtitulo}</p>}
    </div>
  );
}
