# supabase/ — factura-eletronica

Esquema de base de datos del framework multi-tenant `factura-eletronica`
(Postgres + RLS sobre Supabase). Este set de migraciones crea ÚNICAMENTE el
esqueleto de plataforma — tenants, usuarios, membresías, invitaciones,
super-admins, catálogo de monedas y de planes, auditoría, funciones helper de
RLS, modo soporte y bloqueo de tenant — **sin ninguna tabla de negocio**. Un
proyecto derivado agrega su propio dominio (tablas de negocio, columnas de
config específicas, motor de cálculo, etc.) encima de esta base, en
migraciones nuevas.

Este set de migraciones se extrajo (2026-08-26) de un proyecto real
(factura-eletronica.app), removiendo toda tabla/columna/enum específica de ESE
dominio (paquetes, documentos, consolidados, subclientes, rutas/zonas,
catálogo de producto, palabras clave, modelos de entrega, facturación de
suscripción a couriers, motor de cálculo de peso/moneda, etc.) y conservando
solo el scaffolding multi-tenant genérico. Algunos comentarios SQL
conservan menciones históricas al proyecto de origen (nombres de reglas de
negocio, "Plataforma.app" en un puñado de `COMMENT ON`) — son residuo
cosmético de la extracción, sin efecto funcional; limpiarlos es opcional.

## Orden de las migraciones

Todas viven en `supabase/migrations/`, timestamped, y se aplican en orden de
nombre de archivo (esto lo garantiza el propio CLI de Supabase). Nunca editar
una migración ya aplicada a un entorno compartido: los cambios posteriores
van en una migración NUEVA.

### Núcleo (extensiones, tenants, usuarios, catálogos, auditoría)

1. `20260713090000_extensiones_y_funciones_base.sql` — extensiones
   (`pgcrypto`, `pg_trgm`), esquema `private`, y las funciones helper que usa
   TODO lo demás: `private.current_tenant_id()`, `private.is_super_admin()`
   (ambas `language plpgsql`, no `sql` — Postgres resuelve el cuerpo de una
   función `sql` contra el catálogo YA en el `CREATE FUNCTION`, así que no
   podrían referenciar tablas creadas en una migración posterior),
   `public.verificar_tenant_padre()` (guardia de integridad multi-tenant en
   FKs, acepta un 3er argumento opcional para tablas padre sin PK `id`),
   `public.bloquear_mutacion_append_only()` (bloquea UPDATE/DELETE en tablas
   append-only), `public.actualizar_actualizado_en()`.
2. `20260713090100_catalogos_globales.sql` — `monedas`, `planes`. Catálogos
   globales (sin `tenant_id`), de solo lectura para todos, de escritura solo
   para Super-Admin (policies separadas por insert/update/delete).
3. `20260713090200_tenants_y_usuarios.sql` — `usuarios` (con protección de
   `email` inmutable desde el cliente), `super_admins`, `tenants` (CHECK de
   subdominios reservados; SIN columnas de motor de cálculo/dominio —
   `id`/`nombre`/`subdominio`/`plan_id`/`estado`/`fecha_alta`/`logo_url`
   solamente), `usuarios_tenants` (membresía 1:1 ESTRICTA por PK simple en
   `usuario_id`), `invitaciones`, `tenant_contadores` +
   `public.siguiente_contador()`.
4. `20260713090700_seed_catalogo_monedas.sql` — seed de **solo** el catálogo
   global de monedas (USD, CRC de ejemplo). No hay seed de tenants ni datos
   de prueba.
5. `20260713090800_fix_advisors_seguridad.sql` — cierra 2 hallazgos del
   linter de seguridad de Supabase: revoke de EXECUTE de `anon` sobre
   `siguiente_contador()` (el `revoke ... from public` de Supabase NO
   alcanza a `anon`: hay default privileges que le dan EXECUTE directo a
   cada función nueva) y reubicación de `pg_trgm` al esquema `extensions`.
