"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TAMANO_PAGINA_DEFECTO } from "@factura/core/paginacion";

interface SelectorTamanoPaginaProps {
  /** Tamaño EFECTIVO ya resuelto por el servidor (la página valida `?tam=` contra `opciones`, default `TAMANO_PAGINA_DEFECTO`). */
  tamano: number;
  /** Opciones a ofrecer (la whitelist vive en la página, la fuente de verdad del lado servidor — se pasa como prop para no duplicarla). */
  opciones: readonly number[];
  /** Ruta (pathname) sobre la que se arma el `router.push` — mismo patrón que `Paginacion`/los filtros. */
  basePath: string;
  /** Etiqueta visible del selector (ej. "Filas por página") — cada pantalla pasa su propio texto centralizado. */
  label: string;
  /** `id` del `<SelectTrigger>` para atarlo al `<Label>` (único por pantalla — ej. "paquetes-tamano-pagina"). */
  id: string;
  /** Query param de TAMAÑO que este selector controla. Default `"tam"` (paquetes/subclientes/consolidados/soporte, que no lo pasan). Pantallas con MÁS DE UNA lista (ej. Equipo: miembros e invitaciones) pasan uno propio por instancia (`"tamMiembros"`/`"tamInvitaciones"`) para no interferirse entre sí. */
  parametroTamano?: string;
  /** Query param de PÁGINA a resetear al cambiar el tamaño — debe coincidir con el `parametro` que esa misma lista le pasa a `<Paginacion>`. Default `"pagina"`. */
  parametroPagina?: string;
}

/**
 * Selector de "Filas por página" GENÉRICO y reutilizable — Client Component
 * (Server Component no puede navegar con `router.push`). Server-driven, mismo
 * espíritu que `Paginacion`: no sabe nada de la forma de los datos, solo del
 * query param de tamaño (`parametroTamano`, default `"tam"`). Usado hoy por
 * `/paquetes`, `/subclientes`, `/consolidados`, `/soporte` (todas con el
 * default `"tam"`/`"pagina"`) y `/configuracion/equipo` (DOS instancias, una
 * por lista — miembros e invitaciones — cada una con su PROPIO
 * `parametroTamano`/`parametroPagina` para no interferirse entre sí, decisión
 * de Yac 2026-07-30). La whitelist de tamaños y el `label` los pasa cada
 * pantalla.
 *
 * Cambiar el tamaño **vuelve a la página 1** (borra el param de página —
 * `parametroPagina`, default `"pagina"`) y preserva el resto de los params
 * actuales (filtros, orden, búsqueda) tomándolos de `window.location.search`.
 * El default (`TAMANO_PAGINA_DEFECTO`) OMITE el param de tamaño
 * (`parametroTamano`, default `"tam"`) de la URL (una URL "limpia" en el caso
 * por defecto, mismo criterio que `construirHrefPagina` con `pagina=1`).
 *
 * FEEDBACK DE CARGA (decisión de Yac 2026-07-30): a tamaños grandes (hasta 500)
 * la navegación tarda, y sin señal visual el usuario cree que "no pasó nada".
 * La navegación va dentro de `useTransition` — en App Router, `router.push`
 * dentro de `startTransition` mantiene `pendiente=true` hasta que la NUEVA
 * página terminó de renderizar (servidor incluido). Mientras tanto se
 * deshabilita el `<Select>` y se muestra un spinner (mismo patrón que
 * `boton-resolver-nombres.tsx`: `useTransition` + `disabled` + `animate-spin`).
 *
 * `<Select>` (single-valor) del wrapper compartido — ya blindado contra el
 * reset de React 19 (`components/ui/select.tsx`); acá no hay `<form action>`
 * de todos modos, cada cambio navega directo.
 */
export function SelectorTamanoPagina({
  tamano,
  opciones,
  basePath,
  label,
  id,
  parametroTamano = "tam",
  parametroPagina = "pagina",
}: SelectorTamanoPaginaProps) {
  const router = useRouter();
  const [pendiente, iniciarTransicion] = React.useTransition();

  function alCambiar(valor: string) {
    const params = new URLSearchParams(window.location.search);
    params.delete(parametroPagina);
    if (Number(valor) === TAMANO_PAGINA_DEFECTO) params.delete(parametroTamano);
    else params.set(parametroTamano, valor);
    const query = params.toString();
    iniciarTransicion(() => {
      router.push(query ? `${basePath}?${query}` : basePath);
    });
  }

  return (
    <div className="flex items-center gap-2" aria-busy={pendiente}>
      <Label htmlFor={id} className="whitespace-nowrap text-sm text-muted-foreground">
        {label}
      </Label>
      <Select value={String(tamano)} onValueChange={alCambiar} disabled={pendiente}>
        <SelectTrigger id={id} className="w-[5.5rem]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {opciones.map((n) => (
            <SelectItem key={n} value={String(n)}>
              {n}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {pendiente && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />}
    </div>
  );
}
