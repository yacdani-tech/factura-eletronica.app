import { Button } from "@/components/ui/button";
import { GoogleIcon } from "@/components/auth/google-icon";
import { iniciarSesionConGoogle } from "@/lib/auth/acciones";

interface GoogleBotonProps {
  next?: string;
  label: string;
}

/**
 * Botón "Continuar con Google". Server Component: el form envía directo a la
 * Server Action (signInWithOAuth + redirect), sin necesitar interactividad de
 * cliente — no hace falta "use client" para esto.
 */
export function GoogleBoton({ next, label }: GoogleBotonProps) {
  return (
    <form action={iniciarSesionConGoogle}>
      <input type="hidden" name="next" value={next ?? ""} />
      <Button type="submit" variant="outline" size="lg" className="w-full gap-2">
        <GoogleIcon className="h-4 w-4" />
        {label}
      </Button>
    </form>
  );
}