6. `20260713090900_comentarios_marca_plataforma.sql` — solo `COMMENT ON`
   (metadatos visibles en el Table Editor), sin cambio de esquema.
7. `20260713091000_auditoria.sql` — tabla `auditoria` (append-only) +
   trigger genérico `public.registrar_auditoria()`. En este set NO se
   attachea a ninguna tabla de negocio (no existen todavía) — sí se
   attachea, más adelante, a `tenants`/`usuarios_tenants`/`invitaciones`
   (`20260716060000`). Un proyecto derivado debe attachear el mismo trigger
   a cada tabla de negocio nueva (ver nota dentro del propio archivo).
8. `20260713091300_fix_advisor_registrar_auditoria.sql` — revoke de EXECUTE
   de `anon`/`authenticated` sobre `registrar_auditoria()` (retorna
   `trigger`, no es invocable directo, pero se cierra el advisor igual).
9. `20260713091500_forzar_actor_auditoria.sql` — trigger que fuerza
   `actor_id`/`actor_tipo` desde `auth.uid()` en todo INSERT manual a
   `auditoria` (nunca confiar en el payload del cliente para una columna de
   identidad).
10. `20260714052000_auditoria_excluir_generated_del_diff.sql` — el diff de
    `registrar_auditoria()` excluye dinámicamente (vía catálogo de sistema,
    `pg_attribute.attgenerated`) toda columna GENERATED de la tabla auditada,
    nunca por lista hardcodeada de nombres.

### Roles, invitaciones, sincronización con `auth.users` y modo soporte

11. `20260714201000_rol_activo_y_rls_admin.sql` — `private.current_rol()`/
    `private.is_admin()`; endurece RLS de `usuarios_tenants`/`invitaciones`/
    `tenants` a solo-Admin; guardia "no dejar el tenant sin Admin activo".
12. `20260714202000_aceptar_invitacion.sql` — `public.aceptar_invitacion()`.
13. `20260714203000_sync_auth_users_usuarios.sql` — triggers `auth.users` →
    `public.usuarios` (alta + sincronización de email).
14. `20260714210000_aceptar_invitacion_fix_vencimiento.sql` — fix (un UPDATE
    antes de un RAISE EXCEPTION no sobrevive: la excepción revierte toda la
    transacción).
15. `20260714211000_documentar_owner_security_definer.sql` — solo comentarios.
16. `20260714212000_revoke_execute_triggers_sync_auth.sql` — revokes de
    advisors.
17. `20260714213000_invitaciones_select_solo_admin.sql` — el SELECT de
    `invitaciones` también pasa a exigir Admin (el `token` es la credencial
    de facto del enlace).
18. `20260714220000_super_admin_tenant_activo.sql` — tabla
    `super_admin_tenant_activo` (selección de "modo soporte").
19. `20260714221000_current_tenant_id_is_admin_soporte.sql` — extiende
    `current_tenant_id()`/`is_admin()` para resolver el modo soporte.
20. `20260714222000_auditoria_actor_soporte.sql` — columna
    `auditoria.actor_soporte` (marca inequívoca de acciones en modo soporte).
21. `20260714223000_is_admin_boolean_estricto.sql` — `is_admin()` nunca
    devuelve NULL (`coalesce(..., false)`).
22. `20260714230000_datos_invitacion.sql` — `public.datos_invitacion()`
    (lectura pública, SECURITY DEFINER, para la página de invitación sin
    sesión).
23. `20260716060000_auditoria_tenants_usuarios_tenants_invitaciones.sql` —
    attachea `registrar_auditoria()` (extendida con argumentos opcionales de
    columna) a `tenants`/`usuarios_tenants`/`invitaciones`.
24. `20260716070000_seed_catalogo_planes.sql` — seed placeholder de planes.
25. `20260716080000_logos_couriers_storage.sql` — bucket de Storage
    BUCKET-ONLY (sin políticas de `storage.objects`: en Supabase hosted esa
    tabla es propiedad de `supabase_storage_admin`, `CREATE POLICY` ahí falla
    con `must be owner of relation objects` — la única vía de escritura es
    server-side con `service_role`).
