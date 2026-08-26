# Config de Supabase Auth + checklist de aprovisionamiento

Este documento tiene dos partes: (A) cómo cablear Supabase Auth (correo/
contraseña + Google OAuth) para un proyecto derivado de `factura-eletronica`, y
(B) un **checklist obligatorio** para cuando el set de migraciones de
`supabase/migrations/` se aplica por primera vez a un proyecto Supabase
**recién creado** (vía CLI/API, no vía el flujo normal del Dashboard) — dos
pasos que `supabase db push` NO hace por sí solo y que, si se omiten, se
manifiestan como errores confusos que parecen bugs de RLS pero no lo son.

## A. Cablear Supabase Auth (correo/contraseña + Google)

### A.0. Correo/contraseña: no requiere config extra

`supabase.auth.signInWithPassword` y `supabase.auth.signUp` funcionan out of
the box con la config por defecto de un proyecto Supabase nuevo (el provider
"Email" viene habilitado). Un solo trade-off de producto a decidir:

- **Authentication → Providers → Email → "Confirm email"**: si está
  **habilitado** (default), un usuario nuevo debe confirmar su correo antes
  de poder iniciar sesión con contraseña — el `signUp` de la app debe mandar
  `emailRedirectTo` apuntando a tu ruta de callback (ej. `/auth/callback`)
  para ese flujo. Si se **deshabilita**, el usuario puede loguearse
  inmediatamente tras registrarse. Solo afecta al proveedor correo/
  contraseña — un login con Google nunca pasa por acá (Google ya verificó el
  correo de su lado).
  - Si la ÚNICA vía de alta de un usuario nuevo es aceptar una invitación
    (`public.aceptar_invitacion()`/`public.datos_invitacion()`, ya incluidas
    en este set de migraciones) y el correo de invitación propio (vía tu
    proveedor de email transaccional) ya cumple la misma función de
    verificación, "Confirm email" puede deshabilitarse sin abrir un vector de
    abuso: pedir una segunda confirmación es redundante en un flujo cerrado
    de invitación. Si en cambio existe (o se planea) un signup público
    abierto sin invitación previa, mantener "Confirm email" habilitado.

### A.1. Google Cloud Console — credenciales OAuth

