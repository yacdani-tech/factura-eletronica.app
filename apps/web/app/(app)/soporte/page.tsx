import type { Metadata } from "next";
import { redirect } from "next/navigation";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { exigirSuperAdmin } from "@/lib/auth/exigir-super-admin";
import { listarTenants } from "@/lib/soporte/plataforma/datos";
import { AccionesTenant } from "@/components/soporte/acciones-tenant";
import { textosSoporte } from "@/lib/textos/soporte";

export const metadata: Metadata = {
  title: "Factura Electrónica — factura-eletronica.app",
  robots: { index: false, follow: false },
};

const t = textosSoporte.consola;

/**
 * Consola BÁSICA de plataforma (super-admin): lista las cuentas (tenants) con
 * su plan y estado, y ofrece entrar en modo soporte + bloquear/desbloquear.
 * Los sub-paneles de anulaciones/suscripciones/cron llegan en una fase
 * posterior.
 *
 * Defensa en profundidad: aunque el layout `(app)` ya enruta a un super-admin
 * sin tenant hacia acá (modo plataforma), la página re-exige el rol.
 */
export default async function ConsolaPlataformaPage() {
  const guard = await exigirSuperAdmin();
  if (!guard.autorizado) {
    if (guard.motivo === "sin_sesion") redirect("/login");
    redirect("/dashboard");
  }

  const { tenants, error } = await listarTenants();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-foreground">{t.titulo}</h1>
        <p className="text-sm text-muted-foreground">{t.subtitulo}</p>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {t.error}
        </p>
      ) : tenants.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t.vacio}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t.columnas.nombre}</TableHead>
              <TableHead>{t.columnas.subdominio}</TableHead>
              <TableHead>{t.columnas.plan}</TableHead>
              <TableHead>{t.columnas.estado}</TableHead>
              <TableHead className="text-right">{t.columnas.acciones}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tenants.map((tenant) => (
              <TableRow key={tenant.id}>
                <TableCell className="font-medium text-foreground">{tenant.nombre}</TableCell>
                <TableCell className="text-muted-foreground">{tenant.subdominio}</TableCell>
                <TableCell className="text-muted-foreground">{tenant.planNombre ?? t.sinPlan}</TableCell>
                <TableCell>
                  <Badge variant={tenant.estado === "bloqueado" ? "error" : "neutro"}>
                    {tenant.estado === "bloqueado" ? t.estado.bloqueado : t.estado.activo}
                  </Badge>
                </TableCell>
                <TableCell>
                  <AccionesTenant tenantId={tenant.id} estado={tenant.estado} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
