import type { Metadata } from "next";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Inicio — factura-eletronica.app",
};

/**
 * Dashboard mínimo del esqueleto: un encabezado + estado vacío. Sin widgets de
 * negocio — cada producto que use esta base agrega los suyos acá.
 */
export default function DashboardPage() {
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Bienvenido</CardTitle>
          <CardDescription>Este es el inicio de tu cuenta.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Todavía no hay nada acá. Este esqueleto trae login, resolución de tenant por subdominio y
            una consola básica de plataforma.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
