# CHANGELOG de requisitos

Bitácora de cambios al documento de requisitos (`docs/Requerimientos_<app>.md`). Una línea por cambio: **fecha · ID afectado · qué cambió en una frase**. Es el lugar donde vive el historial que la regla 1 del estándar (`docs/00-estandar-de-requisitos.md`) prohíbe dejar en el cuerpo del requisito.

Formato:

```
- AAAA-MM-DD · <ID> · <qué cambió en una frase>
```

---

## Cambios

- 2026-08-27 · D-10 · Aclarada la redacción para eliminar la contradicción aparente con D-18: el valor fijo del MVP aplica solo a la sucursal (001); la terminal es el número propio por emisor que asigna D-18, nunca un valor compartido entre emisores.
- 2026-08-27 · D-12 · Se distingue explícitamente rechazo de corrección: un comprobante rechazado por Hacienda nunca fue válido fiscalmente y se reemplaza con clave nueva, sin nota de crédito/débito; la NC/ND solo aplica a comprobantes ya aceptados.
- 2026-08-27 · D-20 · Fundamento ampliado para dejar abierto el alcance exacto del tipo 05 frente a la condición de venta (ver Q13).
- 2026-08-27 · 3.2 (Modo contingencia y sin internet) · Razón de exclusión ampliada: la exclusión por volumen queda condicionada a que no exista una obligación mínima independiente del volumen (ver Q15).
- 2026-08-27 · Q12 · Pregunta ampliada para cubrir explícitamente el caso de un emisor que migra desde otro sistema de facturación, no solo la continuidad de serie por terminal en general.
- 2026-08-27 · Q13 (nueva) · Si el tipo de identificación 05 Extranjero No Domiciliado tiene alguna restricción de uso por condición de venta.
- 2026-08-27 · Q14 (nueva) · Si un comprobante rechazado por Hacienda requiere alguna referencia formal a su clave en el documento de reemplazo.
- 2026-08-27 · Q15 (nueva) · Si la exclusión del modo contingencia es viable sin importar el volumen o si el reglamento exige un procedimiento mínimo desde el primer comprobante.
- 2026-08-27 · F1-16 (nuevo) · Un envío sin resolución dentro del tiempo de espera no se trata como rechazo ni habilita reemisión automática; se concilia por consulta antes de cualquier reintento.
- 2026-08-27 · F5-03 · Criterio de aceptación ampliado: la entrega al receptor es un estado independiente del estado fiscal del documento (un documento aceptado puede quedar con la entrega pendiente, en reintento o rebotada).
