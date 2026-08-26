import { textosPaginacion } from "@/lib/textos/paginacion";

export interface TotalResultadosProps {
  /** Total EXACTO del set filtrado (`count: "exact"` ya calculado por la capa de datos — nunca recalculado acá, ver `lib/paginacion.ts`). */
  total: number;
}

/**
 * "N resultados" GENÉRICO y reutilizable — Server Component puro (no
 * necesita interactividad, a diferencia de `SelectorTamanoPagina`). Mismo
 * espíritu que `Paginacion`: no sabe nada de la forma de los datos, solo de
 * un número ya calculado. Se monta a la par del selector "Filas por página"
 * en toda lista paginada del sitio (decisión de Yac 2026-07-30).
 *
 * Renderiza SIEMPRE (nunca `null`) — a diferencia de `Paginacion`, que se
 * oculta con una sola página: es la propia página la que decide si lo monta
 * (dentro del mismo `if` que ya envuelve la fila de selector+paginación,
 * cuando ese `if` existe).
 */
export function TotalResultados({ total }: TotalResultadosProps) {
  return (
    <p aria-live="polite" className="text-sm text-muted-foreground">
      {textosPaginacion.resultados(total)}
    </p>
  );
}
