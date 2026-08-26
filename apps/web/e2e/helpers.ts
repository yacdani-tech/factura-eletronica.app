import type { Page, TestInfo } from "@playwright/test";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

import { textosAuth } from "@/lib/textos/auth";
import { tenantActual } from "./infra/tenant-actual";

/**
 * Credenciales del tenant de prueba FIJO: SIEMPRE por env, NUNCA hardcodeadas.
 * Sembradas una vez con `npm run test:e2e:seed` (ver `e2e/seed-tenant-e2e.mjs`)
 * contra el MISMO proyecto Supabase remoto de desarrollo que usa el resto del
 * proyecto. Con el aislamiento por-worker (tenants efímeros) casi ningún spec
 * las necesita; quedan como fallback para specs no migrados.
 */
export const E2E_TEST_TENANT_EMAIL = process.env.E2E_TEST_TENANT_EMAIL;
export const E2E_TEST_TENANT_PASSWORD = process.env.E2E_TEST_TENANT_PASSWORD;

/**
 * `true` si faltan las credenciales del tenant de prueba FIJO — los specs que
 * dependen de ese tenant compartido (no del efímero por-worker) deben hacer
 * `test.skip(credencialesFaltantes(), ...)` en vez de fallar de forma confusa
 * cuando el entorno todavía no las configuró.
 */
export function credencialesFaltantes(): boolean {
  return !E2E_TEST_TENANT_EMAIL || !E2E_TEST_TENANT_PASSWORD;
}

/**
 * Inicia sesión con correo/contraseña (flujo 100% real, sin bypass) y espera a
 * llegar al dashboard.
 *
 * Con el aislamiento por-worker, cada worker corre contra SU propio tenant
 * efímero. Orden de resolución de credenciales: (1) las `credenciales` pasadas
 * explícitamente; (2) el tenant efímero del worker actual (lo publica la
 * fixture `auto` de `e2e/fixtures.ts` en el holder `tenant-actual.ts` — por eso
 * `iniciarSesionTenant(page)` a secas ya usa el tenant aislado del worker, sin
 * enhebrar nada por la firma del test); (3) el tenant fijo compartido por env
 * (`E2E_TEST_TENANT_EMAIL`/`_PASSWORD`), solo para specs no migrados. Lanza si
 * no hay ninguna de las tres.
 */
export async function iniciarSesionTenant(
  page: Page,
  credenciales?: { email: string; password: string },
): Promise<void> {
  const delWorker = tenantActual();
  const email = credenciales?.email ?? delWorker?.email ?? E2E_TEST_TENANT_EMAIL;
  const password = credenciales?.password ?? delWorker?.password ?? E2E_TEST_TENANT_PASSWORD;
  if (!email || !password) {
    throw new Error(
      "iniciarSesionTenant: faltan credenciales (ni parámetro `credenciales` ni E2E_TEST_TENANT_EMAIL/_PASSWORD en el entorno).",
    );
  }

  await page.goto("/login");
  await page.getByLabel(textosAuth.login.emailLabel).fill(email);
  await page.getByLabel(textosAuth.login.passwordLabel).fill(password);
  await page.getByRole("button", { name: textosAuth.login.botonSubmit }).click();
  await page.waitForURL("**/dashboard");
}

/**
 * Carga `apps/web/.env.local` como fallback SOLO para las vars que falten en
 * `process.env` (dev local) — MISMO criterio que `cargarEnvLocalComoFallback`
 * de `e2e/seed-tenant-e2e.mjs` (duplicado a propósito: ese script es `.mjs`
 * plano fuera del grafo de tipos de la app, este archivo es TS consumido por
 * los specs). En CI, `NEXT_PUBLIC_SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` ya
 * llegan como env real del job — este fallback nunca pisa una var ya seteada.
 */
function cargarEnvLocalComoFallback(): void {
  const envLocalPath = path.resolve(__dirname, "..", ".env.local");
  if (!existsSync(envLocalPath)) return;

  const contenido = readFileSync(envLocalPath, "utf8");
  for (const lineaCruda of contenido.split(/\r?\n/)) {
    const linea = lineaCruda.trim();
    if (!linea || linea.startsWith("#")) continue;
    const idx = linea.indexOf("=");
    if (idx === -1) continue;
    const clave = linea.slice(0, idx).trim();
    let valor = linea.slice(idx + 1).trim();
    if ((valor.startsWith('"') && valor.endsWith('"')) || (valor.startsWith("'") && valor.endsWith("'"))) {
      valor = valor.slice(1, -1);
    }
    if (process.env[clave] === undefined) process.env[clave] = valor;
  }
}

