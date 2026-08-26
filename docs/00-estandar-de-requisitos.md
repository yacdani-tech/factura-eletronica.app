# Estándar de redacción del documento de requisitos


Quien edite `docs/Requerimientos_<app>.md` — persona o agente — sigue estas reglas. Existen porque el documento es la fuente de la que QA deriva los casos de prueba: una regla ambigua o duplicada produce una prueba equivocada, y una prueba equivocada se descubre tarde y cara.

---

## Qué es y qué no es este documento

**Es** la descripción de lo que el sistema debe hacer hoy.

**No es** el registro de cómo se llegó hasta acá, ni el estado de lo construido, ni la bitácora de decisiones. Cada una de esas cosas tiene su lugar:

| Contenido | Dónde va |
|---|---|
| Qué debe hacer el sistema | `docs/Requerimientos_<app>.md` |
| Qué está construido y qué falta | `docs/PROGRESO.md` |
| Qué cambió, cuándo y por qué | `docs/CHANGELOG-requisitos.md` y el historial de Git |
| Cómo está construido | `docs/arquitectura/` |
| Cuánto cuesta y en qué orden | `docs/PLAN_MVP.md` |

Si lo que vas a escribir cabe mejor en una de esas cuatro filas, no va acá.

---

## Las diez reglas

### 1. Una sola redacción vigente por requisito

Prohibido dejar dos versiones de una regla en el mismo lugar. Nada de "SUPERSEDIDO", "reemplaza la redacción anterior", "antes decía", "reversa parcial de". Se reescribe la viñeta con la regla que rige hoy y el historial se anota en el changelog.

Mal:

> [MAT-3] Aprendizaje de alias — SOLO manual desde la última revisión (reformula la redacción vigente anterior): la vinculación manual guarda alias. Los automáticos YA NO lo hacen (antes sí lo hacían).

Bien:

> [MAT-3] Solo la vinculación manual guarda el alias de la entidad. Los pasos automáticos nunca crean alias.

### 2. Presente indicativo, sujeto explícito

El sistema, el operador, el administrador del tenant, el super-admin. Se describe comportamiento, no trabajo realizado.

Mal: "se implementó el rechazo de identificadores duplicados". Bien: "el sistema rechaza un identificador ya registrado en el mismo tenant".

### 3. Sin autoría ni fechas en el cuerpo

Nada de "decisión del dueño del producto", "pedido el 2026-08-09", "ajustado el 29". Quién decidió y cuándo vive en el changelog y en Git, donde se puede consultar sin ensuciar la regla.

### 4. Sin estado de implementación ni de QA

Fuera: "implementado", "en integración", "gate completo cumplido", "QA verde", "revisor APROBADO", "Vitest 1997/1997". El estado se mueve todos los días; el documento no.

Única excepción: cuando **no existir todavía** es parte del alcance y cambia qué se puede probar. En ese caso se usa una marca de la lista de la regla 9, sin explicación.

### 5. Sin rutas de archivo, migraciones ni commits

Fuera: `lib/matching/cascada.ts`, `migración 20260813081000`, `commit 1973ba8`. El documento no debe romperse porque alguien renombró un archivo.

Sí se conservan las **rutas de la aplicación** visibles al usuario (`/clientes`, `/registro`, `/soporte/suscripciones`): son comportamiento observable y QA las necesita.

### 6. Un requisito, una regla, verificable

La prueba: ¿se puede escribir el resultado esperado como un valor concreto o un comportamiento observable? Si no, el requisito todavía no está listo.

Si la viñeta necesita un "y además" para una regla distinta, se parte en dos requisitos o se abre en sub-viñetas.

### 7. Valores concretos, nunca adjetivos

Umbrales, unidades, límites y cantidades explícitos. Fuera "rápido", "razonable", "adecuado", "suficiente". Si el umbral no está decidido, se marca como pendiente en vez de describirlo con un adjetivo.

Mal: "un límite razonable de intentos". Bien: "5 intentos cada 10 minutos por combinación de IP y subdominio".

### 8. Decir dónde se hace cumplir la regla, cuando importa

Cuando una regla se hace cumplir en el servidor o en la base de datos y no solo en la pantalla, se marca `(servidor)` o `(BD)` al final. Para QA es la diferencia entre poder probarla desde el navegador o tener que atacar la capa de abajo.

> [SUS-7] Un Admin del tenant no puede modificar el precio de suscripción de su propio tenant. `(servidor)`

### 9. Marcas normalizadas — solo estas cuatro

- `[Diferido]` — está fuera del alcance actual, definido para más adelante.
- `[Pendiente de decisión]` — falta una definición de producto. No se prueba y no se implementa.
- `[Sin disparador]` — el comportamiento está definido pero ningún evento lo dispara todavía.
- `[Retirado]` — la regla ya no aplica. Se deja una línea de una sola frase y el ID nunca se reutiliza.

No se inventan marcas nuevas ni se escriben en prosa ("queda pendiente de confirmar cuando haya tiempo").

### 10. Los identificadores son permanentes

Un ID (`SUS-4`, `MAT-2`) no se renumera, no se recicla y no cambia de significado. Las pruebas automatizadas se etiquetan con esos identificadores: renumerar rompe la trazabilidad en silencio.

Requisito nuevo, número siguiente de su prefijo. Requisito que deja de aplicar, `[Retirado]`.

---

## Excepciones por canal

Varias reglas pueden comportarse distinto según por dónde entre el dato. Cuando pasa, se listan los canales de forma explícita, sin dejar ninguno implícito:

> [ENT-3] Nombre, teléfono y correo son obligatorios en el alta interna y en el registro público. En la carga masiva pueden faltar: la fila entra igual y queda marcada por revisar.

Los canales típicos son: alta interna, registro público, carga masiva, cola de revisión y API. Si una regla no aplica a alguno, se dice.

---

## Longitud

Máximo unas 60 palabras por requisito. Lo que no entra suele ser diseño o justificación, y va a `docs/arquitectura/`, enlazado por nombre de sección.

Un requisito que necesita tres párrafos casi siempre son tres requisitos.

---

## Proceso cuando cambia una regla

1. Reescribir la viñeta completa con la regla nueva. Nunca agregarla al lado de la vieja.
2. Agregar una línea al changelog: fecha, ID afectado, qué cambió en una frase.
3. Si el requisito ya tenía pruebas etiquetadas con su ID, avisarle a QA en el mismo cambio — esas pruebas quedaron desactualizadas.

---

## Revisión antes de guardar

- [ ] ¿Alguna viñeta tiene dos versiones de la misma regla?
- [ ] ¿Queda alguna fecha, nombre de persona o "implementado" en el cuerpo?
- [ ] ¿Quedó alguna ruta de archivo, migración o commit?
- [ ] ¿De cada requisito se puede escribir el resultado esperado?
- [ ] ¿Hay adjetivos donde debería haber números?
- [ ] ¿Las reglas que se hacen cumplir en servidor o base están marcadas?
- [ ] ¿Se usaron solo las cuatro marcas permitidas?
- [ ] ¿Se conservaron todos los identificadores existentes?
