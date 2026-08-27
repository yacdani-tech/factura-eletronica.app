import type { Metadata } from "next";
import { redirect } from "next/navigation";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@factura/ui/table";
import { Badge } from "@factura/ui/badge";
import { exigirSuperAdmin } from "@factura/db/auth/exigir-super-admin";
import { listarSuscripcionesTenants } from "@/lib/soporte/suscripciones/datos";
import { AccionesSuscripcion } from "@/components/soporte/acciones-suscripcion";
import type { EstadoSuscripcionFactura } from "@factura/core/suscripcion/tipos";

export const metadata: Metadata = {
  title: "Suscripciones — factura-electronica.app",
  robots: { index: false, follow: false },
};

const ETIQUETA_ESTADO: Record<EstadoSuscripcionFactura, string> = {
  pendiente: "Pendiente",
  reportado: "Reportado",
  pagado: "Pagado",
};

function variantEstado(estado: EstadoSuscripcionFactura | null): "neutro" | "info" | "exito" {
  if (estado === "pagado") return "exito";
  if (estado === "reportado") return "info";
  return "neutro";
}

/**
 * Sub-panel BÁSICO de la consola de plataforma (super-admin): lista una fila
 * por tenant con su factura de suscripción VIGENTE (monto USD, estado, días de
 * atraso) y las acciones de estado (marcar pagada / revertir). Read-only salvo
 * esas dos acciones. La subida de comprobante por el tenant y el detalle
 * histórico por tenant quedan para el proyecto derivado.
 *
 * Defensa en profundidad: re-exige el rol super-admin aunque el layout ya
 * enrute el modo plataforma.
 */
export default async function ConsolaSuscripcionesPage() {
  const guard = await exigirSuperAdmin();
  if (!guard.autorizado) {
    if (guard.motivo === "sin_sesion") redirect("/login");
    redirect("/dashboard");
  }

  const { filas, error } = await listarSuscripcionesTenants();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-foreground">Suscripciones</h1>
        <p className="text-sm text-muted-foreground">
          Factura de suscripción vigente de cada cuenta (tenant). La plataforma cobra en USD por ciclo de aniversario.
        </p>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          No pudimos cargar las suscripciones. Volvé a intentar en un momento.
        </p>
      ) : filas.length === 0 ? (
        <p className="text-sm text-muted-foreground">Todavía no hay cuentas con suscripción.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cuenta</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead>Monto (USD)</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>Atraso</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filas.map((fila) => (
              <TableRow key={fila.tenantId}>
                <TableCell className="font-medium text-foreground">
                  {fila.nombre}
                  <span className="block text-xs text-muted-foreground">{fila.subdominio}</span>
                </TableCell>
                <TableCell className="text-muted-foreground">{fila.planNombre ?? "Sin plan"}</TableCell>
                <TableCell className="tabular-nums">{fila.montoUsd ?? "—"}</TableCell>
                <TableCell>
                  {fila.estadoFactura ? (
                    <Badge variant={variantEstado(fila.estadoFactura)}>{ETIQUETA_ESTADO[fila.estadoFactura]}</Badge>
                  ) : (
                    <span className="text-xs text-muted-foreground">Sin factura</span>
                  )}
                </TableCell>
                <TableCell className="tabular-nums">
                  {fila.diasAtraso > 0 ? `${fila.diasAtraso} d` : "—"}
                </TableCell>
                <TableCell>
                  <AccionesSuscripcion facturaId={fila.facturaId} estadoFactura={fila.estadoFactura} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
