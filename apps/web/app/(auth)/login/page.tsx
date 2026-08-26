import type { Metadata } from "next";

import { LoginForm } from "@/components/auth/login-form";
import { textosAuth } from "@/lib/textos/auth";

export const metadata: Metadata = {
  title: "Ingresar — factura-eletronica.app",
};

interface LoginPageProps {
  searchParams: Promise<{ next?: string; error?: string; motivo?: string }>;
}

/**
 * Traduce un `?motivo=...` (con el que `/salir` redirige tras una expulsión) a
 * un texto de aviso del catálogo FIJO `textosAuth.avisos`. Nunca se renderiza
 * el valor crudo de la query string: si el motivo no está en el catálogo,
 * devuelve `undefined` (sin aviso). Hoy solo `courier_bloqueado`.
 */
function avisoPorMotivo(motivo: string | undefined): string | undefined {
  if (motivo === "courier_bloqueado") return textosAuth.avisos.courierBloqueado;
  return undefined;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  // `error` explícito tiene prioridad sobre el aviso por motivo (un error real
  // del flujo de login es más urgente que un aviso de contexto).
  const mensajeInicial = params.error ?? avisoPorMotivo(params.motivo);
  return <LoginForm next={params.next} errorInicial={mensajeInicial} />;
}
