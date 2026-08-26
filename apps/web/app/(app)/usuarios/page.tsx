import type { Metadata } from "next";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Usuarios — factura-eletronica.app",
};

export default function UsuariosPage() {
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Usuarios</CardTitle>
          <CardDescription>Gestioná el equipo de tu cuenta.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">La gestión de usuarios se agrega en una fase posterior.</p>
        </CardContent>
      </Card>
    </div>
  );
}
