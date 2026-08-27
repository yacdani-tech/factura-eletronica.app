import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@factura/ui/card";
import { Button } from "@factura/ui/button";
import { cerrarSesion } from "@/lib/auth/acciones";
import { textosAuth } from "@/lib/textos/auth";

/**
 * Placeholder para un usuario CON sesión pero SIN membresía activa en ningún
 * tenant (todavía no fue invitado, o su invitación no fue aceptada). La
 * aceptación real de invitaciones (con el token de la URL) llega en la Fase 4
 * — acá solo se explica la situación, sin dejar al usuario varado sin salida.
 */
export function SinEquipo() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1.5 text-center">
          <CardTitle>{textosAuth.sinEquipo.titulo}</CardTitle>
          <CardDescription>{textosAuth.sinEquipo.descripcion}</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={cerrarSesion}>
            <Button type="submit" variant="outline" className="w-full">
              {textosAuth.sinEquipo.botonCerrarSesion}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
