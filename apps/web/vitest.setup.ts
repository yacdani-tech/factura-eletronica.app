import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

import "@testing-library/jest-dom/vitest";

// Polyfills mínimos para interactuar (abrir/elegir) con `@radix-ui/react-select`
// bajo jsdom: jsdom no implementa `scrollIntoView`/`hasPointerCapture`/
// `releasePointerCapture` (son APIs de layout/puntero reales), y Radix los
// llama al montar/mover el foco dentro del popover — sin esto, cualquier test
// que abra un `<Select>` y haga click en una opción revienta con
// "scrollIntoView is not a function". Guard `typeof Element` porque este
// setup también corre para los tests de lógica (`lib/**/*.test.ts`), que usan
// el entorno `node` (sin DOM global) — ver `environmentMatchGlobs` en
// `vitest.config.ts`.
if (typeof Element !== "undefined") {
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
  Element.prototype.hasPointerCapture = Element.prototype.hasPointerCapture ?? (() => false);
  Element.prototype.releasePointerCapture = Element.prototype.releasePointerCapture ?? (() => {});

  // `ResizeObserver` tampoco existe en jsdom: `@radix-ui/react-checkbox` (y
  // `react-switch`) montan un input ESPEJO oculto cuando el control está DENTRO
  // de un `<form>`, y ese espejo usa `useSize` -> `ResizeObserver` para
  // sincronizar dimensiones. Sin este polyfill, cualquier test que renderice un
  // Checkbox/Switch dentro de un form revienta al montar con
  // "ResizeObserver is not defined". No-op: los tests no dependen de medir
  // tamaños reales.
  if (typeof globalThis.ResizeObserver === "undefined") {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
}

// Limpieza del DOM entre tests de componentes (Testing Library). Sin
// `test.globals: true` en `vitest.config.ts` (no lo activamos para no
// exponer `describe/it/expect` como globales en TODA la suite), el
// auto-cleanup de `@testing-library/react` no se registra solo — sin esto,
// el render de un test queda pegado al DOM y contamina los siguientes tests
// del mismo archivo. No-op para los tests de lógica (`lib/**/*.test.ts`) que
// nunca renderizan nada.
afterEach(() => {
  cleanup();
});
