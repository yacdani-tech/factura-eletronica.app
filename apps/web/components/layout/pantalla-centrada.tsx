/**
 * Wrapper visual compartido para pantallas FUERA del app shell (sin Sidebar/
 * Topbar): login, registro, aceptación de invitación. MASTER.md: base
 * blanca, verde solo como acento, Inter, foco visible.
 *
 * Extraído de `app/(auth)/layout.tsx` (Fase 2) para reusarlo también en
 * `app/invitacion/[token]/page.tsx` (Fase 4), que NO puede vivir dentro del
 * grupo `(auth)` ni `(app)` — el invitado todavía no tiene membresía.
 */
export function PantallaCentrada({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center justify-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-isotipo.svg" alt="" aria-hidden="true" className="h-8 w-8" />
          <span className="text-lg font-bold leading-none text-foreground">
            factura-electronica<span className="text-[hsl(var(--verde-texto))]">.app</span>
          </span>
        </div>
        {children}
      </div>
    </div>
  );
}
