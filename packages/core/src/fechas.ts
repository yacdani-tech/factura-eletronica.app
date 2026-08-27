/**
 * Formateo de fechas para listas (ítems 3+4 del lote de Yac 2026-07-18 —
 * columnas "Fecha de creación"/"Fecha último pedido" de subclientes). Módulo
 * puro, sin dependencias de Next/Supabase (mismo criterio que
 * `lib/paginacion.ts`/`lib/listas.ts`) — solo formatea, nunca calcula nada de
 * negocio.
 *
 * Locale fijo `es-CR` (mismo criterio ya usado en `FilaInvitacion`,
 * `components/staff/fila-invitacion.tsx`, para la columna "Vence") + zona
 * horaria fijada EXPLÍCITAMENTE a `America/Costa_Rica`: a diferencia de
 * `FilaInvitacion` (Client Component, se renderiza en el navegador del
 * usuario), esta función también se usa desde Server Components — sin
 * `timeZone` explícito, `toLocaleDateString` usaría la zona horaria del
 * SERVIDOR (ej. UTC en Vercel), no la del usuario en Costa Rica, y un
 * timestamp cercano a medianoche podría mostrar el día equivocado. El
 * proyecto es de alcance Costa Rica en el MVP (regla dura #5, catálogo de
 * monedas single-tenant local CRC), así que fijar la zona acá es seguro.
 */
export function formatearFechaCorta(iso: string): string {
  return new Date(iso).toLocaleDateString("es-CR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "America/Costa_Rica",
  });
}

/**
 * Igual que `formatearFechaCorta` pero incluyendo la HORA en formato 12h con
 * a. m./p. m. (pedido de Yac 2026-07-23 para la fecha de creación de
 * subclientes). Produce "DD/MM/AAAA, hh:mm a. m." / "... p. m." (el separador
 * y el sufijo los pone el locale es-CR).
 *
 * Solo para columnas cuyo dato subyacente es un `timestamptz` REAL con hora
 * (ej. `subclientes.creado_en`, `paquetes.creado_en`) — NUNCA para una columna
 * `date` pura (usar `formatearFechaSoloDia` ahí; una fecha calendario sin hora
 * no tiene una hora que mostrar).
 *
 * `timeZone: "America/Costa_Rica"` FIJO (mismo criterio que `formatearFechaCorta`,
 * ver nota del módulo): garantiza el MISMO string en el Server Component y en
 * el cliente, sin mismatch de hidratación — a diferencia de un
 * `toLocaleString` sin zona, que tomaría la del servidor (UTC en Vercel) al
 * renderizar en el server y la del navegador al hidratar.
 */
export function formatearFechaHora(iso: string): string {
  return new Date(iso).toLocaleString("es-CR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: "America/Costa_Rica",
  });
}

/**
 * Formatea una fecha CALENDARIO pura (columna `date` de Postgres, ej.
 * `consolidados.fecha` — "YYYY-MM-DD", SIN componente de hora) a "DD/MM/AAAA".
 *
 * A propósito NO reusa `formatearFechaCorta`: esa función construye un
 * `Date` a partir del string (interpretado como MEDIANOCHE UTC) y luego lo
 * reformatea en la zona `America/Costa_Rica` (UTC-6) — para un TIMESTAMP real
 * eso es correcto (compensa que el servidor guarda en UTC), pero para una
 * fecha que YA es un día calendario sin hora, ese mismo corrimiento de zona
 * la hace retroceder un día completo (medianoche UTC del 22 -> 18:00 del 21
 * en CR). Acá se reformatea el string DIRECTAMENTE, sin pasar nunca por un
 * `Date`/zona horaria — el día que vino de la base es el día que se muestra.
 */
export function formatearFechaSoloDia(fechaIso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(fechaIso);
  if (!match) return fechaIso;
  const [, anio, mes, dia] = match;
  return `${dia}/${mes}/${anio}`;
}

/**
 * Formatea una fecha CALENDARIO pura (columna `date`, ej. `documentos.fecha_envio`
 * — "YYYY-MM-DD", SIN hora) al formato LARGO en español CR con día de la semana:
 * "Lunes 10 de Agosto 2026" (día de la semana y mes CAPITALIZADOS, sin coma
 * tras el día de la semana y sin "de" antes del año). Encargo de Yac 2026-08-06:
 * variable `{fecha_envio_larga}` para las plantillas de notificación.
 *
 * Para el día de la semana hace falta aritmética de calendario, así que —a
 * diferencia de `formatearFechaSoloDia`— sí construye un `Date`, pero SIEMPRE
 * en UTC (`Date.UTC` + `timeZone: "UTC"` en el formateo): así NO hay corrimiento
 * de zona (el día que vino de la base es el día — y por ende el día de la semana
 * — que se muestra), evitando el bug que `formatearFechaSoloDia` documenta para
 * las fechas ya-calendario. El locale `es-CR` da los nombres en minúscula
 * ("lunes", "agosto"); se capitaliza la inicial a mano y se arma el orden EXACTO
 * pedido (no el default del locale, que sería "lunes, 10 de agosto de 2026").
 * Degrada al string crudo si la fecha no es parseable o es inválida.
 */
