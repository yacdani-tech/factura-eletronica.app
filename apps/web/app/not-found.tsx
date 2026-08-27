import type { Metadata } from "next";

import { textosComun } from "@/lib/textos/comun";

export const metadata: Metadata = {
  title: "Página no encontrada — factura-electronica.app",
  // Sin valor de SEO propio — mismo criterio que el resto de `apps/web`
  // (ver `app/layout.tsx`): es área privada, nunca se indexa.
  robots: { index: false, follow: false },
};

/**
 * 404 genérico de TODA `apps/web` (feature "subdominio inexistente → 404",
 * 2026-08-18). Next.js la sirve automáticamente para cualquier URL no
 * matcheada, y además la disparan explícitamente los gates de
 * `app/(auth)/layout.tsx` y `app/(app)/layout.tsx` vía `notFound()` cuando
 * el subdominio del request no corresponde a ningún tenant
 * (`lib/tenant/gate-subdominio.ts`).
 *
 * A propósito vive en la RAÍZ de `app/` (fuera de los grupos `(app)`/`(auth)`)
 * — renderiza bajo el `RootLayout` (que ya da `<html>`/`<body>`/Inter/
 * `TooltipProvider`), SIN Sidebar/Topbar ni nada del app-shell: no sabemos
 * si el visitante tiene sesión ni a qué tenant "cree" estar entrando, así
 * que no hay nada de contexto de cuenta que mostrar.
 *
 * El mensaje es DELIBERADAMENTE genérico (regla dura #8): nunca debe
 * revelar si el subdominio no existe o si existe pero el tenant está
 * bloqueado (ese otro caso ni siquiera llega acá — sigue el flujo normal de
 * login/expulsión, ver el gate). Mismo patrón visual centrado que la
 * pantalla "página no disponible" de `registro-cliente/page.tsx`.
 */
export default function NotFound() {
  const t = textosComun.paginaNoExiste;

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logo-isotipo.svg"
          alt=""
          aria-hidden="true"
          className="mx-auto h-16 w-16"
        />
        <h1 className="mt-4 text-lg font-semibold text-foreground">{t.titulo}</h1>
        <p role="alert" className="mt-2 text-sm text-muted-foreground">
          {t.descripcion}
        </p>
      </div>
    </div>
  );
}
