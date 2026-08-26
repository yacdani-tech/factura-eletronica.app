import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    container: {
      center: true,
      padding: "1rem",
      screens: { "2xl": "1400px" },
    },
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "Arial", "Helvetica", "sans-serif"],
      },
      colors: {
        // Paleta de marca placeholder — reemplazá al instanciar una app nueva.
        verde: "hsl(var(--verde))",
        "verde-oscuro": "hsl(var(--verde-oscuro))",
        "verde-texto": "hsl(var(--verde-texto))",
        negro: "hsl(var(--negro))",
        "gris-oscuro": "hsl(var(--gris-oscuro))",
        "gris-medio": "hsl(var(--gris-medio))",
        "gris-claro": "hsl(var(--gris-claro))",
        fondo: "hsl(var(--fondo))",
        "verde-tinte": "hsl(var(--verde-tinte))",
        "verde-tinte-2": "hsl(var(--verde-tinte-2))",
      },
    },
  },
  plugins: [],
};

export default config;