1. Ir a [Google Cloud Console](https://console.cloud.google.com/) → crear o
   reutilizar un proyecto para tu app.
2. **APIs & Services → OAuth consent screen**: configurar el consent screen
   (tipo "External" si los usuarios son externos a tu organización; nombre de
   la app, correo de soporte, dominio autorizado).
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID**:
   - Tipo de aplicación: **Web application**.
   - **Authorized redirect URIs**: agregar la URL de callback que Supabase
     muestra en su propio panel (paso A.2) — tiene la forma:
     ```
     https://<project-ref>.supabase.co/auth/v1/callback
     ```
   - Guardar el **Client ID** y el **Client Secret** generados: van en el
     paso A.2.

### A.2. Supabase Dashboard — habilitar el provider Google

1. Ir a **Authentication → Providers → Google** del proyecto.
2. Activar el toggle **Enable Sign in with Google**.
3. Pegar el **Client ID (for OAuth)** y el **Client Secret (for OAuth)** del
   paso A.1.
4. Confirmar que el **Callback URL (for OAuth)** que muestra este mismo panel
   coincide EXACTAMENTE con el que se registró en Google Cloud Console (paso
   A.1) — si no coincide, Google rechaza el login con `redirect_uri_mismatch`.
5. Guardar.

### A.3. Vinculación de identidades con el mismo correo

Regla de negocio común: si un correo entra por Google y por manual (correo/
contraseña), debe vincularse a la MISMA fila de `public.usuarios`, nunca
duplicarse (regla dura de este framework: correo único global — ver
`public.usuarios.email unique` en `20260713090200`).

**Comportamiento por defecto de Supabase Auth (GoTrue):** cuando un usuario
inicia sesión con un proveedor nuevo (ej. Google) usando un correo que YA
existe en el proyecto con OTRO proveedor (ej. contraseña), y **el correo está
verificado en ambos lados**, GoTrue vincula automáticamente la nueva
identidad a la cuenta existente — no requiere que la app llame a ninguna API
especial. Para que esto aplique en la práctica:

- El signup manual (correo/contraseña) debe tener el correo **confirmado**
  (ver A.0) antes de intentar entrar con Google con ese mismo correo, o
  viceversa.
- Google casi siempre entrega el correo ya verificado
  (`email_verified: true`), así que ese lado no suele ser el problema.

Verificar en vivo: crear un usuario con correo/contraseña, confirmar el
correo, después iniciar sesión con Google usando el MISMO correo → debe ser
LA MISMA fila en `public.usuarios` (mismo `id`), no una nueva. Si el
resultado es una cuenta DUPLICADA, hace falta un flujo de vinculación manual
explícito en la app (`supabase.auth.linkIdentity()`, iniciado por un usuario
ya logueado) — fuera del alcance de este set de migraciones.

### A.4. Site URL y Additional Redirect URLs

**Authentication → URL Configuration**:

- **Site URL**: la URL base de producción de la app. Supabase usa esto como
  fallback en templates de correo.
- **Additional Redirect URLs** — tienen que cubrir TODOS los orígenes desde
  los que la app llama a `exchangeCodeForSession` vía tu ruta de callback:

  **Desarrollo (ejemplo con subdominios por tenant):**
  ```
  http://localhost:3000/auth/callback
  http://*.localhost:3000/auth/callback
  ```

  **Producción:**
  ```
  https://tuapp.com/auth/callback
  https://*.tuapp.com/auth/callback
  ```

  Sin esto, Google/Supabase rechazan el redirect final con un error de
  "redirect URL not allowed" aunque el `redirectTo` que manda la app sea
  correcto.

### A.5. CAPTCHA / anti-abuso en formularios públicos sin sesión

Si tu app expone algún endpoint público sin sesión (ej. un registro público
de clientes finales, análogo al `/registro-cliente` del proyecto de origen),
Supabase soporta CAPTCHA nativo (hCaptcha o Cloudflare Turnstile) en
**Authentication → Settings → Bot and Abuse Protection**. Requiere decidir el
proveedor, cargar sus credenciales (site key + secret key) ahí, y agregar el
widget correspondiente del lado de la app. Si la única vía de alta de
usuarios internos es la invitación (patrón de este set de migraciones,
`aceptar_invitacion`), ese flujo no está expuesto a tráfico público anónimo y
no necesita CAPTCHA — el anti-abuso ahí ya lo cubre el propio secreto del
token de invitación (32 bytes aleatorios, no enumerable).

---

## B. Checklist de aprovisionamiento de un proyecto Supabase NUEVO

**Aplica cuando se crea un proyecto Supabase desde cero y se le aplican las
migraciones de este repo por CLI/API** (`supabase db push --linked`, o
`apply_migration`/`db query` del MCP) — a diferencia de un proyecto que ya
pasó por el flujo normal de "crear proyecto" del Dashboard y ya tiene un rato
de uso, un proyecto recién migrado así queda con **dos huecos invisibles**
que nada en las migraciones corrige (porque son configuración del proyecto,
no del esquema) y que **no fallan hasta que un usuario real lo usa**.

### B.1. `search_path` de la base (necesario para `pgcrypto`)

Las extensiones (`pgcrypto`, `pg_trgm`) quedan instaladas en el esquema
`extensions` (`20260713090800`), pero el `search_path` por defecto de una
base recién creada por API/CLI puede NO incluir ese esquema. Cualquier
función NO calificada que dependa de `pgcrypto` (ej. `gen_random_bytes(32)`,
usado por `invitaciones.token` en `20260713090200`) revienta con
`function gen_random_bytes(integer) does not exist` — mientras que
`gen_random_uuid()` (built-in de Postgres core desde la v13, no depende de la
extensión) funciona bien al lado. Ese contraste es la pista de que el
problema es `search_path`, no permisos ni RLS.

Fix (una sola vez, idempotente):

```sql
alter database postgres set search_path to public, extensions;
```

### B.2. GRANTs de `anon`/`authenticated`/`service_role` sobre `public`

Un proyecto creado por el Dashboard de Supabase configura automáticamente
GRANTs de `anon`/`authenticated`/`service_role` sobre las tablas de `public`
— un replay de migraciones vía API/CLI puro **no lo dispara**. Sin esto,
**RLS puede estar perfecta y aun así ningún usuario real puede leer nada**://
el síntoma es `permission denied for table <tabla>` (SQLSTATE `42501`), que a
simple vista se confunde con un rechazo de RLS (que en cambio devuelve 0
filas, nunca un error de permiso) — perder tiempo revisando políticas que
están bien es el síntoma de no haber hecho este paso.

Fix (una sola vez, idempotente):

```sql
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant all on all routines in schema public to anon, authenticated, service_role;

alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on routines to anon, authenticated, service_role;

notify pgrst, 'reload schema';
```

El `alter default privileges` es lo que hace que las tablas que CUALQUIER
migración futura cree hereden el grant automáticamente, igual que en un
proyecto creado por el Dashboard — sin esto, cada migración nueva repetiría
el mismo problema. El `notify pgrst, 'reload schema'` es necesario porque
PostgREST cachea el esquema: sin él, el fix en la BD no se refleja en la API
hasta que el connection pooler recicle solo.

### B.3. Orden recomendado y cómo verificar

1. Aplicar las migraciones (`supabase db push --linked` o equivalente).
2. Ejecutar B.1 y B.2 contra el proyecto nuevo (ambos son idempotentes — se
   pueden re-correr sin riesgo si ya se habían aplicado).
3. **Recién ahí** probar cualquier login/flujo real. Si un usuario real
   reporta "no pertenezco a ningún tenant" o cualquier "pantalla vacía sin
   datos" contra una base recién migrada así, sospechar de GRANT/search_path
   ANTES que de RLS.
4. Para descartar RLS vs. permisos al diagnosticar: simular la sesión con
   `set local role authenticated; select set_config('request.jwt.claims', ...)`
   sirve para probar la LÓGICA de RLS/funciones, pero **NUNCA para descartar
   un GRANT faltante** — esa simulación corre como el rol propietario de las
   tablas, que bypassa exactamente el problema que hay que detectar. Revisar
   los logs de error reales de tu hosting (ej. `vercel logs --level error` si
   el frontend está en Vercel) para ver el mensaje SQLSTATE exacto.
