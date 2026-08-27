import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Paquetes internos JIT: se consumen como TypeScript crudo (sin build propio),
  // así que Next debe transpilarlos como parte del build de esta app. Esta app
  // (la superficie API) es la ÚNICA autorizada a usar `service_role` (vía
  // `@factura/db/supabase/admin`) y, a futuro, las llaves de firma de Hacienda
  // (`@factura/hacienda-adapter`).
  transpilePackages: ["@factura/core", "@factura/db", "@factura/hacienda-adapter"],
  // NOTA DE DEPLOY: en Vercel este proyecto DEBE configurarse con
  // Framework Preset = Next.js. Un preset "None"/"Other" rompe el ruteo y el
  // middleware (incidente previo). El preset no se controla desde este archivo.
};

export default nextConfig;
