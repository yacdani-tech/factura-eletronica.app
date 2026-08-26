# Design System Master File — Plataforma

> **FUENTE DE VERDAD visual.** Este archivo se **REGENERA por app** con el skill
> `ui-ux-pro-max` a partir del *Brand Guidelines* de la app concreta. Los valores
> de abajo son PLACEHOLDER (paleta neutra + Inter): reemplazalos por la marca real
> al instanciar. Ante conflicto, gana el libro de marca de la app.
>
> **LÓGICA DE OVERRIDES:** Al construir una pantalla, revisá primero
> `design-system/factura-eletronica/pages/<pagina>.md`. Si existe, sus reglas
> **sobreescriben** este Master para esa página. Si no, seguí este Master.

---

**Proyecto:** Plataforma — SaaS multi-tenant (describir el dominio al instanciar)
**Personalidad:** (definir por app) · profesional · moderna · confiable
**Stack:** Next.js (App Router) + Tailwind CSS + shadcn/ui + iconos Lucide

---

## Principios de diseño (deciden debates)

Una función/pantalla que viola un principio no entra, por atractiva que sea.
Los principios concretos se definen por app; como base, estos cuatro son
un punto de partida razonable:

1. **Automatizar antes de configurar** — si el sistema puede decidir, no pregunta. Los valores por defecto resuelven el caso común; la configuración es para la excepción.
2. **Una acción reemplaza cien** — el valor está en operar sobre el lote/la carga completa; el caso individual es la excepción, no el flujo principal.
3. **El usuario siempre sabe qué pasó** — estados claros, historial y trazabilidad. Ningún proceso ocurre "en silencio".
4. **Nunca romper la confianza financiera** — la velocidad jamás sacrifica precisión. Ante la duda, el sistema se detiene y pregunta antes de generar un cobro incorrecto. **El principio 4 manda sobre los otros tres.**

---

## Color

> Paleta PLACEHOLDER neutra. Reemplazá cada hex por la paleta de la app.
> Mantené los ROLES y las CSS vars; cambian solo los valores.

### Paleta de marca

| Rol | Nombre | Hex (placeholder) | Uso | CSS var |
|-----|--------|-----|-----|---------|
| Marca / Primary | Primario | `#2563EB` | Botones principales, íconos, acentos | `--primary` |
| Hover / detalle | Primario Oscuro | `#1D4ED8` | Hover de botón primario, detalles | `--primary-dark` |
| Texto de marca | Primario Texto | `#1E40AF` | **Único** color de marca permitido para texto/enlaces sobre blanco (contraste AA) | `--primary-text` |
| Texto / Foreground | Negro | `#111827` | Texto principal, headers | `--fg` |
| Texto secundario | Gris Oscuro | `#374151` | Texto secundario | `--fg-muted` |
| Muted | Gris Medio | `#9CA3AF` | Etiquetas, ayuda visual, placeholders | `--muted` |
| Border | Gris Claro | `#E5E7EB` | Bordes y separadores | `--border` |
| Background | Fondo | `#FFFFFF` | Base de toda interfaz y documento | `--bg` |

### Colores funcionales (estado de procesos)

Cada estado tiene un color fijo: el usuario debe **leer el sistema sin leer el texto** — pero el color **nunca** es el único indicador (siempre + texto o ícono).

| Estado | Hex | Significado | CSS var |
|--------|-----|-------------|---------|
| Éxito | `#16A34A` | Aceptado, enviado, completado, pagado | `--success` |
| Advertencia / Proceso | `#F59E0B` | En cola, procesando, reintentando, pendiente | `--warning` |
| Error | `#DC2626` | Rechazado, fallido, vencido | `--error` |
| Informativo | `#3B82F6` | Avisos neutros, ayudas, novedades | `--info` |

> Un color funcional (verde/ámbar/rojo/azul) NO se reusa para categorías sin estado — para eso, usar grises.

### Regla 60 / 30 / 10 (proporción de uso)

