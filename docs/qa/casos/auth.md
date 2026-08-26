# Casos de prueba — Autenticación / sesión (AUTH)

> Catálogo de casos del módulo `AUTH` (login, registro público, invitaciones, sesión, expulsión por bloqueo de tenant). Prefijo de IDs: `AUTH` (ver tabla en `docs/qa/PLAN-QA.md` §4). Los IDs son ESTABLES: nunca se renumeran ni se reusan; un caso obsoleto se marca `RETIRADO` con motivo. Lo mantiene `qa-analista`; los resultados de ejecución los actualizan `qa-explorador`/`qa-automatizador` al correr cada caso.
>
> Este catálogo nace como semilla GENÉRICA de un SaaS multi-tenant: los casos de auth/sesión/bloqueo de tenant son transversales a cualquier producto de este tipo. Ajustar los nombres concretos de rutas, funciones RPC, migraciones y tablas a los del proyecto real cuando existan; la LÓGICA de cada caso (qué se prueba y por qué es S0) se conserva.

**Convenciones del bloque de caso:**
- **Prioridad**: P0 (regla dura / flujo de negocio principal — corre en toda campaña del módulo) · P1 (funcionalidad principal) · P2 (secundario/borde).
- **Tipo**: funcional · permisos · datos-límite · responsive · a11y · concurrencia · persistencia-form · multi-tenant.
- **Automatización**: `manual` · `unit:<ruta>` · `e2e:<ruta>` · `parcial:<ruta>` (el spec cubre parte del caso — anotar qué falta).
- **Última ejecución**: `AAAA-MM-DD · <resultado de la taxonomía PLAN-QA §12> · <campaña>`.

**Familia AUTH — Bloqueo de un tenant por el Super-Admin y expulsión de sus usuarios (arranque de esta familia).**
Origen: requisito de multi-tenant + bloqueo manual del super-admin (ver el spec de requisitos en `docs/` y las reglas duras multi-tenant de `CLAUDE.md`). Enforcement esperado en DOS capas: (a) UI/sesión — el layout de la app detecta el tenant bloqueado y cierra la sesión redirigiendo a `/login` con un aviso; (b) servidor/BD — la función que resuelve el tenant del request devuelve NULL para un miembro de un tenant bloqueado → deny-by-default en las políticas RLS, más una función `SECURITY DEFINER` de SOLO detección booleana y un backstop de permisos en la capa de aplicación. Toda fuga de lectura o escritura exitosa de un tenant bloqueado es **S0** (viola la regla dura de aislamiento multi-tenant).

---

### AUTH-001 — Miembro Admin ya logueado es expulsado al bloquear su tenant, y recupera acceso al desbloquear (ruta feliz UI)
- **Prioridad**: P0 · **Tipo**: multi-tenant · **Regla dura**: aislamiento multi-tenant / bloqueo manual
- **Requisito**: spec de bloqueo/desbloqueo de tenant · decisión del dueño del producto
- **Precondiciones**: tenant efímero (fábrica de tenants de prueba) con su Admin + super-admin efímero, ambos borrados en `finally`. DOS contextos de navegador (miembro + super-admin no comparten sesión).
- **Pasos**:
  1. El Admin del tenant inicia sesión y confirma acceso a `/dashboard`.
  2. En contexto aparte, el super-admin entra a la consola de soporte del tenant y lo bloquea (confirmación real del diálogo).
  3. Verificar en BD que el estado del tenant quedó en `bloqueado`.
  4. El Admin (sesión aún abierta) navega a `/dashboard`.
  5. El super-admin desbloquea; el Admin vuelve a iniciar sesión.
- **Esperado**: tras el bloqueo, el Admin cae en `/login` con el aviso de tenant bloqueado; una segunda navegación a ruta protegida vuelve a `/login` (sesión REALMENTE cerrada, no solo un aviso). Tras el desbloqueo, el estado del tenant vuelve a `activo` y el Admin recupera `/dashboard`. El super-admin nunca se ve afectado.
- **Automatización**: manual (candidato a `e2e:` cuando exista el spec de bloqueo/expulsión)
- **Última ejecución**: — · — · —

