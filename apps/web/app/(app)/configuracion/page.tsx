import type { Metadata } from "next";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@factura/ui/card";

export const metadata: Metadata = {
  title: "Configuración — factura-electronica.app",
};

export default function ConfiguracionPage() {
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Configuración</CardTitle>
          <CardDescription>Ajustes de tu cuenta.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Las opciones de configuración se agregan en una fase posterior.</p>
        </CardContent>
      </Card>
    </div>
  );
}
