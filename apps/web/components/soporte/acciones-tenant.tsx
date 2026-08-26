"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { bloquearTenant, desbloquearTenant, entrarASoporte } from "@/lib/soporte/acciones";
import { textosSoporte } from "@/lib/textos/soporte";

const t = textosSoporte.consola;

interface AccionesTenantProps {
  tenantId: string;
  estado: "activo" | "bloqueado";
}

/**
 * Acciones por fila de la consola de plataforma. Las Server Actions
 * (`entrarASoporte`/`bloquearTenant`/`desbloquearTenant`) devuelven un objeto
 * de error controlado (o redirigen); por eso se invocan desde un Client
 * Component con `useTransition` en vez de como `form action` directo — así se
 * puede mostrar el mensaje de error sin romper el tipado del form.
 */
export function AccionesTenant({ tenantId, estado }: AccionesTenantProps) {
  const [pendiente, iniciar] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  function correr(accion: (id: string) => Promise<{ error: string } | void>) {
    setError(null);
    iniciar(async () => {
      const resultado = await accion(tenantId);
      if (resultado && "error" in resultado) setError(resultado.error);
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center justify-end gap-2">
        <Button type="button" size="sm" variant="outline" disabled={pendiente} onClick={() => correr(entrarASoporte)}>
          {t.acciones.entrar}
        </Button>
        {estado === "bloqueado" ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pendiente}
            onClick={() => correr(desbloquearTenant)}
          >
            {t.acciones.desbloquear}
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pendiente}
            onClick={() => correr(bloquearTenant)}
          >
            {t.acciones.bloquear}
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
