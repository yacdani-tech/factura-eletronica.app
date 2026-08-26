# Recomendación — infraestructura E2E (Playwright)

**Estado:** IMPLEMENTADA (infra E2E mínima — ver `apps/web/playwright.config.ts`,
`apps/web/e2e/` y sus fixtures de tenants efímeros). Este documento queda como
registro de las decisiones de diseño; el estado real de la infra vive en el
código y en `docs/PROGRESO.md`.

## Principio de partida

La cobertura E2E arranca acotada explícitamente a lo automatizable sin
autenticación de terceros (flujos de tenant con correo/contraseña) y difiere
la cobertura "a fondo" de los flujos críticos y la resolución de auth por
proveedor externo (Google-only, u otros) a una fase de QA dedicada.

Razón: cada pantalla nueva sin verificación automatizada obliga a repetir la
exploración manual desde cero en cada sesión, y una regresión de navegación
real (bugs de "Confirm email" o de persistencia de forms, típicos de las
primeras semanas) no tiene ninguna red que la atrape sola. Pagar el costo de
setup (mayormente fijo, una sola vez) temprano es más barato que acumular
pantallas sin cobertura.

## (a) Autenticación de test — cómo resolverla

**Para flujos de tenant (Admin/Operador/Contador): usuario de test real con
contraseña, sembrado en el proyecto Supabase de desarrollo.** No hace falta
ningún bypass de auth ni mock — el login por correo/contraseña ya es 100%
real y automatizable con `page.fill`/`page.click` normales. Sembrar (a mano,
una vez, o vía un script de seed idempotente) un tenant de prueba dedicado +
un usuario Admin de ese tenant con contraseña conocida, en el MISMO proyecto
Supabase remoto de desarrollo (no hace falta un proyecto nuevo ni Docker
local). Guardar esas credenciales como secret de CI
(`E2E_TEST_TENANT_EMAIL`/`E2E_TEST_TENANT_PASSWORD`), nunca hardcodeadas en
el repo.

**Para el flujo Super-Admin con proveedor externo (ej. Google-only): NO
intentar automatizar el login del proveedor.** Alternativas en orden de
preferencia:
1. Habilitar **también** correo/contraseña para una cuenta Super-Admin
   dedicada a testing (sin tocar la cuenta real del dueño del producto) — la
   BD ya soporta ambos métodos indistintamente, así que es solo crear una
   segunda fila en `super_admins` para un usuario de prueba con contraseña.
   Es la opción más barata y no introduce ningún camino "solo para test" en
   el código de producto.
2. Si Super-Admin debe seguir siendo estrictamente externo incluso para test,
   inyectar una sesión de Supabase válida directamente (patrón
   "storageState" de Playwright, refrescado periódicamente) en vez de
   automatizar el flujo OAuth interactivo — más frágil, solo si la opción 1
   no es aceptable.
- Bypass de auth "solo en entorno de test" (env var que salte el guard de
  sesión) se descarta: abriría una superficie de riesgo real si esa env var
  terminara mal configurada en producción/preview.

## (b) Dónde viven los specs y cómo encajan en CI

- **Ubicación:** `apps/web/e2e/` (specs junto a la app que prueban, mismo
  criterio que los tests unitarios en `lib/**/*.test.ts`). `playwright.config.ts`
  en la raíz de `apps/web`.
- **Dependencia:** `@playwright/test` como devDependency de la app de producto
  únicamente — cada app declara sus propias dependencias de test.
- **CI:** un job SEPARADO del job de Vitest — Playwright necesita
  `npx playwright install --with-deps` (navegadores) y variables de entorno de
  Supabase apuntando al proyecto de desarrollo + las credenciales del usuario
  de test sembrado.
- **Server real:** usar `webServer` de la propia config de Playwright (arranca
  y apaga el server automáticamente alrededor de la corrida) en vez de un paso
  manual — mantiene la disciplina de nunca correr `next build` y `next dev`
  sobre el mismo `.next` a la vez (ver el aprendizaje correspondiente en
  `CLAUDE.md`).

## Tenants efímeros por worker

La suite corre con tenants efímeros por worker (`apps/web/e2e/fixtures.ts`,
prefijo `e2e-ef-*`), descartables, contra el Supabase de DEV — nunca contra
producción ni contra el tenant real. Cada worker aísla su tenant para que las
corridas en paralelo no se contaminen entre sí. Correos reales apagados
(`RESEND_ENVIO=off`).
