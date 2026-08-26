---
name: nueva-app
description: Instancia una app nueva a partir del framework factura-eletronica — dado el nombre, el dominio, el documento de requisitos y el branding, clona el esqueleto multi-tenant, reemplaza los tokens de marca, genera el spec + el design-system + el plan, deja el runbook de Supabase y arranca el desarrollo. Usar cuando el dueño del producto quiere crear "otra app" del mismo estilo (SaaS web multi-tenant con login) sobre esta base.
allowed-tools: Read, Grep, Glob, Write, Edit, Bash
---

# /nueva-app — Bootstrap de una app nueva desde `factura-eletronica`

Este skill instancia una app nueva a partir del framework base (este repo). El
resultado es un repo hermano que YA compila en verde (multi-tenant + login +
super-admin + módulos base) y queda listo para desarrollar el negocio concreto con
el skill `bucle-agentico`.

Regla de oro: **el framework NO se modifica**. Se COPIA a la carpeta destino y todo
el trabajo de instanciación ocurre en la copia.

## Inputs que necesita (pedirlos si faltan)

1. **Nombre visible** de la app (ej. `Factura Electrónica`).
2. **Slug** — minúsculas, sin espacios, válido como nombre de paquete npm y de repo
   (ej. `facturaelectronica`). Si no lo dan, derivarlo del nombre.
3. **Dominio raíz** de producción (ej. `facturaelectronica.app`). Define la
   resolución de tenant por subdominio.
4. **Documento de requisitos** — ruta a un archivo (o texto pegado) con el alcance
   del negocio de la app nueva.
5. **Branding** — ruta al Brand Guidelines (PDF/imagen) o descripción de la
   identidad visual (paleta, tipografía, personalidad).
6. **Carpeta destino** — por defecto, hermana de este repo
   (ej. `D:\Mis Documentos\DeployBox\<slug>`).

Antes de tocar nada, confirmar los 6 valores con el dueño del producto (usar
`AskUserQuestion` si algo es ambiguo). Ver el catálogo de tokens en
`BOOTSTRAP-TOKENS.md` de este repo.

## Pasos

### 1. Copiar el esqueleto a la carpeta destino
Copiar TODO el repo base a `<destino>` EXCLUYENDO artefactos de build/runtime:
`node_modules/`, `.git/`, `.next/`, `apps/*/.next`, `.claude/code-review-reports/*`,
`.claude/qa-reports/*`, `.claude/worktrees/*`, `.playwright-mcp/`, `test-results/`,
`playwright-report/`. (Usar `robocopy` en Windows o `cp -r` + limpieza, o
`git archive` si el base es un repo git.)

### 2. Reemplazar los tokens de marca
En TODO el árbol destino (respetando mayúsculas/minúsculas), reemplazar según
`BOOTSTRAP-TOKENS.md`:
- `Plataforma` → **Nombre visible**
- `plataforma` → **slug** (workspaces `factura-eletronica-web`/`factura-eletronica-landing` →
  `<slug>-web`/`<slug>-landing`, scripts `--workspace=`, `name` de cada `package.json`)
- `factura-eletronica.app` → **dominio raíz** (el reemplazo de `plataforma` ya cubre el
  prefijo; verificar que `factura-eletronica.app` quede como `<dominio>`)

Excluir de la búsqueda/reemplazo: `node_modules/`, `package-lock.json`,
`.claude/hooks/lib/shared.test.mjs` (contiene "plataforma" como dato de test),
y cualquier binario. Renombrar la carpeta `design-system/factura-eletronica/` →
`design-system/<slug>/`.

Verificación: `grep -rli "plataforma" --include="*.ts" --include="*.tsx"
--include="*.json"` (excluyendo lo de arriba) debe volver VACÍO. Si queda algún
token residual, resolverlo antes de seguir.

### 3. Generar el spec del negocio
A partir del documento de requisitos dado, escribir
`docs/Requerimientos_<slug>.md` siguiendo `docs/00-estandar-de-requisitos.md`
(una viñeta por requisito, presente, sin fechas/autoría en el cuerpo, sin rutas de
archivo). Registrar en `CLAUDE.md` la sección "Qué es este proyecto" con la
descripción real, y agregar en "Reglas de negocio DURAS" las reglas específicas del
negocio (además de las genéricas #1–#9 que ya trae la base).

### 4. Generar el design-system
Con el skill `ui-ux-pro-max`, a partir del branding dado, regenerar
`design-system/<slug>/MASTER.md` con la paleta, tipografía y personalidad reales.
Reemplazar los tokens de color placeholder de `apps/web/app/globals.css` y
`apps/landing/app/globals.css` por la paleta real (ver la nota de
`BOOTSTRAP-TOKENS.md`).

### 5. Generar el plan de tareas
Escribir un `docs/PLAN_MVP.md` inicial: descomponer el spec en tareas secuenciales
con estimados, marcando cuáles tocan reglas duras (→ gate completo). Dejar
`docs/PROGRESO.md` en su estado inicial.

### 6. Provisionar Supabase (runbook — NO se automatiza a ciegas)
Cada app nueva usa su PROPIO proyecto Supabase. Guiar al dueño del producto (o
ejecutar si hay credenciales) por:
1. Crear el proyecto Supabase nuevo (Dashboard o CLI).
2. `supabase link --project-ref <ref-nuevo>`.
3. `supabase db push` para aplicar las ~48 migraciones base.
4. **Correr el CHECKLIST DE APROVISIONAMIENTO** de `docs/CONFIG_SUPABASE_AUTH.md`
   (idempotente): `ALTER DATABASE ... SET search_path`, los `GRANT` +
   `ALTER DEFAULT PRIVILEGES` para `anon/authenticated/service_role`, y
   `NOTIFY pgrst, 'reload schema'`. Sin esto, un usuario real ve
   `permission denied for table` (parece RLS y NO lo es).
5. Configurar Google OAuth y el resto de auth (misma guía).
6. Setear los envs (`.env.local` en dev, dashboard de Vercel en prod) a partir de
   `apps/web/.env.example` + `apps/landing/.env.example` (URL/llaves de Supabase,
   `NEXT_PUBLIC_APP_ROOT_DOMAIN=<dominio>`, `RESEND_*`, `CRON_SECRET`).

### 7. Verificar que compila en verde
`npm install` en la raíz destino → `cd apps/web && npx tsc --noEmit` (verde) →
`npm run test:hooks` → `next build` (el gate real: tsc/vitest no ven límites RSC ni
el lint de producción). Un smoke de Playwright (login + aislamiento entre tenants +
acceso super-admin) contra el Supabase nuevo cierra la verificación.

### 8. Sembrar la memoria del proyecto
Copiar el `MEMORY.md` semilla (raíz de este repo) al directorio de memoria del
proyecto nuevo: `~/.claude/projects/<project-slug>/memory/MEMORY.md` (vive FUERA del
repo). Escribir la primera nota `## Usuario` con el dueño del producto.

### 9. Handoff al desarrollo
Invocar al `project-manager` para fijar la primera tarea del `PLAN_MVP.md`, y
arrancar la primera feature de negocio con el skill `bucle-agentico`.

## Qué NO trae la base (se construye por app)
El negocio concreto: los datos/tablas de dominio, las pantallas de negocio, la
lógica de cálculo/ingesta si aplica. La base solo aporta la plataforma
(multi-tenant, auth, super-admin, suscripción, email, importación de archivos) y el
proceso (agentes, QA, convenciones, aprendizajes).
