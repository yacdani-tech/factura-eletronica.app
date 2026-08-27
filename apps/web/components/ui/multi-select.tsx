"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@factura/core/utils";

export interface OpcionMultiSelect {
  value: string;
  label: string;
  /**
   * Conteo opcional que se muestra atenuado a la derecha del label (feature
   * "contador por estado", 2026-07-30). `undefined` = no se muestra nada (el
   * componente sigue siendo válido sin conteos, retrocompatible). Cuando
   * viene, es el total (de todas las páginas) que caería en esa opción según
   * los OTROS filtros aplicados — lo calcula el servidor, ver
   * `contarPaquetesPorRevision`/`contarSubclientesPorRevision`.
   */
  count?: number;
}

/** Formateador de miles fijo `es-CR` (mismo locale que el resto de la app) para los conteos por opción. */
const formateadorConteo = new Intl.NumberFormat("es-CR", { maximumFractionDigits: 0 });

export interface MultiSelectProps {
  id?: string;
  /**
   * Nombre del EJE que filtra este control (ej. "Consolidado", "Revisión") —
   * usado SOLO para construir el `aria-label` dinámico del disparador (ver
   * bug de accesibilidad 2026-07-23 más abajo), nunca se renderiza visible
   * acá (el `<Label htmlFor>` visible sigue viviendo en el caller,
   * `FiltrosPaquetes`).
   */
  label: string;
  opciones: OpcionMultiSelect[];
  /** Valores actualmente marcados — `[]` significa "ninguno elegido" = "todos" (sin filtro). */
  valoresSeleccionados: string[];
  onChange: (valores: string[]) => void;
  /** Texto del disparador cuando `valoresSeleccionados` está vacío (ej. "Todas las rutas"). */
  etiquetaTodos: string;
  /** Texto del disparador cuando hay 2+ valores marcados (ej. `(n) => \`${n} seleccionadas\``). Con 1 solo valor se muestra el label de esa opción; con 0, `etiquetaTodos`. */
  formatearVarios: (n: number) => string;
  className?: string;
  disabled?: boolean;
}