26. `20260716090000_verificar_tenant_padre_excepcion_super_admin.sql` —
    excepción en `verificar_tenant_padre()` para columnas de ACTOR/identidad
    (ej. `invitado_por`) cuando el valor referenciado es un Super-Admin.

### Contadores, moneda, aislamiento por bloqueo de tenant, suscripción de plataforma

27. `20260717060000_correo_pertenece_a_otro_tenant.sql` — chequeo "un usuario
    = un tenant" para bloquear invitaciones cruzadas.
28. `20260717090000_fix_monedas_crc_decimales.sql` — re-siembra el catálogo
    de monedas a sus valores canónicos (ejemplo de corrección de drift de
    datos en un catálogo global sin auditoría).
29. `20260717220000_siguiente_contador_service_role.sql` — el guard de
    `siguiente_contador()` contempla el caller `service_role` (detectado vía
    `auth.role()`, GUC de sesión — NUNCA `current_user`/`session_user` dentro
    de una función SECURITY DEFINER, que ven al DUEÑO de la función).
30. `20260718000000_sincronizar_contador.sql` — `public.sincronizar_contador()`
    (bump de un contador a un mínimo, GREATEST, nunca lo baja).
31. `20260804100000_eliminar_tenant_efimero_e2e.sql` — infra de E2E: borrado
    duro de un tenant efímero (prefijo `e2e-ef-` obligatorio) y todo su árbol,
    recorriendo DINÁMICAMENTE (via `information_schema.columns`) cualquier
    tabla con `tenant_id` — no hace falta tocarla al agregar tablas de
    negocio nuevas.
32. `20260813130000_configuracion_plataforma.sql` — tabla SINGLETON
    (`id boolean primary key check(id)`) de configuración global de la
    plataforma; nace vacía de columnas de dominio (el proyecto original tenía
    una columna de negocio removida en esta extracción) — un proyecto
    derivado agrega sus propios parámetros globales como columnas nuevas.
33. `20260815090000_planes_precio_y_tenants_override_suscripcion.sql` —
    `planes.precio_mensual_usd` + `tenants.precio_suscripcion_usd` (override
    por tenant) + guard column-level (`proteger_precio_suscripcion_tenant`)
    que impide que un Admin de tenant se auto-asigne el precio vía PATCH
    directo a PostgREST.
34. `20260815092000_configuracion_plataforma_dias_bloqueo.sql` —
    `configuracion_plataforma.dias_atraso_sugerir_bloqueo` (umbral global,
    puramente informativo — el bloqueo real de un tenant siempre es una
    decisión MANUAL del super-admin).
35. `20260815097000_fix_guard_precio_suscripcion_service_role.sql` — fix de
    una regresión real: un `AND` con subconsulta NO garantiza short-circuit
    en Postgres, así que `is_super_admin()` se evaluaba SIEMPRE, incluso
    para `service_role` (sin acceso al esquema `private`) — se reestructura
    con IFs anidados (control de flujo real de PL/pgSQL, sí evalúa en orden).
36. `20260815100000_current_tenant_id_excluye_tenant_bloqueado.sql` —
    `current_tenant_id()` exige también `tenants.estado = 'activo'` en la
    rama de miembro: un usuario de un tenant bloqueado deja de ver CUALQUIER
    dato de negocio vía RLS, sin tocar ninguna policy individual.
37. `20260815110000_tenant_bloqueado_propio.sql` — `public.tenant_bloqueado_propio()`,
    vía de DETECCIÓN (no de autorización) del bloqueo del propio tenant —
    necesaria porque la migración anterior introduce una circularidad: un
    miembro de un tenant bloqueado ya no puede leer, vía RLS normal, ni su
    propia membresía ni su propio tenant para darse cuenta de que está
    bloqueado.