### AUTH-002 — LECTURA server-side de una tabla de negocio con sesión viva de tenant bloqueado devuelve 0 filas (R1)
- **Prioridad**: P0 · **Tipo**: multi-tenant · **Regla dura**: aislamiento multi-tenant
- **Requisito**: spec ("no lee … datos del tenant bloqueado") · función de resolución de tenant + RLS
- **Precondiciones**: tenant efímero con al menos 1 fila sembrada en una tabla de negocio DISTINTA de las que ya toca AUTH-001. Sesión del Admin del tenant capturada (token/cliente con el JWT del miembro), ANTES del bloqueo. Super-admin efímero para bloquear.
- **Pasos**:
  1. Con la sesión del miembro, `select` de la tabla de negocio → confirmar que devuelve las filas sembradas (línea base: acceso normal).
  2. El super-admin bloquea el tenant (estado `bloqueado`).
  3. Con LA MISMA sesión del miembro (sin re-login), repetir el `select` sobre la misma tabla.
- **Esperado**: tras el bloqueo, la lectura devuelve **0 filas** (RLS deny-by-default vía la función de resolución de tenant devolviendo NULL), nunca datos. No debe devolver `permission denied` crudo por GRANT (eso sería otra clase de fallo) — el contrato de esta feature es "0 filas". Cualquier fila devuelta de un tenant bloqueado = **S0, RED inmediato**.
- **Automatización**: manual (candidato a `e2e:` de RLS lectura/escritura)
- **Última ejecución**: — · — · —

### AUTH-003 — ESCRITURA server-side (server action de mutación) con sesión viva de tenant bloqueado FALLA (R2)
- **Prioridad**: P0 · **Tipo**: multi-tenant · **Regla dura**: aislamiento multi-tenant / motor de cálculo
- **Requisito**: spec ("no … escribe datos del tenant bloqueado") · backstop de permisos en la app + RLS
- **Precondiciones**: tenant efímero + su Admin (sesión viva) + super-admin efímero. Elegir UNA server action de mutación gateada por el chequeo de permisos sobre datos de negocio del tenant (candidatas: alta de cliente / editar un registro / editar configuración del tenant).
- **Pasos**:
  1. Confirmar que la mutación funciona con el tenant activo (línea base).
  2. El super-admin bloquea el tenant.
  3. Con la sesión aún viva del miembro (una pestaña/cliente que no re-renderizó el layout todavía), invocar la server action de mutación.
- **Esperado**: la mutación es RECHAZADA en DOS niveles verificables — (a) el chequeo de permisos de la capa app devuelve el error de tenant bloqueado; (b) aun si se saltara la capa app, la RLS niega el INSERT/UPDATE (0 filas afectadas / error). NADA se persiste en la tabla de negocio del tenant bloqueado. Cualquier escritura exitosa = **S0, RED inmediato**.
- **Automatización**: manual (candidato a `e2e:` de RLS lectura/escritura + capa app)
- **Última ejecución**: — · — · —

### AUTH-004 — Operador y Contador también quedan expulsados, no solo Admin (R5)
- **Prioridad**: P0 · **Tipo**: permisos / multi-tenant · **Regla dura**: aislamiento multi-tenant / bloqueo manual
- **Requisito**: spec ("sus usuarios") — la expulsión es por membresía activa, no por rol
- **Precondiciones**: tenant efímero con TRES miembros activos (Admin + Operador + Contador — sembrar la tabla de membresías con cada rol) + super-admin efímero.
- **Pasos**:
  1. Cada rol inicia sesión y confirma acceso.
  2. El super-admin bloquea el tenant.
  3. Cada rol (sesión viva) navega a una ruta protegida.
- **Esperado**: los TRES caen en `/login` con el aviso de tenant bloqueado; ninguno conserva acceso a datos ni a acciones. La expulsión no depende del rol (la función de detección de bloqueo solo mira que la membresía esté activa, no el rol). Un rol que conserve acceso = **S0**.
- **Automatización**: manual (explorador con navegador real; candidato a spec E2E si el automatizador puede sembrar los 3 roles)
- **Última ejecución**: — · — · —

### AUTH-005 — Desbloqueo restablece acceso COMPLETO: lectura Y escritura (R7)
- **Prioridad**: P0 · **Tipo**: multi-tenant · **Regla dura**: aislamiento multi-tenant / bloqueo manual
- **Requisito**: spec ("El desbloqueo restablece el acceso")
- **Precondiciones**: tenant efímero bloqueado (reusar el escenario de AUTH-002/003) + super-admin efímero.
- **Pasos**:
  1. Partir de un tenant bloqueado con su miembro sin acceso (lectura 0 filas + mutación rechazada).
  2. El super-admin desbloquea (estado `activo`).
  3. El miembro re-inicia sesión (o refresca) y repite una lectura y una escritura de datos de negocio.
