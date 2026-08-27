# Design System Master File — factura-electronica.app

> **FUENTE DE VERDAD visual.** Este archivo se **REGENERA por app** con el skill
> `ui-ux-pro-max` a partir del *Brand Guidelines* de la app concreta. Ante
> conflicto, gana el libro de marca de la app.
>
> **Estado:** los valores de abajo YA NO son placeholder — se reemplazaron por
> el kit de marca real entregado en `Marketing/Logos/branding-factura-electronica-v1.zip`
> (paleta, tipografía, logo/isotipo/icono en SVG+PNG, `brand-tokens.json`,
> `brand.css`). Ese kit es la fuente que alimentó este Master; si la marca
> cambia, se actualiza primero el kit y después este archivo.
>
> **LÓGICA DE OVERRIDES:** Al construir una pantalla, revisá primero
> `design-system/factura-electronica/pages/<pagina>.md`. Si existe, sus reglas
> **sobreescriben** este Master para esa página. Si no, seguí este Master.

---

**Proyecto:** factura-electronica.app — plataforma de facturación electrónica multi-tenant para Costa Rica
**Personalidad:** precisa · clara · moderna · cercana · confiable (concepto de marca: automatización y velocidad de facturación)
**Stack:** Next.js (App Router) + Tailwind CSS + shadcn/ui + iconos Lucide

---

## Principios de diseño (deciden debates)

Una función/pantalla que viola un principio no entra, por atractiva que sea.

1. **Automatizar antes de configurar** — si el sistema puede decidir, no pregunta. Los valores por defecto resuelven el caso común; la configuración es para la excepción.
2. **Una acción reemplaza cien** — el valor está en operar sobre el lote/la carga completa; el caso individual es la excepción, no el flujo principal.
3. **El usuario siempre sabe qué pasó** — estados claros, historial y trazabilidad. Ningún proceso ocurre "en silencio".
4. **Nunca romper la confianza financiera** — la velocidad jamás sacrifica precisión. Ante la duda, el sistema se detiene y pregunta antes de generar un cobro incorrecto. **El principio 4 manda sobre los otros tres.**

---

## Color

Paleta real de marca (kit v1.0, 27-ago-2026). Los roles y las CSS vars no cambian; lo que cambió son los hex.

### Paleta de marca

| Rol | Nombre | Hex | Uso | CSS var |
|-----|--------|-----|-----|---------|
| Marca / Primary | Verde de marca | `#27B85A` | Botones principales, isotipo, acentos, rellenos | `--primary` |
| Hover / detalle | Verde oscuro | `#23924A` | Hover de botón primario, interacciones, detalles | `--primary-dark` |
| Texto de marca | Verde texto | `#187A3F` | **Único** verde permitido para texto/enlaces sobre blanco (cumple AA; el verde de marca `#27B85A` NO cumple) | `--primary-text` |
| Texto / Foreground | Ink | `#111827` | Texto principal, headers, fondo del logo invertido/icono de app | `--fg` |
| Texto secundario | Gris texto | `#374151` | Texto secundario | `--fg-muted` |
| Muted | Gris medio | `#9CA3AF` | Etiquetas, ayuda visual, placeholders — tono neutro no incluido en el kit, elegido por contigüidad con `--border`/`--fg-muted` | `--muted` |
| Border | Gris de bordes | `#E5E7EB` | Bordes y separadores | `--border` |
| Background | Blanco | `#FFFFFF` | Base de toda interfaz y documento | `--bg` |

> El isotipo (hexágono + F + barras de velocidad) usa el mismo `--primary`/`--primary-dark`/`--fg` — no introducir un verde "solo para el logo" distinto del verde de marca.

### Colores funcionales (estado de procesos)

| Estado | Hex | Significado | CSS var |
|--------|-----|-------------|---------|
| Éxito | `#23924A` | Aceptado, enviado, completado, pagado | `--success` |
| Advertencia / Proceso | `#F59E0B` | En cola, procesando, reintentando, pendiente | `--warning` |
| Error | `#DC2626` | Rechazado, fallido, vencido | `--error` |
| Informativo | `#3B82F6` | Avisos neutros, ayudas, novedades | `--info` |