38. `20260815120000_guard_columnas_sensibles_tenant.sql` — guard column-level
    genérico (`proteger_columnas_sensibles_tenant`) que protege `estado`,
    `plan_id` y `precio_suscripcion_usd` de `tenants` — cierra el gap de que
    la RLS de fila (no de columna) dejaría a un Admin de tenant
    auto-desbloquearse o auto-cambiarse de plan.
39. `20260816092000_planes_actualizado_en.sql` — `planes.actualizado_en`
    (bookkeeping estándar).
40. `20260816093000_planes_rpcs_crud.sql` — RPCs de super-admin
    `crear_plan`/`editar_plan`/`pausar_plan` (mensajes de negocio explícitos
    en vez de que la capa app dependa de leer un código de error de RLS).
41. `20260818060000_tenants_subdominio_reservados_ampliado.sql` — amplía la
    lista de subdominios reservados (defensa en profundidad a nivel BD; la
    lista autoritativa vive en la app). `NOT VALID` porque un tenant
    preexistente en un ambiente real podía colisionar con la lista nueva —
    ejemplo de cómo agregar un CHECK sin romper tenants ya creados.

## Cómo aplicarlas

```bash
supabase init                          # crea config.toml (una sola vez, si no existe)
supabase link --project-ref <ref-del-proyecto>
supabase db push                       # aplica las migraciones pendientes al proyecto remoto
```

Para desarrollo local con Docker (recomendado antes de aplicar a remoto):

```bash
supabase start           # levanta Postgres local + Auth + Storage
supabase db reset        # corre TODAS las migraciones desde cero en local
```

**Con el MCP de Supabase** (modo solo lectura): usarlo para *verificar* el
estado real después de aplicar (tablas, columnas, políticas, índices) — nunca
para aplicar el cambio de esquema en sí. Los cambios de esquema van siempre
por estos archivos de migración.

**Proyecto Supabase NUEVO (recién creado):** ver el checklist de
aprovisionamiento en `docs/CONFIG_SUPABASE_AUTH.md` — hay dos pasos que
`supabase db push` NO hace por sí solo (`search_path` de la base y GRANTs de
`anon`/`authenticated`/`service_role` sobre `public`) y que, si se omiten,
producen errores confusos (`function ... does not exist` /
`permission denied for table`) que parecen bugs de RLS pero no lo son.

## Contrato del claim de tenant para la app

**No hay ningún claim JWT custom que la app deba setear.** El tenant del
usuario autenticado se resuelve puramente en la base de datos, a partir de
`auth.uid()` (el `sub` verificado del JWT de Supabase Auth) contra la
membresía real en `usuarios_tenants` — ver `private.current_tenant_id()` en
`20260713090000_extensiones_y_funciones_base.sql`. Esto es intencional:

- Un usuario pertenece a un solo tenant (regla dura de este framework), así
  que no hace falta que el cliente "elija" ni declare a qué tenant
  pertenece — la RLS resuelve el único tenant posible con una consulta
  indexada.
- Evita el problema clásico de claims JWT desincronizados: si un Admin cambia
  el rol de alguien o lo desactiva, un claim horneado en el JWT seguiría
  vigente hasta que el token expire/refresque. Consultar la membresía en cada
  request (vía una función `stable security definer`, barata e indexada por
  PK) siempre refleja el estado real.

**El subdominio (`acme.tuapp.com`) es una señal de la capa de aplicación, no
de la base de datos.** La app debe:

1. Resolver qué tenant corresponde al subdominio visitado (server-side).
2. Verificar que el tenant del usuario autenticado (`private.current_tenant_id()`,
   o el resultado equivalente que exponga el backend) coincide con ese
   tenant, y negar la vista si no coincide (evita que un usuario de A vea la
   URL del tenant B, aunque RLS ya le impediría ver sus datos).
3. **Nunca** enviar un `tenant_id` explícito desde el cliente esperando que
   el servidor/DB "confíe" en él para decidir qué filas devolver. RLS ignora
   por completo cualquier `tenant_id` que no sea el de la membresía real del
   usuario autenticado — si el cliente lo envía, es solo para pre-rellenar
   filtros de UI, nunca como control de acceso.