let clienteAdminE2ECache: SupabaseClient | null = null;

/**
 * Cliente `service_role` para VERIFICACIÓN DIRECTA en BD desde specs E2E —
 * y para SEMBRAR/limpiar la infra de test (tenants efímeros). NUNCA para mutar
 * datos de negocio en un flujo bajo prueba (eso siempre pasa por la UI real,
 * que es lo que estos specs ejercitan) — solo para preparar/leer el estado. Es
 * infraestructura de test, no código de producción — la restricción de
 * `service_role` de los contratos transversales rige el RUNTIME de la app, no
 * la infra de QA que la verifica.
 *
 * Lanza si faltan las credenciales — llamar solo desde specs que ya saben que
 * el entorno está configurado (o que hicieron `test.skip` cuando corresponde).
 */
export function clienteAdminE2E(): SupabaseClient {
  if (clienteAdminE2ECache) return clienteAdminE2ECache;
  cargarEnvLocalComoFallback();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error(
      "clienteAdminE2E: faltan NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY en el entorno del proceso de Playwright.",
    );
  }

  clienteAdminE2ECache = createSupabaseClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return clienteAdminE2ECache;
}

/**
 * Cliente ANÓNIMO (rol `anon` / `authenticated` tras `signInWithPassword`) con
 * la llave pública — RLS REAL, nunca `service_role`. Usado por los specs que
 * verifican aislamiento multi-tenant desde una sesión de usuario real.
 * `clienteAdminE2E()` ya cargó `.env.local` como side-effect si hacía falta,
 * pero este helper lo asegura por si se llama primero.
 */
export function clienteAnonimoE2E(): SupabaseClient {
  cargarEnvLocalComoFallback();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "clienteAnonimoE2E: faltan NEXT_PUBLIC_SUPABASE_URL/NEXT_PUBLIC_SUPABASE_ANON_KEY en el entorno del proceso de Playwright.",
    );
  }
  return createSupabaseClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

/** Cliente de SESIÓN real (rol `authenticated`, RLS real) — nunca `service_role`. */
export async function clienteConSesionE2E(email: string, password: string): Promise<SupabaseClient> {
  const cliente = clienteAnonimoE2E();
  const { error } = await cliente.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`clienteConSesionE2E(${email}): ${error.message}`);
  return cliente;
}

/**
 * Detalle de UN motivo de desborde encontrado por `diagnosticarDesbordeVisual`
 * — pensado para loguearlo en el test que falla (`console.log(diagnostico.motivos)`),
 * nunca para lógica de negocio.
 */
export interface DiagnosticoDesbordeVisual {
  ok: boolean;
  motivos: string[];
}

/**
 * Verificación VISUAL: detecta desborde horizontal del documento y, dentro de
 * cada `[role="dialog"]` abierto, cajas que se escapan del diálogo o texto que
 * se pinta sobre la celda vecina — con cuidado de NO marcar como bug los
 * patrones de truncado/scroll INTENCIONALES (`.truncate` con tooltip;
 * contenedores con scroll horizontal real y alcanzable). Un chequeo de
 * `document.documentElement.scrollWidth` por sí solo NO detecta overflow dentro
 * de un diálogo Radix (`position: fixed`): su contenido puede crecer más allá
 * de la caja sin mover el scroll del documento.
 *
 * Reutilizable por CUALQUIER spec que abra un diálogo — escanea todos los
 * `[role="dialog"]` presentes al momento de la llamada. Se llama DESPUÉS de
 * llevar la pantalla al estado final (con datos reales), no en el estado
 * inicial vacío.
 */
