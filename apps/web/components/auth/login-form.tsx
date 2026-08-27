"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { GoogleBoton } from "@/components/auth/google-boton";
import { SeparadorO } from "@/components/auth/separador-o";
import { iniciarSesionConPassword } from "@/lib/auth/acciones";
import { ESTADO_INICIAL_AUTH, type EstadoAccionAuth } from "@factura/core/auth/tipos";
import { textosAuth } from "@/lib/textos/auth";

interface LoginFormProps {
  next?: string;
  errorInicial?: string;
}

export function LoginForm({ next, errorInicial }: LoginFormProps) {
  const estadoInicial: EstadoAccionAuth = errorInicial ? { error: errorInicial } : ESTADO_INICIAL_AUTH;
  const [estado, accion, pendiente] = useActionState(iniciarSesionConPassword, estadoInicial);
  // Regla dura #14 (CLAUDE.md): lo digitado persiste ante un error — React 19
  // resetea el <form action> al completar la action, así que los campos van
  // controlados. Tras un login EXITOSO hay redirect, no hay reset visible.
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  return (
    <Card>
      <CardHeader className="space-y-1.5 text-center">
        <CardTitle>{textosAuth.login.titulo}</CardTitle>
        <CardDescription>{textosAuth.login.subtitulo}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <GoogleBoton next={next} label={textosAuth.login.botonGoogle} />

        <SeparadorO texto={textosAuth.login.separador} />

        <form action={accion} className="flex flex-col gap-4" noValidate>
          <input type="hidden" name="next" value={next ?? ""} />

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">{textosAuth.login.emailLabel}</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder={textosAuth.login.emailPlaceholder}
              aria-invalid={!!estado.error}
              value={email}
              onChange={(evento) => setEmail(evento.target.value)}
              required
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password">{textosAuth.login.passwordLabel}</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              placeholder={textosAuth.login.passwordPlaceholder}
              aria-invalid={!!estado.error}
              value={password}
              onChange={(evento) => setPassword(evento.target.value)}
              required
            />
          </div>

          {estado.error && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {estado.error}
            </p>
          )}

          <Button type="submit" size="lg" disabled={pendiente} className="w-full">
            {pendiente ? textosAuth.login.botonSubmitCargando : textosAuth.login.botonSubmit}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
