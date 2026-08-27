import Link from "next/link";
import type { Metadata } from "next";

import { Button } from "@factura/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@factura/ui/card";
import { textosAuth } from "@/lib/textos/auth";

export const metadata: Metadata = {
  title: "Acceso por invitación — factura-electronica.app",
};

/**
 * REG-2 (decisión de Yac 2026-07-14): cierra el /registro público abierto de
 * staff. A propósito ya NO hay ningún formulario acá — crear una cuenta con
 * un correo arbitrario ya no es posible en ningún punto de la app. La ÚNICA
 * forma de crear cuenta de staff es aceptando una invitación
 * (`/invitacion/[token]`, ver `app/invitacion/[token]/page.tsx`), donde el
 * correo viene FIJADO por la invitación (nunca lo elige quien se registra).
 */
export default function RegistroPage() {
  return (
    <Card>
      <CardHeader className="space-y-1.5 text-center">
        <CardTitle>{textosAuth.registroCerrado.titulo}</CardTitle>
        <CardDescription>{textosAuth.registroCerrado.descripcion}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild size="lg" className="w-full">
          <Link href="/login">{textosAuth.registroCerrado.botonLogin}</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
