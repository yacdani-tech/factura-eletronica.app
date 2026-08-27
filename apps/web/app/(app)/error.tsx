"use client";

import * as React from "react";

import { Button } from "@factura/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@factura/ui/card";
import { textosComun } from "@/lib/textos/comun";

/**
 * Boundary de error GENÉRICO para TODAS las rutas autenticadas
 * (`app/(app)/*` — clientes, paquetes, documentos, consolidados,
 * configuración, soporte, dashboard, WhatsApp, etc.) — blindaje app-wide
 * agregado 2026-08-12, mismo patrón/criterio que
 * `app/(app)/facturacion/error.tsx` (ver su docstring para el contexto
 * completo de por qué se agregó: un `Runtime TypeError` reportado por Yac que
 * no se pudo reproducir de forma determinista pese a varios intentos fieles,
 * y el hallazgo de que NINGUNA ruta del proyecto tenía red de seguridad ante
 * un throw no atrapado).
 *
 * Al vivir DENTRO de `app/(app)/layout.tsx` (el shell con sidebar/topbar),
 * Next.js SOLO reemplaza el ÁREA DE CONTENIDO cuando este boundary atrapa un
 * error — el shell (navegación, sesión, selector de tenant) se mantiene
 * intacto, así que el usuario nunca pierde la posibilidad de navegar a otra
 * pantalla o cerrar sesión aunque la pantalla actual haya reventado.
 *
 * Especificidad de Next.js App Router: si una ruta tiene su PROPIO
 * `error.tsx` (hoy, solo `/facturacion`), ESE gana para esa ruta — este
 * boundary genérico solo atrapa lo que ningún `error.tsx` más específico ya
 * atrapó. No hay que coordinar nada entre ambos: es el comportamiento nativo
 * del framework (el boundary más profundo/cercano al error atrapa primero).
 *
 * Mismo contrato que el boundary de facturación: `"use client"` obligatorio
 * (regla de Next.js — un `error.tsx` solo atrapa errores de sus HIJOS, nunca
 * los propios), mensaje SIEMPRE genérico en español (regla dura #8: nunca
 * `error.message`/`error.digest` expuestos al usuario — pueden traer detalle
 * técnico/interno), el error COMPLETO se loguea server-side vía
 * `console.error` para diagnóstico, y `reset()` reintenta el segmento sin
 * recargar la pestaña completa.
 */
export default function ErrorApp({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = textosComun.errorInesperado;

  React.useEffect(() => {
    console.error("[app] error boundary genérico:", error);
  }, [error]);

  return (
    <div className="flex flex-col gap-6">
      <Card className="max-w-md">
        <CardHeader>
          <CardTitle>{t.titulo}</CardTitle>
          <CardDescription>{t.descripcion}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button type="button" variant="outline" onClick={() => reset()}>
            {t.reintentar}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