export function formatearFechaLarga(fechaIso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(fechaIso);
  if (!match) return fechaIso;
  const [, anio, mes, dia] = match;
  const fecha = new Date(Date.UTC(Number(anio), Number(mes) - 1, Number(dia)));
  if (Number.isNaN(fecha.getTime())) return fechaIso;

  const partes = new Intl.DateTimeFormat("es-CR", {
    weekday: "long",
    month: "long",
    timeZone: "UTC",
  }).formatToParts(fecha);
  const obtener = (tipo: "weekday" | "month") => partes.find((p) => p.type === tipo)?.value ?? "";
  const capitalizar = (texto: string) => (texto ? texto.charAt(0).toUpperCase() + texto.slice(1) : texto);

  const diaSemana = capitalizar(obtener("weekday"));
  const nombreMes = capitalizar(obtener("month"));
  // `Number(dia)` para el número sin cero a la izquierda ("10", "5"), como el ejemplo.
  return `${diaSemana} ${Number(dia)} de ${nombreMes} ${anio}`;
}

/**
 * Formatea un `timestamptz` REAL (ISO con hora, ej. `documentos.fecha`) al
 * formato LARGO CON HORA en español CR: "Miércoles 26 de agosto del 2026 a
 * las 9:59 pm" (encargo de Yac 2026-08-11: formato de fecha "largo" opcional
 * de la factura, `plantillaFactura.formatoFecha`).
 *
 * A propósito NO reusa `formatearFechaLarga`: esa es para fechas CALENDARIO
 * puras (`YYYY-MM-DD` sin hora, ancladas a UTC) — pasarle un timestamptz
 * ignoraría la hora y tomaría el día calendario EN UTC, que cerca de
 * medianoche es el día equivocado para Costa Rica. Acá la zona es
 * `America/Costa_Rica` FIJA (mismo criterio que `formatearFechaHora`, ver
 * nota del módulo). El orden y la puntuación se ensamblan a mano porque el
 * default del locale sería "miércoles, 26 de agosto de 2026, 9:59 p. m."
 * (coma tras el día, "de" en vez de "del", sufijo "p. m." con puntos) — el
 * formato pedido lleva día de semana capitalizado, "del <año>", "a las" y
 * "am"/"pm" en minúscula sin puntos. Degrada al string crudo si la fecha no
 * es parseable.
 */
export function formatearFechaLargaConHora(iso: string): string {
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return iso;

  const partes = new Intl.DateTimeFormat("es-CR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "America/Costa_Rica",
  }).formatToParts(fecha);
  const obtener = (tipo: Intl.DateTimeFormatPartTypes) => partes.find((p) => p.type === tipo)?.value ?? "";
  const capitalizar = (texto: string) => (texto ? texto.charAt(0).toUpperCase() + texto.slice(1) : texto);

  const diaSemana = capitalizar(obtener("weekday"));
  // El locale entrega "a. m."/"p. m." — se normaliza a "am"/"pm" (pedido exacto).
  const sufijo = obtener("dayPeriod").replace(/[\s.]/g, "").toLowerCase();

  return `${diaSemana} ${obtener("day")} de ${obtener("month")} del ${obtener("year")} a las ${obtener("hour")}:${obtener("minute")} ${sufijo}`;
}

/**
 * HOY como fecha calendario pura ("YYYY-MM-DD") en la zona `America/Costa_Rica`
 * — el formato que `<input type="date">` usa nativamente en su `value`
 * (feature "fecha de envío" de la cola de facturación, encargo de Yac
 * 2026-08-03, requerida a nivel de LOTE).
 *
 * A propósito NO usa `new Date().toISOString().slice(0, 10)`: `toISOString`
 * siempre expresa el instante en UTC, así que cerca de medianoche en Costa
 * Rica (UTC-6) el día calendario real ya cambió mientras el UTC todavía
 * marca el día anterior (o viceversa) — mismo corrimiento de zona que evita
 * `formatearFechaSoloDia` para fechas ya calendario, pero acá en sentido
 * inverso: hay que OBTENER el día calendario de CR a partir del instante
 * actual, no reformatear un día que ya vino sin hora. `Intl.DateTimeFormat`
 * con `timeZone: "America/Costa_Rica"` resuelve el día calendario correcto
 * sin importar la zona del servidor (mismo criterio que el resto del
 * módulo).
 */
