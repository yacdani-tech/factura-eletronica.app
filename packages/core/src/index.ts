/**
 * `@factura/core` — lógica PURA y genérica (framework-agnostic) compartida
 * entre las apps del monorepo. Patrón de paquete interno JIT: se exporta
 * TypeScript crudo (sin build), cada app Next lo lista en `transpilePackages`.
 *
 * Este barrel re-exporta la superficie pública para `import { x } from
 * "@factura/core"`. El acceso por subpath (`@factura/core/utils`,
 * `@factura/core/importacion/lector-archivo`, etc.) también funciona vía el
 * export `"./*"` del package.json.
 */

export * from "./tenant/subdominio";
export * from "./validaciones/auth";
export * from "./validaciones/redireccion";
export * from "./permisos";
export * from "./utils";
export * from "./fechas";
export * from "./paginacion";
export * from "./listas";
export * from "./href-orden";
export * from "./importacion/csv-parser";
export * from "./importacion/separador-csv";
export * from "./importacion/csv-embebido-en-columna";
export * from "./importacion/mojibake";
export * from "./importacion/xlsx-sheetjs";
export * from "./importacion/lector-archivo";
export * from "./ui/tiempo-transcurrido";
export * from "./maintenance";
export * from "./auth/tipos";
export * from "./suscripcion/tipos";
export * from "./textos/importacion";
