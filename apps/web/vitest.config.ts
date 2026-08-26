import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // `tsconfig.json` usa `"jsx": "preserve"` (Next.js hace su propia
  // transformación de JSX para el build real) — Vitest corre sobre Vite/
  // esbuild directamente, así que necesita su PROPIA config de JSX acá, o
  // los archivos `.test.tsx` fallan con "React is not defined" (el runtime
  // automático no se activa solo).
  esbuild: {
    jsx: "automatic",
  },
  test: {
    include: ["lib/**/*.test.ts", "components/**/*.test.tsx", "app/**/*.test.tsx"],
    // Los tests de lógica (`lib/**/*.test.ts`) no necesitan DOM; los de
    // componentes/páginas (`components|app/**/*.test.tsx`, Testing Library)
    // sí. Solo estos últimos pagan el costo de jsdom.
    environmentMatchGlobs: [
      ["components/**/*.test.tsx", "jsdom"],
      ["app/**/*.test.tsx", "jsdom"],
    ],
    setupFiles: ["./vitest.setup.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