- **Esperado**: la lectura vuelve a traer las filas del tenant y la escritura vuelve a persistir. El acceso restaurado es total, no parcial (no queda ninguna tabla con RLS "pegada" en negado). Verifica que el bloqueo es 100% reversible por estado, sin daño residual.
- **Automatización**: manual (candidato a `e2e:` de RLS lectura/escritura tras desbloqueo)
- **Última ejecución**: — · — · —

### AUTH-006 — Super-Admin en modo soporte sigue resolviendo el tenant bloqueado (para poder desbloquearlo) (R4)
- **Prioridad**: P0 · **Tipo**: permisos / multi-tenant · **Regla dura**: aislamiento multi-tenant / bloqueo manual
- **Requisito**: la rama de soporte de la resolución de tenant se evalúa PRIMERO, SIN filtrar por el estado del tenant
- **Precondiciones**: tenant efímero bloqueado + super-admin efímero con selección activa de soporte sobre ESE tenant.
- **Pasos**:
  1. El super-admin selecciona el tenant bloqueado en modo soporte.
  2. Navega al app-shell del tenant y a la consola de soporte del tenant.
  3. Ejecuta el desbloqueo.
- **Esperado**: el super-admin NO es expulsado (la detección de bloqueo es SIEMPRE `false` para él: no tiene membresía real activa) y la resolución de tenant sigue devolviendo el tenant bloqueado — puede leer/operar y desbloquear. Si el super-admin quedara bloqueado, el tenant sería IRRECUPERABLE = **S0** (bloquea el flujo sin salida).
- **Automatización**: manual (candidato a `e2e:` — super-admin en modo soporte dentro del tenant bloqueado)
- **Última ejecución**: — · — · —

### AUTH-007 — Multi-pestaña: segunda pestaña ya abierta no tiene ventana de lectura válida entre bloqueo y siguiente interacción (R6)
- **Prioridad**: P1 · **Tipo**: multi-tenant / concurrencia · **Regla dura**: aislamiento multi-tenant
- **Requisito**: spec ("en la siguiente navegación") — coordinar con el tour de interrupciones/concurrencia del explorador (no duplicar la lista ahí)
- **Precondiciones**: tenant efímero + su Admin con DOS pestañas abiertas sobre rutas protegidas ANTES del bloqueo + super-admin efímero.
- **Pasos**:
  1. Abrir dos pestañas del miembro en `/dashboard` y otra ruta protegida (ambas cargadas y quietas).
  2. El super-admin bloquea el tenant.
  3. En la segunda pestaña (nunca recargada), disparar CUALQUIER interacción que golpee el servidor: navegación de RSC, submit de un form, refetch.
- **Esperado**: la primera interacción server-side de la pestaña vieja ya no lee ni escribe datos del tenant (RLS niega en ese request; la navegación cae en la expulsión). No hay ninguna "ventana" en la que la pestaña vieja siga leyendo datos frescos del tenant bloqueado. Contenido ya PINTADO antes del bloqueo puede seguir visible (es HTML estático), pero ningún fetch NUEVO trae datos.
- **Nota de diseño (aprendizaje transversal)**: vigilar que la expulsión dispare también en navegación client-side/soft, no solo en navegación DURA (recarga) — el Router Cache de una navegación soft puede no re-ejecutar el layout de detección en el servidor. Si la expulsión solo ocurre en navegación dura, es un S1 de consistencia de sesión (con workaround), no una fuga de datos, siempre que ningún fetch nuevo traiga datos reales.
- **Automatización**: manual (explorador — navegador real, dos pestañas)
- **Última ejecución**: — · — · —

### AUTH-008 — El aviso de tenant bloqueado no es falso positivo en tenants activos ni queda pegado tras el desbloqueo (R8)
- **Prioridad**: P1 · **Tipo**: funcional · **Regla dura**: bloqueo manual
- **Requisito**: spec de bloqueo/desbloqueo · el aviso solo se muestra cuando `/login` recibe el motivo de expulsión
- **Precondiciones**: (a) un tenant efímero ACTIVO normal; (b) el escenario de bloqueo→desbloqueo de AUTH-001.
- **Pasos**:
  1. Login normal en un tenant activo; recorrer `/login` (logout normal) sin el parámetro de motivo.
  2. En el escenario de bloqueo: tras la expulsión, confirmar que el aviso aparece UNA vez.
  3. Tras el desbloqueo y re-login exitoso, volver a `/login` (logout normal) y confirmar que el aviso YA NO aparece.