export function hoyEnCostaRica(): string {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Costa_Rica",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const obtener = (tipo: "year" | "month" | "day") => partes.find((p) => p.type === tipo)?.value ?? "";
  return `${obtener("year")}-${obtener("month")}-${obtener("day")}`;
}

/**
 * Sello de tiempo del INSTANTE actual apto para NOMBRE DE ARCHIVO, en la zona
 * de Costa Rica: `"AAAA-MM-DD_HH-MM-SS"` (24h). Encargo de Yac 2026-08-13:
 * poner la fecha y hora de creación en el nombre de los exports (ej.
 * `clientes-facturados-2026-08-13_14-30-05.xlsx`). Sin `:` (inválido en nombres
 * de archivo de Windows) — se usan guiones. Zona `America/Costa_Rica` FIJA
 * (mismo criterio que el resto del módulo, regla dura #5); `hourCycle: "h23"`
 * evita el "24" de medianoche que algunos ICU producen con `hour12: false`.
 */
export function selloTiempoArchivoCostaRica(): string {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Costa_Rica",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const obtener = (tipo: Intl.DateTimeFormatPartTypes) => partes.find((p) => p.type === tipo)?.value ?? "";
  return `${obtener("year")}-${obtener("month")}-${obtener("day")}_${obtener("hour")}-${obtener("minute")}-${obtener("second")}`;
}

/**
 * Fecha calendario (`"YYYY-MM-DD"`, ej. la que devuelve `hoyEnCostaRica()`) →
 * `"<mes> <año>"` en español minúsculas (ej. `"agosto 2026"`) — encargo del
 * rediseño del dashboard de super-admin (Fase 1): subtítulo "Salud de la
 * operación de todos los couriers · agosto 2026".
 *
 * Mismo criterio de zona que `formatearFechaLarga`: para el NOMBRE del mes
 * hace falta `Intl.DateTimeFormat`, así que se construye un `Date` pero
 * SIEMPRE anclado a UTC (`Date.UTC` + `timeZone: "UTC"`) — la fecha que entra
 * YA es un día calendario sin hora (mismo motivo que documenta
 * `formatearFechaSoloDia`: anclar a una zona con offset introduciría un
 * corrimiento de día que acá además correría el MES en los primeros/últimos
 * días de cada mes). A propósito NO se capitaliza (a diferencia de
 * `formatearFechaLarga`): el subtítulo pedido lleva el mes en minúsculas.
 * Degrada al string crudo si la fecha no es parseable.
 */
export function nombreMesAnioEnCostaRica(fechaIso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(fechaIso);
  if (!match) return fechaIso;
  const [, anio, mes] = match;
  const fecha = new Date(Date.UTC(Number(anio), Number(mes) - 1, 1));
  if (Number.isNaN(fecha.getTime())) return fechaIso;

  const nombreMes = new Intl.DateTimeFormat("es-CR", { month: "long", timeZone: "UTC" }).format(fecha);
  return `${nombreMes} ${anio}`;
}

/** Offset fijo de Costa Rica respecto a UTC: UTC−6, SIN horario de verano (CR no observa DST desde 1992 y no hay ninguno previsto). Ver `INICIO_DIA_CR_OFFSET`. */
const OFFSET_COSTA_RICA = "-06:00";

/**
 * `YYYY-MM-DD` (día calendario) → el INSTANTE de inicio de ese día (00:00:00)
 * expresado en la zona de Costa Rica, en formato ISO 8601 CON offset explícito
 * (`"2026-08-08T00:00:00-06:00"`) — apto para comparar contra una columna
 * `timestamptz` en Postgres/PostgREST (`.gte`/`.lt`).
 *
 * Por qué NO alcanza con pasar el `"YYYY-MM-DD"` crudo a `.gte`/`.lt`: Postgres
 * interpreta `"2026-08-08"` como MEDIANOCHE UTC. Como Costa Rica es UTC−6, un
 * documento emitido a las 8 p. m. hora CR del 08/08 se guarda como
 * `2026-08-09T02:00:00Z`; un rango calculado en UTC (medianoche UTC del 08 →
 * medianoche UTC del 09) lo DEJA FUERA, aunque calendariamente sea del día 08
 * en CR. Anclando el límite al offset `-06:00` la ventana cubre el día
 * calendario COMPLETO de Costa Rica (00:00–24:00 CR = 06:00Z del día → 06:00Z
 * del día siguiente), que es lo que el usuario espera al elegir "8/8 a 8/8"
 * sin ingresar horas.
 *
 * CR es UTC−6 fijo sin DST (mismo criterio de zona fija que el resto del
 * módulo, regla dura #5 — alcance Costa Rica en el MVP), así que el offset
 * literal es correcto y estable; el día listo para hacerse configurable por
 * tenant si algún día se agrega una columna de zona horaria.
 */
