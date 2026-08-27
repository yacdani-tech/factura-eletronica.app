"use client";

import * as React from "react";

import { Button } from "@factura/ui/button";
import { marcarSuscripcionPagada, revertirPagoSuscripcion } from "@/lib/soporte/suscripciones/acciones";
import type { EstadoSuscripcionFactura } from "@factura/core/suscripcion/tipos";

interface AccionesSuscripcionProps {
  facturaId: string | null;
  estadoFactura: EstadoSuscripcionFactura | null;
}

/**
 * Acciones por fila de la consola de suscripciones (super-admin). Las Server
 * Actions devuelven `{ error } | void`, por eso se invocan desde un Client
 * Component con `useTransition` (mismo patrón que `AccionesTenant`).
 *
 * Sin factura generada todavía (facturaId null) no hay ninguna acción posible.
 * Estado pagado -> ofrece "Revertir"; pendiente/reportado -> ofrece "Marcar
 * pagada".
 */
export function AccionesSuscripcion({ facturaId, estadoFactura }: AccionesSuscripcionProps) {
  const [pendiente, iniciar] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  if (!facturaId) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }

  function correr(accion: (id: string) => Promise<{ error: string } | void>) {
    if (!facturaId) return;
    setError(null);
    iniciar(async () => {
      const resultado = await accion(facturaId);
      if (resultado && "error" in resultado) setError(resultado.error);
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {estadoFactura === "pagado" ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pendiente}
          onClick={() => correr(revertirPagoSuscripcion)}
        >
          Revertir pago
        </Button>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pendiente}
          onClick={() => correr((id) => marcarSuscripcionPagada(id))}
        >
          Marcar pagada
        </Button>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