- **Esperado**: el aviso solo se muestra cuando `/login` recibe el motivo de expulsión (expulsión real); un logout normal o un tenant activo NUNCA lo muestran (falso positivo = S2). Tras desbloquear + re-login, el aviso no queda "pegado" en navegaciones posteriores (el motivo se consume, no persiste). Verificar a 375px que el aviso no rompe el layout de login.
- **Automatización**: manual (explorador — verificación visual del aviso, incluye responsive 375px)
- **Última ejecución**: — · — · —

### AUTH-009 — Ningún RPC SECURITY DEFINER de `public` es una vía de fuga de datos del tenant bloqueado (R3)
- **Prioridad**: P0 · **Tipo**: multi-tenant · **Regla dura**: aislamiento multi-tenant
- **Requisito**: la función de detección de bloqueo es SECURITY DEFINER a propósito — verificar que NO devuelve datos, solo booleano
- **Precondiciones**: inventario de funciones `public.*` SECURITY DEFINER invocables por PostgREST (RPC). Confirmar el inventario contra la BD de dev (no confiar solo en el grep de migraciones).
- **Pasos**:
  1. Enumerar en la BD de dev las funciones de `public` con `security definer` y `EXECUTE` para `authenticated` que sean invocables como RPC (excluir `returns trigger`).
  2. Con la sesión de un miembro de tenant bloqueado, invocar la función de detección de bloqueo → confirmar que devuelve SOLO un booleano, nunca una fila de datos.
  3. Para cualquier otro RPC SECURITY DEFINER de `public` hallado, verificar que no permite leer/mutar datos de negocio de un tenant sin acotar por el tenant del `auth.uid()`.
- **Esperado**: la función de detección de bloqueo es un booleano puro, no una vía de fuga. Cualquier RPC de unión/aceptación de invitación exige un token y no expone datos de otro tenant. Ningún RPC SECURITY DEFINER de `public` devuelve/muta datos de negocio de un tenant bloqueado. Un RPC mal acotado que sí lo haga = **S0, RED inmediato**. Seguimiento no bloqueante: pasada genérica futura para detectar funciones creadas FUERA de migración versionada (drift de esquema).
- **Automatización**: manual (contrato de la función automatizable con `e2e:`; el barrido del inventario de RPCs es revisión en vivo contra `pg_proc`, no aserción de suite)
- **Última ejecución**: — · — · —

### AUTH-010 — Contrato de la función de detección de bloqueo: detecta el bloqueo aunque RLS niegue leer la propia membresía; false en tenant activo y para super-admin
- **Prioridad**: P1 · **Tipo**: multi-tenant · **Regla dura**: aislamiento multi-tenant
- **Requisito**: la función SECURITY DEFINER esquiva la circularidad de RLS por diseño
- **Precondiciones**: (a) miembro activo de tenant bloqueado; (b) miembro activo de tenant activo; (c) super-admin sin membresía real; (d) anon.
- **Pasos**:
  1. Con la sesión del miembro de tenant BLOQUEADO, invocar la RPC — y en paralelo confirmar que un `select` directo a las tablas de membresía/tenant con esa misma sesión devuelve 0 filas (RLS le niega su propia fila porque la resolución de tenant da NULL).
  2. Con la sesión del miembro de tenant ACTIVO, invocar la RPC.
  3. Con la sesión de un super-admin sin membresía real, invocar la RPC.
  4. Con `anon`, intentar invocar la RPC.
- **Esperado**: (1) devuelve `true` AUNQUE el select directo dé 0 filas (SECURITY DEFINER esquiva la circularidad — este es el punto exacto de la función); (2) `false`; (3) `false` (sin membresía real activa); (4) `permission denied` (42501 — `EXECUTE` revocado a `anon`). Si (1) diera `false`, la detección de UX falla (el miembro no sería expulsado por la capa app, aunque RLS igual le niega los datos → severidad menor, S1/S2 según impacto observado).
- **Automatización**: manual (candidato a `e2e:` del contrato de la RPC)
- **Última ejecución**: — · — · —