> **Decisión deliberada:** "Éxito" reusa el verde oscuro de marca (`--primary-dark`) en lugar de un verde genérico de librería, porque en esta app el verde YA significa "aceptado por Hacienda / al día" — reforzar la asociación es intencional, no un choque de tokens. Sigue valiendo la regla dura: **el color nunca es el único indicador** (badge de estado = color + texto + ícono siempre), así que un botón primario verde y un badge de éxito verde no se confunden entre sí en contexto.
> Un color funcional (ámbar/rojo/azul) no se reusa para categorías sin estado — para eso, usar grises.

### Regla 60 / 30 / 10 (proporción de uso)

- **60%** blanco y grises claros
- **30%** negro / texto (`--fg`)
- **10%** verde de marca

> El verde es un **acento, no un fondo**. Cuanto menos aparece, más fuerte pega donde sí aparece: el botón principal, el dato clave, el estado positivo. **UI light-first** (base blanca); dark mode solo para portadas/marketing, no para el producto — el logo blanco (`logo-blanco.svg`) está pensado para esos usos, no para el dashboard.

### Accesibilidad (WCAG AA) — reglas duras

| Combinación | Contraste objetivo | Uso permitido |
|-------------|-----------|---------------|
| Ink `#111827` sobre blanco | ≥ 7:1 | Texto en cualquier tamaño |
| Verde texto `#187A3F` sobre blanco | ≥ 4.5:1 | Enlaces y texto de marca |
| Verde de marca `#27B85A` sobre blanco | < 4.5:1 | **Solo** íconos, rellenos, fondos de botón y acentos gráficos — **NUNCA texto** |

- Texto o enlaces de marca sobre blanco → **siempre** `--primary-text` (`#187A3F`), nunca `--primary` (`#27B85A`).
- Botón primario: fondo `--primary`, texto blanco peso ≥600 (el blanco sobre `#27B85A` sí cumple AA — la restricción es solo texto verde sobre blanco), hover `--primary-dark`.
- El color nunca es el único indicador de estado.

---

## Tipografía

**Inter** (Google Fonts) — producto, marketing y documentos. Fallback: `Arial, Helvetica, sans-serif`.

**Pesos autorizados en UI: 400 · 500 · 600 · 700.** El peso **800 (ExtraBold) queda reservado exclusivamente al logotipo** (ya convertido a curvas en los SVG del kit) — el kit entrega Inter Regular 400 y Bold 700 como archivos reales precisamente para no tener que simular el 800 en ningún otro lugar de la interfaz. No usar `font-weight: 800` en títulos, botones ni ningún componente de producto.

```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
```

### Escala tipográfica

| Rol | Peso / Tamaño | Ejemplo |
|-----|---------------|---------|
| Display | 700 · 48px | Titular de portada |
| H1 | 700 · 32px | Título de página |
| H2 | 700 · 24px | Resumen del día |
| H3 | 600 · 18px | Subtítulo de sección |
| Cuerpo | 400 · 15–16px | Texto de contenido. |
| Secundario | 400 · 13px | Actualizado hoy, 9:41 a.m. |
| Etiqueta | 600 · 11px · MAYÚSCULAS | ACTIVIDAD RECIENTE |

### Cifras tabulares (obligatorio)

En **tablas, documentos y montos** activar siempre `font-variant-numeric: tabular-nums` para que las columnas de números alineen.

```css
.tabular { font-variant-numeric: tabular-nums; }
```

---

## Tokens de diseño (única fuente de verdad — ningún color "a mano")

```css
:root {
  --primary: #27B85A;
  --primary-dark: #23924A;
  --primary-text: #187A3F;
  --fg: #111827;
  --fg-muted: #374151;
  --muted: #9CA3AF;
  --border: #E5E7EB;
  --bg: #FFFFFF;
  --success: #23924A;
  --warning: #F59E0B;
  --error: #DC2626;
  --info: #3B82F6;
  --font: 'Inter', system-ui, sans-serif;
  --radius: 0.5rem;
}
```

