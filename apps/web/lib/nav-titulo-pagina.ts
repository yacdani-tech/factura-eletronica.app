/** Título + descripción de una pantalla del app shell (para la Topbar). */
export interface TituloPagina {
  titulo: string;
  subtitulo?: string;
}

/**
 * Encabezado (título + descripción) de cada pantalla del app shell, mostrado
 * en la Topbar. El ORDEN importa: se elige el PRIMER prefijo que matchea, así
 * que las sub-rutas más específicas deben ir ANTES que su padre.
 */
const TITULOS_POR_RUTA: ReadonlyArray<{ prefijo: string; pagina: TituloPagina }> = [
  { prefijo: "/dashboard", pagina: { titulo: "Inicio" } },
  { prefijo: "/usuarios", pagina: { titulo: "Usuarios", subtitulo: "Gestioná el equipo de tu cuenta." } },
  {
    prefijo: "/configuracion",
    pagina: { titulo: "Configuración", subtitulo: "Ajustes de tu cuenta." },
  },
  { prefijo: "/soporte", pagina: { titulo: "Plataforma", subtitulo: "Administración de cuentas." } },
];

const TITULO_DEFECTO: TituloPagina = { titulo: "" };

export function resolverTituloPagina(pathname: string | null | undefined): TituloPagina {
  if (!pathname) return TITULO_DEFECTO;
  const encontrado = TITULOS_POR_RUTA.find(
    ({ prefijo }) => pathname === prefijo || pathname.startsWith(`${prefijo}/`),
  );
  return encontrado?.pagina ?? TITULO_DEFECTO;
}
