import { Separator } from "@factura/ui/separator";

/** Separador "o con tu correo" entre el botón de Google y el formulario. */
export function SeparadorO({ texto }: { texto: string }) {
  return (
    <div className="relative my-2">
      <div className="absolute inset-0 flex items-center">
        <Separator />
      </div>
      <div className="relative flex justify-center">
        <span className="bg-background px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {texto}
        </span>
      </div>
    </div>
  );
}
