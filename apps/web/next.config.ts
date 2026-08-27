import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  // Paquete interno JIT: se consume como TypeScript crudo (sin build propio),
  // así que Next debe transpilarlo como parte del build de esta app.
  transpilePackages: ["@factura/core"],
  // El default de `bodySizeLimit` de Server Actions es 1 MB — demasiado bajo
  // para flujos que envían archivos subidos (importaciones/cargas masivas) a
  // una server action vía FormData. Sin este override, un archivo de varios MB
  // es rechazado por Next ANTES de correr la action, a nivel de framework, y el
  // cliente cae en su `catch` genérico en vez de mostrar un mensaje de tamaño
  // específico. Se pone en 52 MB como techo del framework; cada caller sigue
  // aplicando su PROPIO tope de negocio sobre `File.size`, así que esto solo
  // sube el límite del framework, no relaja ninguna validación de la app.
  experimental: {
    serverActions: {
      bodySizeLimit: "52mb",
    },
  },
};

export default nextConfig;