### Espaciado (base 4/8px)

| Token | Valor | Uso |
|-------|-------|-----|
| `--space-xs` | 4px | Gaps mínimos |
| `--space-sm` | 8px | Íconos, spacing inline |
| `--space-md` | 16px | Padding estándar |
| `--space-lg` | 24px | Padding de sección |
| `--space-xl` | 32px | Gaps grandes |
| `--space-2xl` | 48px | Márgenes de sección |

### Radio y sombras

- Radio base: `--radius: 0.5rem` (8px) para botones, cards, inputs, modales. Consistente en todo. El icono de app (`icono-app.svg`) ya trae sus propias esquinas redondeadas a otra escala (asset fijo, no tocar).
- Sombras: sutiles. La estructura la da el espacio en blanco y los bordes `--border`, no las sombras pesadas.

---

## Logo e isotipo en la UI del producto

Assets reales del kit de marca en `Marketing/Logos/branding-factura-electronica-v1.zip` (SVG vectorial real, texto convertido a curvas — no requiere instalar fuentes para reproducirlo). **Pendiente:** copiar los SVG que se usan en runtime a `apps/web/public/` (p. ej. `public/brand/`) antes de referenciarlos desde componentes — hoy solo existen en `Marketing/Logos/`.

| Dónde | Asset | Motivo |
|---|---|---|
| Sidebar expandido, header, login, marketing sobre fondo claro | `svg/logo-principal.svg` | Logo horizontal completo a color |
| Sidebar expandido sobre fondo oscuro / footer oscuro | `svg/logo-blanco.svg` | Versión blanca; **nunca** sobre fondo claro (queda invisible) |
| Sidebar colapsado, mobile, breadcrumb compacto, avatar de tenant sin logo propio | `svg/isotipo-verde.svg` | Símbolo solo, cuadrado, más legible a tamaño chico que el logo completo |
| Favicon, ícono PWA / manifest, ícono de app en el sistema operativo | `png/icono-app-512.png` (o el SVG `svg/icono-app.svg` si el destino acepta vectorial) | Ya trae fondo `#111827` y esquinas redondeadas incorporados — no reencuadrar sobre otro fondo |
| Documento imprimible / email / cualquier destino sin SVG | `png/*-4096.png` de la variante que corresponda | Mantener siempre la relación de aspecto original |

Reglas duras de uso (heredadas del kit, no son opcionales):

- **Nunca** deformar, rotar, recolorear, agregar sombra/degradado ni alterar las barras de velocidad del isotipo.
- No hay todavía un mínimo de tamaño legible **probado** para este nombre (es más largo que el de casilleros.app; no heredar su mínimo de 120px sin verificar). Si el logo completo no entra o pierde legibilidad, usar el isotipo solo — nunca encoger el logo completo por debajo de lo legible.
- Espacio de protección mínimo alrededor: un grosor de trazo del hexágono.
- El isotipo verde sobre fondo blanco es la única combinación de color/fondo aprobada para tamaños chicos; no crear variantes de color nuevas ad-hoc.
- Favicon a 32px ya viene provisto (`png/favicon-32.png`); a 16px es una exportación pendiente — si se necesita, generarla desde el SVG, no downscalear el PNG de 32.

---

## Componentes

### Botón primario

```css
.btn-primary {
  background: var(--primary);
  color: #FFFFFF;                 /* peso 600+ */
  font-weight: 600;
  padding: 12px 20px;
  border-radius: var(--radius);
  transition: background 200ms ease;
  cursor: pointer;
}
.btn-primary:hover { background: var(--primary-dark); }
.btn-primary:focus-visible { outline: 2px solid var(--primary-text); outline-offset: 2px; }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
```

> Los botones **dicen la acción**: "Generar documentos", no "Aceptar". "Ver resumen", no "Enviar".

### Botón secundario