export async function diagnosticarDesbordeVisual(page: Page): Promise<DiagnosticoDesbordeVisual> {
  return page.evaluate(() => {
    const TOLERANCIA_PX = 1.5;
    const motivos: string[] = [];

    if (document.documentElement.scrollWidth > window.innerWidth + 1) {
      motivos.push(
        `document.documentElement.scrollWidth (${document.documentElement.scrollWidth}) excede window.innerWidth (${window.innerWidth})`,
      );
    }

    function describir(el: Element): string {
      const clases = typeof el.className === "string" && el.className.trim() !== "" ? `.${el.className.trim().split(/\s+/).join(".")}` : "";
      return `<${el.tagName.toLowerCase()}${clases}>`;
    }

    /**
     * Scroll horizontal REAL, INTENCIONAL y alcanzable — las 3 condiciones a la
     * vez: declarado a propósito en el className (`overflow-auto` /
     * `overflow-x-auto|scroll`, con o sin prefijo responsive) Y con contenido
     * que de verdad desborda (`scrollWidth > clientWidth`). Mirar solo
     * `getComputedStyle(...).overflowX` no sirve: un elemento con SOLO
     * `overflow-y: auto` computa el otro eje como `auto` por una regla de CSS,
     * un efecto secundario no buscado.
     */
    function tieneScrollHorizontalReal(el: Element): boolean {
      const cls = typeof el.className === "string" ? el.className : "";
      const declaraScrollAProposito = /(^|\s)(?:[\w-]+:)*overflow(?:-x)?-(?:auto|scroll)(?=\s|$)/.test(cls);
      const elHtml = el as HTMLElement;
      return declaraScrollAProposito && elHtml.scrollWidth > elHtml.clientWidth + TOLERANCIA_PX;
    }

    /** Patrón `.truncate` de Tailwind — truncado A PROPÓSITO, casi siempre con tooltip/`title`; no es el bug que este chequeo busca. */
    function esTruncadoAProposito(el: Element): boolean {
      const cs = getComputedStyle(el);
      return cs.textOverflow === "ellipsis" && cs.overflowX !== "visible";
    }

    for (const dialogo of Array.from(document.querySelectorAll('[role="dialog"]'))) {
      const dialogoRect = dialogo.getBoundingClientRect();

      const recorrer = (el: Element, dentroDeScrollReal: boolean): void => {
        if (!dentroDeScrollReal) {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) {
            if (r.right > dialogoRect.right + TOLERANCIA_PX || r.left < dialogoRect.left - TOLERANCIA_PX) {
              motivos.push(
                `${describir(el)} se sale del diálogo (rect.right=${r.right.toFixed(1)}, rect.left=${r.left.toFixed(1)}, dialogo.right=${dialogoRect.right.toFixed(1)}, dialogo.left=${dialogoRect.left.toFixed(1)})`,
              );
            }
          }
        }

        const tag = el.tagName.toLowerCase();
        if (tag === "th" || tag === "td") {
          const elHtml = el as HTMLElement;
          if (!esTruncadoAProposito(el) && elHtml.scrollWidth > elHtml.clientWidth + TOLERANCIA_PX) {
            motivos.push(
              `${describir(el)} tiene texto más ancho que su celda sin truncar a propósito (scrollWidth=${elHtml.scrollWidth}, clientWidth=${elHtml.clientWidth}): "${(el.textContent ?? "").slice(0, 60)}"`,
            );
          }
        }

        const siguienteDentroDeScroll = dentroDeScrollReal || tieneScrollHorizontalReal(el);
        for (const hijo of Array.from(el.children)) recorrer(hijo, siguienteDentroDeScroll);
      };

      recorrer(dialogo, false);
    }

    return { ok: motivos.length === 0, motivos };
  });
}

/**
 * Verificación VISUAL mínima: sin desborde horizontal de todo el documento NI
 * dentro de ningún diálogo abierto. Se llama DESPUÉS de llevar la pantalla al
 * estado final (con datos reales). Si falla y no es obvio por qué, usar
 * `diagnosticarDesbordeVisual` directamente para ver la lista de motivos.
 */
export async function sinDesbordeHorizontal(page: Page): Promise<boolean> {
  const diagnostico = await diagnosticarDesbordeVisual(page);
  return diagnostico.ok;
}

/** Viewport móvil mínimo: 375px. */
export const VIEWPORT_MOVIL = { width: 375, height: 812 };

/** Adjunta un screenshot al reporte de Playwright con un nombre descriptivo. */
export async function adjuntarScreenshot(testInfo: TestInfo, nombre: string, page: Page): Promise<void> {
  const buffer = await page.screenshot({ fullPage: true });
  await testInfo.attach(nombre, { body: buffer, contentType: "image/png" });
}
