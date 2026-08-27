import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { isMaintenanceMode } from "@/lib/maintenance";
import { SITE_URL } from "@/lib/site";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  weight: ["400", "500", "600", "700"],
});

const TITLE = "Factura Electrónica";
const DESCRIPTION = "Descripción del producto (placeholder).";

const OG_IMAGE = {
  url: `${SITE_URL}/og-image.png`,
  width: 1200,
  height: 630,
  type: "image/png",
};

export function generateMetadata(): Metadata {
  return {
    metadataBase: new URL(SITE_URL),
    title: TITLE,
    description: DESCRIPTION,
    alternates: { canonical: SITE_URL },
    openGraph: {
      type: "website",
      locale: "es",
      siteName: "Factura Electrónica",
      url: SITE_URL,
      title: TITLE,
      description: DESCRIPTION,
      images: [OG_IMAGE],
    },
    twitter: {
      card: "summary_large_image",
      title: TITLE,
      description: DESCRIPTION,
      images: [OG_IMAGE.url],
    },
    robots: isMaintenanceMode() ? { index: false, follow: false } : undefined,
  };
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body className={`${inter.variable} font-sans antialiased`}>
        {children}
      </body>
    </html>
  );
}