Para flujos SIN sesión (registro público, páginas públicas): no hay
`auth.uid()`, por lo tanto `private.current_tenant_id()` devuelve `NULL` y
ninguna política de tenant matchea. Estos flujos NO deben resolverse con
políticas RLS permisivas para `anon` sobre las tablas de negocio (abriría un
vector de escritura/lectura cruzada entre tenants). El patrón recomendado es
una función RPC `security definer` con su propia validación explícita (nunca
un INSERT/SELECT directo vía PostgREST para `anon`) — ver
`public.aceptar_invitacion()`/`public.datos_invitacion()` como ejemplos ya
implementados de este patrón.

## Guardias de integridad multi-tenant (más allá de RLS)

Cada tabla de datos de negocio debe tener su propia columna `tenant_id`
(regla dura de este framework, incluso cuando es derivable vía una FK a otra
tabla). Para FKs "opcionales" que podrían apuntar a una fila de otro tenant
(ej. una tabla de negocio con una FK a otra tabla de negocio de otro tenant,
si alguien adivinara/filtrara ese UUID), cada tabla hija debe llevar un
trigger
`before insert or update ... execute function public.verificar_tenant_padre('<columna_fk>', '<tabla_padre>')`
que rechaza la fila si el tenant de la fila padre no coincide con el de la
fila hija. Esto es defensa en profundidad: RLS por sí sola garantiza que un
usuario solo puede ESCRIBIR filas con su propio `tenant_id`, pero no evita
que esa fila referencie (por FK) una fila ajena — ver el comentario extenso
en `verificar_tenant_padre()`. Cuando la tabla padre no tiene una PK literal
`id` (ej. `usuarios_tenants`, cuya PK es `usuario_id`), se pasa un 3er
argumento con el nombre real de esa columna (ver `invitaciones.invitado_por`
en `20260713090200`).

## Auditoría

`public.registrar_auditoria()` (trigger genérico) solo colecta en **UPDATE**
(INSERT y DELETE no generan fila — la creación ya queda trazada por
`creado_en`/`creado_por` de cada tabla). El diff excluye dinámicamente
`actualizado_en` y toda columna GENERATED (vía `pg_attribute.attgenerated`
sobre `TG_RELID`, nunca una lista hardcodeada de nombres). Admite 2
argumentos opcionales de trigger (columna-tenant, columna-registro) para
tablas cuya PK/columna de tenant no se llaman literalmente `id`/`tenant_id`
(ver el attach a `tenants`/`usuarios_tenants` en `20260716060000`). Cualquier
tabla de negocio nueva de un proyecto derivado debe sumar, como último paso
de su propia migración:

```sql
create trigger trg_<tabla>_auditoria after update on public.<tabla>
  for each row execute function public.registrar_auditoria();
```

## Deliberadamente fuera de este set (alcance de un proyecto derivado)

- **Tablas de negocio** (lo que sea que tu producto modele: paquetes,
  pedidos, reservas, etc.) y sus RLS/triggers de auditoría/integridad.
- **Motor de cálculo / moneda por tenant**: este set no asume ningún modelo
  de cálculo ni moneda local — si tu producto lo necesita, se agrega en
  `tenants` (o en una tabla propia) en una migración nueva, siguiendo el
  mismo patrón de catálogo de monedas (`monedas`) ya presente acá.
- **Facturación de suscripción de la plataforma a sus tenants** (generación
  de facturas de suscripción, comprobantes, cron de generación diaria,
  correos): este set solo trae el precio/override (`precio_suscripcion_usd`)
  y el umbral informativo de atraso — el resto es una feature aparte, fuera
  de este set base.
- **Catálogo geográfico / de producto / cualquier catálogo de dominio**: se
  agrega siguiendo el mismo patrón que `monedas`/`planes` (tabla global sin
  `tenant_id`, RLS de lectura pública + escritura solo super-admin).
