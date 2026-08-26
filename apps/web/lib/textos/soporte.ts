/**
 * Textos de la consola de PLATAFORMA (super-admin) y del modo soporte.
 * Centralizados (listos para i18n) — módulo PURO, sin imports de Next/Supabase,
 * así lo pueden importar los componentes cliente (ej. `SidebarSoporte`).
 */
export const textosSoporte = {
  /** Banner SIEMPRE visible en la Topbar cuando el super-admin opera dentro de un tenant. */
  banner: (tenantNombre: string) => `Estás operando dentro de ${tenantNombre} en modo soporte.`,
  botonSalir: "Salir de soporte",
  modoPlataforma: {
    botonCerrarSesion: "Cerrar sesión",
  },
  consola: {
    tituloShell: "Consola de plataforma",
    titulo: "Cuentas",
    subtitulo: "Administrá las cuentas (tenants) de la plataforma.",
    vacio: "Todavía no hay cuentas.",
    error: "No pudimos cargar las cuentas. Probá de nuevo en unos minutos.",
    columnas: {
      nombre: "Nombre",
      subdominio: "Subdominio",
      plan: "Plan",
      estado: "Estado",
      acciones: "Acciones",
    },
    estado: {
      activo: "Activo",
      bloqueado: "Bloqueado",
    },
    acciones: {
      entrar: "Entrar en modo soporte",
      bloquear: "Bloquear",
      desbloquear: "Desbloquear",
    },
    sinPlan: "Sin plan",
  },
  sidebar: {
    sobreEtiqueta: "PLATAFORMA",
    nav: {
      resumen: "Cuentas",
    },
  },
  errores: {
    errorVerificandoTenant: "No pudimos verificar la cuenta. Probá de nuevo.",
    errorAlSeleccionar: "No pudimos entrar en modo soporte. Probá de nuevo.",
    tenantNoEncontrado: "No se encontró esa cuenta.",
    errorAlBloquear: "No pudimos actualizar el estado de la cuenta. Probá de nuevo.",
  },
} as const;