- **60%** blanco y grises claros
- **30%** negro / texto
- **10%** color de marca

> El color de marca es un **acento, no un fondo**. Cuanto menos aparece, más fuerte pega donde sí aparece: el botón principal, el dato clave, el estado positivo. **UI light-first** (base blanca); dark mode solo para portadas/marketing, no para el producto.

### Accesibilidad (WCAG AA) — reglas duras

| Combinación | Contraste objetivo | Uso permitido |
|-------------|-----------|---------------|
| Negro `#111827` sobre blanco | ≥ 7:1 | Texto en cualquier tamaño |
| Primario Texto sobre blanco | ≥ 4.5:1 | Enlaces y texto de marca |
| Primario claro sobre blanco | < 4.5:1 | **Solo** íconos, rellenos y acentos gráficos — **NUNCA texto** |

- Texto o enlaces de marca sobre blanco → **siempre** el tono `--primary-text` que cumple AA, nunca el tono claro `--primary`.
- Botón primario: fondo `--primary`, texto blanco peso ≥600, hover `--primary-dark`.
- El color nunca es el único indicador de estado.

---

## Tipografía

**Inter (Google Fonts) por defecto** — producto, marketing y documentos.
Fallback: `Arial, Helvetica, sans-serif`. Pesos autorizados: **400 · 500 · 600 · 700 · 800**.
(Reemplazá la familia si la app tiene su propia tipografía de marca.)

```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
```

### Escala tipográfica

| Rol | Peso / Tamaño | Ejemplo |
|-----|---------------|---------|
| Display | 800 · 48px | Titular de portada |
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
  --primary: #2563EB;
  --primary-dark: #1D4ED8;
  --primary-text: #1E40AF;
  --fg: #111827;
  --fg-muted: #374151;
  --muted: #9CA3AF;
  --border: #E5E7EB;
  --bg: #FFFFFF;
  --success: #16A34A;
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

- Radio base: `--radius: 0.5rem` (8px) para botones, cards, inputs, modales. Consistente en todo.
- Sombras: sutiles. La estructura la da el espacio en blanco y los bordes `--border`, no las sombras pesadas.

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
.input:focus { border-color: var(--primary); outline: none; box-shadow: 0 0 0 3px #2563EB20; }
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

---

## Voz y microcopy (aplica a toda la UI)

- **Claro** (una idea por oración) · **Directo** (resultado primero) · **Profesional** (sin errores ni exageraciones) · **Cercano** (sin tecnicismos).
- Botones = verbo + lo que reciben: ✓ "Generar documentos" · "Ver resumen". ✗ "Aceptar" · "Enviar" · "Click aquí".
- Números concretos: "128 documentos", no "varios documentos".
- Estados vacíos que invitan a actuar: "Subí tu primer archivo".
- **Errores:** qué pasó + cómo resolverlo. Nunca códigos solos, nunca culpar al usuario. Si el sistema reintenta solo, decirlo.

---

## Pre-Delivery Checklist

Antes de entregar cualquier UI, verificar:

- [ ] Base blanca; color de marca solo como acento (regla 60/30/10)
- [ ] Texto de marca usa el tono que cumple AA (nunca el tono claro en texto)
- [ ] Tipografía consistente; pesos autorizados; fallback declarado
- [ ] `tabular-nums` en tablas, documentos y montos
- [ ] Íconos Lucide (outline, 2px), sin emojis; tap target ≥44px
- [ ] Estado nunca comunicado solo por color (+ texto/ícono)
- [ ] Contraste texto ≥4.5:1
- [ ] Focus states visibles; navegación por teclado completa
- [ ] `prefers-reduced-motion` respetado; transiciones 150–300ms
- [ ] Botones nombran la acción (verbo + resultado)
- [ ] Todo el texto en español
- [ ] Colores solo desde tokens `:root` (ningún hex "a mano")
- [ ] Responsive: 375 / 768 / 1024 / 1440px; sin scroll horizontal en móvil