/**
 * Multi-select accesible por teclado, construido sobre `DropdownMenu`
 * (Radix) + `DropdownMenuCheckboxItem` — NO existía ningún control de
 * selección múltiple en el repo (los 5 `<Select>` de `/paquetes` eran
 * single-select, ver `filtros-paquetes.tsx`) y no hay `@radix-ui/react-popover`
 * instalado, así que se reusa el primitivo Popper que ya trae
 * `@radix-ui/react-dropdown-menu` (mismo que usa `Select` para su contenido
 * flotante) en vez de agregar una dependencia nueva.
 *
 * Cada opción es un `DropdownMenuCheckboxItem` con `onSelect={(e) =>
 * e.preventDefault()}` — SIN este `preventDefault`, Radix cierra el menú al
 * marcar CUALQUIER item (comportamiento pensado para un menú de acciones, no
 * para un selector de varias opciones a la vez); con él, el menú permanece
 * abierto hasta que el usuario haga click afuera o presione Escape,
 * permitiendo tildar varias casillas seguidas. `onCheckedChange` (no
 * `onSelect`) es lo que dispara el toggle real.
 *
 * El disparador ANCHO se ajusta al trigger real vía la variable CSS que
 * expone el primitivo Popper subyacente (`--radix-popper-anchor-width`,
 * NO `--radix-dropdown-menu-trigger-width` — ese alias solo lo define
 * `@radix-ui/react-select` para sí mismo, `react-dropdown-menu` no lo
 * re-expone con su propio nombre pero comparte el mismo Popper.Content por
 * debajo, así que la variable de más bajo nivel sigue disponible).
 *
 * NO vive nunca dentro de un `<form action>` (los filtros de `/paquetes`
 * navegan con `router.push`, no hacen submit de formulario) — el bug de
 * reset nativo de React 19 documentado en `components/ui/select.tsx` no
 * aplica acá; si en el futuro este componente se usara DENTRO de un form con
 * Server Action, habría que evaluar el mismo blindaje.
 *
 * BUG DE ACCESIBILIDAD #2 (hallado por QA, 2026-08-04): este menú vive SIEMPRE
 * dentro de un `Sheet` (Radix Dialog, `BarraFiltrosSheet`) — cerrar el menú
 * con Escape y CASI ENSEGUIDA cerrar el panel con OTRO Escape dejaba un
 * `aria-hidden="true"` pegado para siempre en elementos de fondo (el
 * `Sidebar`, la fila de chips del panel, la paginación...), invisible a
 * simple vista (el layout no cambia) pero que rompe lectores de pantalla
 * reales y cualquier `getByRole` de Playwright hasta recargar la página.
 * Investigado a fondo (reproducido con `MutationObserver`/patch de
 * `setAttribute` + inspección de `node_modules/@radix-ui` y `aria-hidden`),
 * son DOS causas independientes, ambas necesarias para el fix completo:
 *
 * 1. Dos primitivos Radix "modales" anidados (`Dialog` del `Sheet` +
 *    `DropdownMenu`, ambos `modal` por defecto) cada uno aplicaba su propio
 *    `hideOthers()` (lib `aria-hidden`) al resto del documento. Fix:
 *    `modal={false}` en el `DropdownMenu` de este componente — dejó de
 *    instalar su propio `hideOthers`/bloqueo de scroll; el ÚNICO que
 *    administra el `aria-hidden` del fondo pasa a ser el `Dialog` del
 *    `Sheet` (o ninguno, si el `MultiSelect` se usa fuera de un Sheet).
 *    `modal={false}` en Radix DropdownMenu NO cambia el cierre por Escape ni
 *    por click afuera (el `DismissableLayer` sigue registrando ambos
 *    disparadores sin importar `modal`); lo único que deja de hacer es el
 *    bloqueo de scroll/foco-atrapado del documento — comportamiento que este
 *    menú, anidado en un panel que YA es modal por el `Sheet`, no necesitaba.
 *
 * 2. AUNQUE `modal={false}` estaba puesto, el bug SEGUÍA reproduciéndose
 *    (confirmado empíricamente, no es teórico). Causa raíz real, mucho más
 *    profunda: Radix `Presence` (`@radix-ui/react-presence`) NO desmonta un
 *    Dialog/DropdownMenu hasta que su PROPIA animación CSS de salida
 *    (`animate-out`) dispara el evento `animationend` del navegador. Si este
 *    `DropdownMenu` (anidado, portaleado aparte) cierra por Escape y, casi
 *    enseguida, el `Sheet` TAMBIÉN cierra por Escape, el desregistro del
 *    `DropdownMenu` de la lista compartida de capas (`DismissableLayerContext
 *    .layers`) dispara un evento (`dismissableLayer.update`) que fuerza un
 *    re-render del `DismissableLayer` del propio `Sheet` justo mientras SU
 *    animación de salida está en pleno vuelo — el `animationend` del Sheet
 *    entonces NUNCA llega, `Presence` queda atascado en `unmountSuspended`
 *    para siempre, el Dialog jamás desmonta de verdad (su overlay sigue en el
 *    DOM aunque invisible) y por lo tanto su cleanup de `hideOthers` tampoco
 *    corre. Verificado exhaustivamente (10+ corridas, distintos escenarios:
 *    doble Escape con 0ms de por medio se rompe SIEMPRE; con >=500ms de gap
 *    entre los dos cierres, o cerrando ambos por mouse, NUNCA se rompe — es
 *    una carrera de tiempo real entre dos animaciones `Presence`, no un bug
 *    "misterioso"). Fix: `data-[state=closed]:!animate-none` en el
 *    `DropdownMenuContent` de ESTE componente — sin animación de SALIDA,
 *    `Presence` ve `animationName === "none"` al cerrar y desmonta de
 *    inmediato, sin esperar ningún evento, eliminando la ventana de la
 *    carrera. El `Sheet` aplica el MISMO criterio a su propio Overlay/Content
 *    (ver `components/ui/sheet.tsx`, comentario en `sheetVariants`) — hace
 *    falta desactivar la animación de salida de AMBOS lados; se probó que
 *    desactivar solo uno de los dos NO alcanza. La animación de ENTRADA
 *    (apertura) de ambos se preserva intacta — el fix es exclusivo del cierre.
 *    OJO con `style={{ animation: "none" }}` inline en este elemento en
 *    particular: Radix Popper (`@radix-ui/react-popper`, el posicionador que
 *    usa `DropdownMenuContent`) SOBRESCRIBE cualquier `style.animation` que
 *    se le pase una vez que termina de posicionarse (`animation:
 *    !isPositioned ? "none" : void 0` en su propio código), así que un
 *    `style` inline NUNCA sobrevive acá — tiene que ser una clase CSS (con
 *    `!important`, ver `data-[state=closed]:!animate-none` arriba), que
 *    Popper no toca. El `Sheet` (Dialog, sin Popper) SÍ podría usar `style`
 *    inline, pero se dejó como clase Tailwind por consistencia con este
 *    componente.
 *
 * BUG DE SCROLL EN MOBILE (hallado por QA, 2026-08-04): dentro de un `Sheet`
 * (Radix `Dialog`), en viewport MÓVIL, una lista larga (ej. "Revisión" de
 * `/subclientes`, 13 opciones fijas) quedaba con sus últimas opciones
 * CORTADAS/INALCANZABLES — ni rueda ni gesto táctil las scrolleaba, aunque el
 * propio `DropdownMenuContent` tuviera `overflow-y-auto` de sobra
 * (confirmado en vivo con Playwright: `scrollTop` se quedaba en `0` pase lo
 * que pase). Causa raíz (confirmada leyendo `node_modules/@radix-ui/react-dialog`
 * y `node_modules/react-remove-scroll`, no adivinada): el `Dialog` del
 * `Sheet` bloquea el scroll de TODO el documento mientras está abierto
 * (`react-remove-scroll`, para que solo el panel scrollee) escuchando
 * `wheel`/`touchmove` en `document` (fase de captura); el ÚNICO elemento que
 * excluye de ese bloqueo es su propio `Dialog.Content` (pasado como `shard`
 * — ver el comentario `// Make sure Content is scrollable even when it
 * doesn't live inside RemoveScroll` en el propio paquete de Radix). Este
 * `DropdownMenuContent` se portalea, por defecto, a `document.body` — un
 * SIBLING del `Dialog.Content` del `Sheet`, no un descendiente — así que NO
 * es ese shard ni un descendiente suyo, y su scroll interno queda bloqueado
 * sin importar que tenga `overflow-y-auto`. Fix: `container` (prop nueva de
 * `DropdownMenuContent`, ver `components/ui/dropdown-menu.tsx`) apunta al
 * `Dialog.Content` ANCESTRO real más cercano al trigger (`closest('[role="dialog"]')`,
 * resuelto en un `useEffect` sobre `triggerRef` — Radix `Dialog.Content` trae
 * `role="dialog"` de fábrica) — así el menú pasa a ser un descendiente REAL
 * del shard permitido y su propio scroll (el más interno en la cadena que
 * camina `react-remove-scroll`) vuelve a funcionar. Si el `MultiSelect` NO
 * está dentro de ningún `Dialog`/`Sheet` (`closest` no encuentra nada),
 * `container` queda `undefined` y el `Portal` cae al comportamiento de
 * SIEMPRE (`document.body`) — cero cambio para ese caso. La posición del menú
 * (Popper, `position: fixed`) no se ve afectada: ni `Sheet`/`Dialog.Content`
 * ni ningún ancestro aplican `transform`/`filter`/`contain` en reposo (solo
 * de forma transitoria durante la animación de apertura, mucho antes de que
 * el usuario llegue a abrir este menú anidado).
 *
 * BUG DE ACCESIBILIDAD (hallado por QA, 2026-07-23): el `<button>` es un
 * elemento "labelable" (WAI-ARIA accname), así que un `<Label htmlFor={id}>`
 * externo (el caller, `FiltrosPaquetes`, pone uno para cada eje) GANA el
 * cálculo del nombre accesible por sobre el CONTENIDO visible del botón — un
 * lector de pantalla anunciaba SIEMPRE el label estático del eje
 * ("Consolidado", "Revisión"...), nunca el texto dinámico de selección
 * ("Todos los consolidados" / "2 seleccionadas"), así que un usuario de
 * lector de pantalla no se enteraba de QUÉ estaba filtrado. Fix: `aria-label`
 * explícito en el propio `<button>` — por el algoritmo de accname,
 * `aria-label` tiene prioridad SOBRE la asociación nativa `<label for>`
 * (orden: `aria-labelledby` > `aria-label` > label nativo > `title`), así que
 * alcanza con setearlo acá para que el nombre accesible refleje la
 * selección real sin tener que tocar el `<Label>` visible del caller. El
 * `<Label>` visible NO desaparece (sigue ahí para usuarios videntes); el
 * `aria-label` combina el nombre del eje (`label`, prop) + el estado actual
 * (`etiqueta`) para que quien usa lector de pantalla reciba AMBOS datos
 * (qué eje es, y qué hay elegido) en un solo anuncio, igual que vería un
 * usuario vidente al leer el `<Label>` + el contenido del botón juntos.
 */