```css
.btn-secondary {
  background: transparent;
  color: var(--fg);
  border: 1px solid var(--border);
  font-weight: 600;
  padding: 12px 20px;
  border-radius: var(--radius);
  transition: border-color 200ms ease, background 200ms ease;
  cursor: pointer;
}
.btn-secondary:hover { background: #F9FAFB; border-color: var(--muted); }
```

### Card

```css
.card {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 24px;
}
```

### Input

```css
.input {
  padding: 10px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font-size: 16px;                 /* evita zoom en iOS */
  color: var(--fg);
  transition: border-color 200ms ease;
}
.input::placeholder { color: var(--muted); }
.input:focus { border-color: var(--primary); outline: none; box-shadow: 0 0 0 3px #27B85A20; }
.input[aria-invalid="true"] { border-color: var(--error); }
```

### Badges de estado (color + texto/ícono, nunca color solo)

```
Éxito      fondo success 10%  · texto success oscuro · ícono check
Proceso    fondo warning 10%  · texto warning oscuro · ícono reloj
Error      fondo error 10%    · texto error oscuro   · ícono alerta
Info       fondo info 10%     · texto info oscuro     · ícono info
```

### Iconografía

- **Librería: Lucide** (`lucide-react`). Estilo outline, esquinas redondeadas, **trazo 2px**, un solo color por ícono.
- Tamaños como tokens: `icon-sm` 16px, `icon-md` 24px, `icon-lg` 32px. Tap target ≥44px.
- **Nunca emojis como íconos estructurales.** Nunca PNG rasterizado.
- El isotipo de marca NO es un ícono de Lucide — es un asset de marca (ver sección de logo arriba); no recrearlo con formas de la librería de íconos.

---

## Voz y microcopy (aplica a toda la UI)

- **Claro** (una idea por oración) · **Directo** (resultado primero) · **Profesional** (sin errores ni exageraciones) · **Cercano** (sin tecnicismos).
- Voseo en producto y marketing; registro formal (sin voseo) en el cuerpo de documentos fiscales — son dos registros distintos, no un descuido.
- Botones = verbo + lo que reciben: ✓ "Generar documentos" · "Ver resumen". ✗ "Aceptar" · "Enviar" · "Click aquí".
- Números concretos: "128 documentos", no "varios documentos".
- Estados vacíos que invitan a actuar: "Subí tu primer archivo".
- **Errores:** qué pasó + cómo resolverlo. Nunca códigos solos, nunca culpar al usuario. Si el sistema reintenta solo, decirlo.
- **Nunca prometer** aceptación automática de Hacienda, cero errores o disponibilidad absoluta — ni en copy de producto ni en marketing. Es una restricción de marca, no solo legal.

---

## Pre-Delivery Checklist

Antes de entregar cualquier UI, verificar:

- [ ] Base blanca; verde de marca solo como acento (regla 60/30/10)
- [ ] Texto de marca usa `--primary-text` (`#187A3F`); nunca `--primary` (`#27B85A`) como color de texto
- [ ] Tipografía consistente; **peso 800 nunca usado fuera del logotipo**; fallback declarado
- [ ] `tabular-nums` en tablas, documentos y montos
- [ ] Íconos Lucide (outline, 2px), sin emojis; tap target ≥44px
- [ ] Estado nunca comunicado solo por color (+ texto/ícono) — incluido el solapamiento deliberado entre verde de marca y verde de éxito
- [ ] Contraste texto ≥4.5:1
- [ ] Logo/isotipo: variante correcta según fondo (nunca logo de color sobre oscuro, nunca blanco sobre claro); sin deformar/recolorear/sombrear
- [ ] Focus states visibles; navegación por teclado completa
- [ ] `prefers-reduced-motion` respetado; transiciones 150–300ms
- [ ] Botones nombran la acción (verbo + resultado)
- [ ] Todo el texto en español
- [ ] Colores solo desde tokens `:root` (ningún hex "a mano")
- [ ] Responsive: 375 / 768 / 1024 / 1440px; sin scroll horizontal en móvil
