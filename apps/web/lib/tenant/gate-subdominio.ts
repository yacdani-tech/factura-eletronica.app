import { resolverTenantPublicoDesdeRequest } from "@/lib/tenant/tenant-publico";

/**
 * Gate de "existencia de tenant" para los layouts server-side ((auth) y
 * (app)): responde a la pregunta "¿el subdominio de esta request corresponde
 * a ALGÚN tenant?", nada más — no decide login, sesión ni bloqueo.
 *
 * Reutiliza `resolverTenantPublicoDesdeRequest()` (`lib/registro-publico/
 * tenant-publico.ts`) en vez de duplicar la query: esa función YA lee el
 * header interno `x-tenant-subdominio` (escrito por el middleware, nunca un
 * valor que mande el cliente — regla dura #1) y consulta `public.tenants` con
 * el cliente `service_role`. Es la MISMA imposibilidad estructural ya
 * documentada ahí — un request sin sesión (o con sesión de OTRO tenant) no
 * puede leer `tenants` vía RLS (`tenants_ver_propio_o_super_admin` exige
 * membresía o Super-Admin), así que no hay forma de resolver "¿existe este
 * subdominio?" con el cliente de sesión normal. No se agrega un segundo punto
 * que toque `service_role`: este helper es un wrapper delgado sobre el único
 * lugar que ya lo hace.
 *
 * Sin `import "server-only"` propio, mismo criterio que `tenant-publico.ts`:
 * este módulo se testea DIRECTO mockeando `next/headers` y el resolver (no el
 * archivo completo) — el guard de `server-only` revienta bajo Vitest fuera de
 * la condición `react-server`. El único punto que SÍ toca el secreto real
 * (`createAdminClient`) sigue protegido por su propio `import "server-only"`.
 */
export async function subdominioActualNoExiste(): Promise<boolean> {
  const resultado = await resolverTenantPublicoDesdeRequest();

  if (!("error" in resultado)) return false; // { tenant } -> existe y activo.

  switch (resultado.error) {
    case "no_encontrado":
      // Único caso real: ningún tenant tiene este subdominio -> 404.
      return true;
    case "sin_subdominio":
      // Host de plataforma (raíz / www / web, o localhost sin subdominio):
      // no hay "tenant" que buscar, este gate no aplica -> login/app normal.
      return false;
    case "bloqueado":
      // El tenant SÍ existe (solo está bloqueado) -> NO es 404. Dar 404 acá
      // rompería el flujo de expulsión existente (login muestra el aviso
      // `courier_bloqueado`; el app-shell redirige a `/salir` — regla #15).
      return false;
    case "error_servidor":
      // Fail-OPEN: un fallo de configuración/conexión (ej. falta
      // SUPABASE_SERVICE_ROLE_KEY, o un error transitorio de Postgres) NUNCA
      // debe sacar a TODOS los subdominios con un 404 genérico.
      return false;
  }
}
