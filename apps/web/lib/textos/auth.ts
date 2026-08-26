/**
 * Textos de las pantallas de autenticación (login, `/registro` cerrado,
 * pantalla "sin equipo") y de los mensajes de error de negocio. Los textos
 * de `/invitacion/[token]` (el único punto de creación de cuenta desde
 * REG-2) viven en `lib/textos/staff.ts` → `invitacion`, junto al resto del
 * dominio de invitaciones de staff.
 *
 * Centralizados acá (mismo patrón que `lib/nav.ts`) para que queden listos
 * para internacionalización futura y no se dupliquen entre el formulario
 * (client component) y la Server Action que lo procesa.
 */
export const textosAuth = {
  login: {
    titulo: "Ingresá a tu cuenta",
    subtitulo: "Facturación en segundos para tu courier.",
    emailLabel: "Correo",
    emailPlaceholder: "vos@tuempresa.com",
    passwordLabel: "Contraseña",
    passwordPlaceholder: "••••••••",
    botonSubmit: "Iniciar sesión",
    botonSubmitCargando: "Ingresando…",
    botonGoogle: "Continuar con Google",
    separador: "o con tu correo",
  },
  /**
   * Avisos que la página de /login muestra según el `?motivo=...` con que se
   * llegó (ej. tras una expulsión). Se renderizan en la misma superficie que
   * un error del formulario. Catálogo FIJO: `/login` elige el texto por clave,
   * nunca renderiza el valor crudo de la query string (ver `login/page.tsx`).
   */
  avisos: {
    // Expulsión por bloqueo del courier (regla dura #15): el súper-admin
    // bloqueó el tenant; la sesión del miembro ya se cerró en `/salir`.
    courierBloqueado: "Este courier fue bloqueado. Contactá a soporte para más información.",
  },
  /**
   * REG-2 (decisión de Yac 2026-07-14): cerró el /registro público de staff.
   * Ya no existe un formulario de auto-registro con correo arbitrario — la
   * ÚNICA forma de crear una cuenta de staff es aceptando una invitación
   * (`/invitacion/[token]`, ver `lib/textos/staff.ts` → `invitacion`).
   */
  registroCerrado: {
    titulo: "El acceso es solo por invitación",
    descripcion:
      "Todavía no existe un registro público de staff: pedile a tu Admin que te invite desde Configuración → Equipo. Si ya tenés una invitación, abrí el enlace que te llegó por correo.",
    botonLogin: "Ya tengo cuenta — iniciar sesión",
  },
  errores: {
    datosInvalidos: "Revisá los datos del formulario e intentá de nuevo.",
    credencialesInvalidas: "Correo o contraseña incorrectos.",
    correoEnUso: "Ese correo ya está en uso. Iniciá sesión o usá otro correo.",
    // REG-2: mensaje específico para signup DESDE una invitación (a
    // diferencia de `correoEnUso`, que era del signup abierto ya cerrado) —
    // guía al invitado directo a /login en vez de a "usá otro correo" (el
    // correo de una invitación no es editable).
    correoEnUsoInvitacion: "Ese correo ya tiene una cuenta. Iniciá sesión para aceptar la invitación.",
    // Supabase Auth rechaza en el signup los dominios de prueba (test.com,
    // example.com, TLD .test, etc.) — restricción de SU servicio de email
    // integrado, no de esta app. El mensaje lo dice tal cual para que quien
    // prueba con correos ficticios no persiga un bug inexistente acá.
    correoInvalido:
      "El proveedor de autenticación rechazó ese correo: los dominios de prueba (como test.com o example.com) no están permitidos. Usá un correo con dominio real.",
    limiteCorreosAlcanzado:
      "Se alcanzó el límite de correos que la plataforma puede enviar por hora. Esperá un rato e intentá de nuevo.",
    contrasenaDebil: "La contraseña no cumple los requisitos mínimos. Probá con otra.",
    contrasenasNoCoinciden: "Las contraseñas no coinciden.",
    correoNoConfirmado: "Confirmá tu correo antes de iniciar sesión. Revisá tu bandeja de entrada.",
    googleNoDisponible:
      "El ingreso con Google no está disponible todavía. Usá correo y contraseña.",
    generico: "Ocurrió un error. Intentá de nuevo en unos minutos.",
    sesionExpirada: "Tu sesión expiró. Iniciá sesión de nuevo.",
    linkInvalido: "El enlace no es válido o ya venció. Iniciá sesión de nuevo.",
  },
  sinEquipo: {
    titulo: "Todavía no pertenecés a un equipo",
    descripcion:
      "Tu cuenta existe, pero no está asociada a ningún courier todavía. Pedile a tu Admin que te invite desde Configuración → Equipo, o escribí a Plataforma.app si estás dando de alta un courier nuevo.",
    botonCerrarSesion: "Cerrar sesión",
  },
  cerrarSesion: "Cerrar sesión",
} as const;
