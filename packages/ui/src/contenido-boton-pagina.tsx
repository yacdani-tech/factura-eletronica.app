"use client";

import { useLinkStatus } from "next/link";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";

import { textosPaginacion } from "./textos";

/**
 * Contenido (ícono + texto) del botón de paginación HABILITADO — Client
 * Component chico que vive DENTRO del `<Link>` de `Paginacion` para poder leer
 * `useLinkStatus()`, el primitivo de Next 15 que reporta si la navegación de su
 * `<Link>` ancestro más cercano está en curso.
 *
 * Por qué existe: el pager (`components/ui/paginacion.tsx`) navega con `<Link>`
 * real (cada click es una request de servidor que re-ejecuta la página), y esa
 * carga tardaba sin ninguna señal visual — el usuario no sabía si su click hizo
 * algo y volvía a tocar (decisión de Yac 2026-08-25). Mientras la navegación
 * está `pending`, este componente reemplaza la flecha por un spinner EN EL MISMO
 * lugar (el `Loader2` hereda el tamaño del `[&_svg]` del `Button`, igual que el
 * chevron), así el botón no cambia de ancho. Solo el botón TOCADO entra en
 * `pending` (cada `<Link>` tiene su propio estado); el otro no se toca.
 *
 * Se mantiene el `<Link>` a propósito (no se convierte a `router.push`): así se
 * preservan prefetch, "abrir en pestaña nueva" y ctrl/⌘+click. El patrón
 * `useTransition` + `router.push` de `selector-tamano-pagina.tsx` es para el
 * `<Select>` (que no puede ser link); acá `useLinkStatus` es la variante correcta.
 *
 * Solo se usa en la rama HABILITADA del pager: el botón deshabilitado (página 1
 * o última) es un `<span>` estático sin `<Link>` ancestro — no navega, no puede
 * estar `pending`.
 */
export function ContenidoBotonPagina({ direccion }: { direccion: "anterior" | "siguiente" }) {
  const { pending } = useLinkStatus();

  const icono = pending ? (
    <Loader2 className="animate-spin" aria-hidden="true" />
  ) : direccion === "anterior" ? (
    <ChevronLeft aria-hidden="true" />
  ) : (
    <ChevronRight aria-hidden="true" />
  );

  const texto = direccion === "anterior" ? textosPaginacion.anterior : textosPaginacion.siguiente;

  return (
    <>
      {direccion === "anterior" && icono}
      {texto}
      {direccion === "siguiente" && icono}
      {pending && <span className="sr-only">{textosPaginacion.cargando}</span>}
    </>
  );
}
