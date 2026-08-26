/**
 * Header interno donde `middleware.ts` expone el `pathname` de la request
 * actual, para que Server Components (`app/(app)/layout.tsx`) sepan qué ruta
 * se pidió sin depender de una API no soportada de Next para leerlo
 * directamente en un layout. Mismo patrón que `TENANT_SUBDOMAIN_HEADER`
 * (`lib/tenant/subdominio.ts`): el middleware lo escribe en `requestHeaders`
 * antes de `NextResponse.next(...)`, y cualquier Server Component lo lee vía
 * `(await headers()).get(PATHNAME_HEADER)`.
 */
export const PATHNAME_HEADER = "x-pathname";