/** Movimiento (px) por encima del cual un gesto táctil se considera SCROLL, no un tap. */
const UMBRAL_TAP_PX = 10;

export function MultiSelect({
  id,
  label,
  opciones,
  valoresSeleccionados,
  onChange,
  etiquetaTodos,
  formatearVarios,
  className,
  disabled,
}: MultiSelectProps) {
  const seleccionados = new Set(valoresSeleccionados);
  const triggerRef = React.useRef<HTMLButtonElement>(null);

  // BUG DE SCROLL EN MOBILE #2 (reporte de Yac 2026-08-15): dentro del `Sheet`
  // de filtros, en el teléfono, tocar cualquiera de estos disparadores PARA
  // HACER SCROLL abría su lista — no se podía bajar por el panel sin abrir un
  // dropdown. Causa raíz (confirmada leyendo `node_modules/@radix-ui/react-dropdown-menu`,
  // línea del `Trigger.onPointerDown`): Radix abre el menú en `pointerdown`
  // cuando `event.button === 0`, SIN mirar `pointerType` — así que en touch
  // abre al INICIAR el toque, que es también el inicio del gesto de scroll.
  // Fix: el menú pasa a ser CONTROLADO y, SOLO en touch, se corta el
  // open-en-pointerdown de Radix (`preventDefault` en el `onPointerDown` del
  // `DropdownMenuTrigger` — `composeEventHandlers` de Radix salta su handler
  // interno si el evento quedó `defaultPrevented`) y el menú se abre recién en
  // un TAP deliberado: `pointerup` en el mismo punto (movimiento <10px). Un
  // scroll (con movimiento, o `pointercancel` cuando el navegador se lleva el
  // puntero) NO abre. El disparador lleva `touch-pan-y` para que el scroll
  // vertical sea nativo e imposible de cancelar por JS. En MOUSE/teclado nada
  // cambia: el handler retorna sin `preventDefault`, Radix abre como siempre.
  const [abierto, setAbierto] = React.useState(false);
  const puntoTactilRef = React.useRef<{ x: number; y: number } | null>(null);

  function alBajarPuntero(evento: React.PointerEvent) {
    if (evento.pointerType !== "touch") return; // mouse/pen: Radix abre en pointerdown como siempre.
    puntoTactilRef.current = { x: evento.clientX, y: evento.clientY };
    evento.preventDefault(); // corta el open-en-pointerdown de Radix; el scroll sigue por `touch-pan-y`.
  }
  function alSubirPuntero(evento: React.PointerEvent) {
    if (evento.pointerType !== "touch") return;
    const inicio = puntoTactilRef.current;
    puntoTactilRef.current = null;
    if (!inicio) return;
    const movimiento = Math.hypot(evento.clientX - inicio.x, evento.clientY - inicio.y);
    if (movimiento < UMBRAL_TAP_PX) setAbierto((previo) => !previo); // fue un tap, no un scroll.
  }
  function alCancelarPuntero() {
    puntoTactilRef.current = null; // el gesto se convirtió en scroll: no abrir.
  }
  // Resuelto una sola vez tras montar (ver docstring "BUG DE SCROLL EN
  // MOBILE" arriba) — `null` cuando no hay ningún `Dialog`/`Sheet` ancestro
  // (Portal cae a `document.body`, el comportamiento de siempre).
  const [dialogoAncestro, setDialogoAncestro] = React.useState<HTMLElement | null>(null);

  React.useEffect(() => {
    setDialogoAncestro(triggerRef.current?.closest<HTMLElement>('[role="dialog"]') ?? null);
  }, []);

  function alternar(value: string) {
    const siguiente = new Set(seleccionados);
    if (siguiente.has(value)) siguiente.delete(value);
    else siguiente.add(value);
    // Se preserva el ORDEN de `opciones` (no el de inserción del Set) para
    // que la URL resultante sea estable sin importar en qué orden el
    // usuario tildó las casillas.
    onChange(opciones.filter((o) => siguiente.has(o.value)).map((o) => o.value));
  }

  let etiqueta: string;
  if (valoresSeleccionados.length === 0) {
    etiqueta = etiquetaTodos;
  } else if (valoresSeleccionados.length === 1) {
    etiqueta = opciones.find((o) => o.value === valoresSeleccionados[0])?.label ?? etiquetaTodos;
  } else {
    etiqueta = formatearVarios(valoresSeleccionados.length);
  }

  return (
    <DropdownMenu modal={false} open={abierto} onOpenChange={setAbierto}>
      <DropdownMenuTrigger
        asChild
        onPointerDown={alBajarPuntero}
        onPointerUp={alSubirPuntero}
        onPointerCancel={alCancelarPuntero}
      >
        <Button
          ref={triggerRef}
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          aria-label={`${label}: ${etiqueta}`}
          className={cn(
            // `text-left`: mismo caso que el trigger de `select.tsx` — el <button>
            // trae `text-align:center` del user-agent y el <span> del valor lo hereda;
            // con una etiqueta larga que se trunca, el texto se centra y deja un hueco
            // adelante. Se ancla a la izquierda para que el valor siempre arranque pegado.
            "h-10 w-full touch-pan-y justify-between px-3.5 py-2 text-left text-sm font-normal text-foreground",
            className,
          )}
        >
          <span aria-hidden="true" className="truncate">{etiqueta}</span>
          <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        container={dialogoAncestro}
        className="max-h-[min(20rem,var(--radix-popper-available-height))] w-[var(--radix-popper-anchor-width)] min-w-[10rem] overflow-y-auto data-[state=closed]:!animate-none"
      >
        {opciones.map((o) => (
          <DropdownMenuCheckboxItem
            key={o.value}
            checked={seleccionados.has(o.value)}
            onSelect={(evento) => evento.preventDefault()}
            onCheckedChange={() => alternar(o.value)}
          >
            <span className="truncate">{o.label}</span>
            {o.count !== undefined && (
              <span className="ml-auto pl-4 tabular-nums text-xs text-muted-foreground">
                {formateadorConteo.format(o.count)}
              </span>
            )}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
