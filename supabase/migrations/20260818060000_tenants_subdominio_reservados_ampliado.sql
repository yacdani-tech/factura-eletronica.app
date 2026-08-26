-- Nota de impacto (feature "blocklist de subdominios ampliada"):
-- Tabla tocada: public.tenants (solo el CHECK tenants_subdominio_no_reservado,
-- ninguna columna ni fila se modifica). NO destructiva.
--
-- Contexto: la lista AUTORITATIVA de subdominios reservados vive en la app
-- (SUBDOMINIOS_RESERVADOS, apps/web/lib/tenant/subdominio.ts) y puede crecer
-- sin migración (así lo dice el comentario original del constraint en
-- 20260713090200_tenants_y_usuarios.sql). Este CHECK es solo defensa en
-- profundidad a nivel BD: se refresca acá para que el espejo no quede corto
-- frente a la lista curada ampliada que la app acaba de adoptar.
--
-- Verificación previa a escribir esta migración (2026-08-18, vía
-- `supabase db query --linked` / `--project-ref`, solo lectura):
--   - Proyecto dev (amonvobkexhebkagfrzn, "PlataformaApp", el vinculado por
--     defecto en este repo): 47 tenants. UNA colisión exacta con la lista
--     nueva -> subdominio 'demo' (tenant de prueba/demo ya existente). El
--     resto son tenants de e2e/lotes/pruebas sin ningún match exacto con las
--     palabras nuevas.
--   - Proyecto prod (mafsrpvvxavnfdvjmxat, "PlataformaApp-AUT", recién
--     aprovisionado 2026-08-17): 1 solo tenant ('emma'). Sin colisión.
--
-- Por la colisión de 'demo' en dev, el ADD CONSTRAINT se hace NOT VALID: la
-- lista queda completa y exacta (mismo texto que en la app, sin recortar
-- ninguna palabra), pero Postgres NO revalida las filas existentes al
-- agregar el constraint -- así el tenant 'demo' ya existente en dev queda
-- grandfathered y la migración no falla en ningún ambiente. Un CHECK
-- NOT VALID igual se aplica de lleno a partir de acá: cualquier INSERT
-- nuevo, o cualquier UPDATE que toque la columna subdominio (incluida la
-- propia fila 'demo', si alguna vez se le quisiera cambiar el subdominio),
-- se valida contra la lista completa. No se excluyó 'demo' de la lista para
-- no desviarse del set curado exacto pedido.
--
-- Plan de reversión: `alter table public.tenants drop constraint if exists
-- tenants_subdominio_no_reservado;` y re-crear con la lista anterior de
-- 20260713090200 si hiciera falta revertir.
--
-- Cómo validar que no rompe tenants existentes: correr esta migración y
-- confirmar que termina sin error (la validación NOT VALID no escanea filas
-- existentes); luego `select subdominio from public.tenants where
-- subdominio in (<lista nueva>)` debe devolver como mucho la fila 'demo' en
-- dev (grandfathered) y ninguna en prod.

alter table public.tenants
  drop constraint if exists tenants_subdominio_no_reservado;

alter table public.tenants
  add constraint tenants_subdominio_no_reservado check (
    subdominio not in (
      'app', 'web', 'api', 'admin', 'registro', 'www',
      'mail', 'ftp', 'cdn', 'static', 'assets', 'blog', 'status',
      'soporte', 'support', 'help', 'ayuda', 'dashboard', 'panel',
      'portal', 'cuenta', 'account', 'billing', 'pagos', 'auth',
      'login', 'signup', 'dev', 'staging', 'test', 'demo', 'sandbox',
      'root', 'sistema', 'system', 'noreply', 'info', 'contacto',
      'superadmin'
    )
  ) not valid;

comment on constraint tenants_subdominio_no_reservado on public.tenants is
  'Defensa en profundidad de COU-3 (palabras reservadas bloqueadas). La '
  'lista AUTORITATIVA y actualizable vive en la app '
  '(SUBDOMINIOS_RESERVADOS, apps/web/lib/tenant/subdominio.ts) y puede '
  'crecer sin migración; esta es solo la red de seguridad a nivel BD, '
  'espejo de esa lista (ampliada 2026-08-18). NOT VALID: en el proyecto dev '
  'existía el tenant ''demo'' antes de esta migración (grandfathered, no '
  'revalidado); se sigue aplicando de lleno a todo INSERT nuevo y a '
  'cualquier UPDATE que toque la columna subdominio.';
