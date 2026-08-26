import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

import { TooltipProvider } from "@/components/ui/tooltip";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  weight: ["400", "500", "600", "700", "800"],
});

// apps/web es el área privada de login/dashboard (web.factura-eletronica.app y todo
// subdominio de tenant) — NUNCA debe indexarse, con o sin mantenimiento. La
// única propiedad pública de factura-eletronica.app es apps/landing (dominio raíz).
export const metadata: Metadata = {
  title: "factura-eletronica.app",
  description: "Facturación en segundos. La plataforma de facturación para couriers.",
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body className={`${inter.variable} font-sans antialiased`}>
        {/*
          TooltipProvider ÚNICO de toda la app (ítem 4 del lote de Yac
          2026-07-18) — `delayDuration` corto (200ms) para que la nota
          truncada de una lista responda rápido al hover, sin sentirse
          "pegajoso". Client Component envolviendo children Server Component:
          patrón estándar de Next App Router (mismo criterio que un
          ThemeProvider de shadcn en el layout raíz).
        */}
        <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
      </body>
    </html>
  );
}