export function inicioDelDiaEnCostaRicaIso(fechaIso: string): string {
  return `${fechaIso}T00:00:00${OFFSET_COSTA_RICA}`;
}

/**
 * Diferencia en DÍAS CALENDARIO completos entre dos fechas `"YYYY-MM-DD"`
 * (`hasta - desde`) — aritmética PURA en UTC (`Date.UTC` vía el mismo truco de
 * `diaSiguiente`/`primerDiaDelMesSiguiente`: agnóstica de zona horaria, porque
 * ambos strings YA son días calendario sin componente de hora — no hace falta
 * anclar a Costa Rica acá, eso lo hace quien produce/consume el resultado con
 * `hoyEnCostaRica()`/`inicioDelDiaEnCostaRicaIso`).
 *
 * Usada por el medidor de consumo del plan (tarea 3.4, MED-1/2/3) para
 * derivar "días restantes del ciclo" (`cicloFin` es EXCLUSIVO, ver
 * `obtener_consumo_ciclo_vigente()`) sin reimplementar el cálculo del ciclo
 * en sí (eso vive en BD, `private.calcular_ciclo_consumo_vigente`).
 *
 * Puede devolver NEGATIVO si `hasta` es anterior a `desde` — el caller decide
 * si acotar a 0 (ej. un ciclo que ya venció y todavía no se refrescó).
 */
export function diferenciaDiasCalendario(desde: string, hasta: string): number {
  const MS_POR_DIA = 24 * 60 * 60 * 1000;
  const fechaDesde = new Date(`${desde}T00:00:00.000Z`);
  const fechaHasta = new Date(`${hasta}T00:00:00.000Z`);
  return Math.round((fechaHasta.getTime() - fechaDesde.getTime()) / MS_POR_DIA);
}

/** `YYYY-MM-DD` → el día 01 del MISMO mes calendario, mismo formato. Aritmética de string pura (sin `Date`, sin zona) — mismo criterio que `formatearFechaSoloDia`. */
function primerDiaDelMes(fechaIso: string): string {
  return `${fechaIso.slice(0, 7)}-01`;
}

/**
 * `YYYY-MM-DD` → el día 01 del mes CALENDARIO SIGUIENTE, mismo formato.
 * Aritmética de calendario pura en UTC (mismo criterio que `diaSiguiente` en
 * `lib/documentos/datos.ts`, agnóstica de zona horaria — el anclaje a CR lo
 * agrega quien use el resultado con `inicioDelDiaEnCostaRicaIso`). El mes
 * (`1..12`, YA 1-indexado) usado directo como índice 0-indexado de
 * `Date.UTC` da el mes SIGUIENTE (ej. mes="08" → 8 → índice 8 = setiembre);
 * `Date.UTC` hace el rollover de año automático para diciembre (mes="12" →
 * 12 → índice 12 = enero del año siguiente).
 */
function primerDiaDelMesSiguiente(fechaIso: string): string {
  const [anio, mes] = fechaIso.split("-").map(Number);
  const fecha = new Date(Date.UTC(anio, mes, 1));
  return fecha.toISOString().slice(0, 10);
}

/**
 * Rango [inicio del mes calendario ACTUAL, inicio del mes SIGUIENTE) del
 * INSTANTE en que se llama, anclado a la hora de Costa Rica — mismo criterio
 * de anclaje que `inicioDelDiaEnCostaRicaIso` (evita el mismo corrimiento de
 * zona: cerca de medianoche en CR, el día/mes calendario real puede diferir
 * del que marca UTC). Usado por el Dashboard del courier (tarea 3.3, DAS-2/
 * MED-1) para acotar "monto facturado del período" y "documentos emitidos
 * este mes" — NO es el ciclo de plan anclado a `fecha_alta` (eso es MED-1
 * real, tarea 3.4); es una aproximación deliberada al mes CALENDARIO.
 *
 * `hasta` es el límite EXCLUSIVO (apto para `.lt()`), igual que
 * `inicioDelDiaEnCostaRicaIso`/`diaSiguiente` en `lib/documentos/datos.ts`.
 */
export function rangoMesActualEnCostaRica(): { desde: string; hasta: string } {
  const hoy = hoyEnCostaRica();
  return {
    desde: inicioDelDiaEnCostaRicaIso(primerDiaDelMes(hoy)),
    hasta: inicioDelDiaEnCostaRicaIso(primerDiaDelMesSiguiente(hoy)),
  };
}
