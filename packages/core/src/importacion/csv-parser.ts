/**
 * Parser CSV mínimo, GENÉRICO y sin dependencias externas — extraído para que
 * el lector de archivos compartido (`lib/importacion/lector-archivo.ts`) y el
 * recuperador de "CSV embebido en una columna"
 * (`lib/importacion/csv-embebido-en-columna.ts`) tokenicen texto CSV sin
 * acoplarse a ningún dominio (mapeo de columnas / detección de fila de
 * encabezado viven en los callers de dominio, nunca acá — ver el contrato de
 * importación).
 *
 * RFC4180 básico: comillas dobles, comas (o el separador dado) y saltos de
 * línea embebidos dentro de campos entrecomillados, comillas escapadas (`""`).
 * Ignora `\r` (soporta `\r\n` y `\n`).
 *
 * NO descarta filas 100% vacías (ni una línea en blanco suelta al final): los
 * parsers de fila de cada dominio numeran por POSICIÓN dentro del `string[][]`
 * que este parser devuelve, así que descartar una línea acá desfasaría el
 * número de fila real del archivo. La fuente de verdad de "qué fila se salta"
 * es el parser de fila del dominio, nunca este lector.
 *
 * `separador`: opcional, default `","`. `leerFilasDeArchivo` detecta `,` vs
 * `;` vs TAB por contenido (sniff de las primeras líneas) y pasa el separador
 * ya resuelto — este parser NO adivina nada, solo tokeniza con el separador
 * que le dan.
 */
const BOM_UTF8 = "﻿";

export function parsearCsv(textoCrudo: string, separador: string = ","): string[][] {
  // Quita el BOM si viene (Excel lo agrega al exportar UTF-8).
  const texto = textoCrudo.startsWith(BOM_UTF8) ? textoCrudo.slice(BOM_UTF8.length) : textoCrudo;
  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = "";
  let dentroDeComillas = false;
  let i = 0;
  const n = texto.length;

  while (i < n) {
    const c = texto[i];

    if (dentroDeComillas) {
      if (c === '"') {
        if (texto[i + 1] === '"') {
          campo += '"';
          i += 2;
          continue;
        }
        dentroDeComillas = false;
        i++;
        continue;
      }
      campo += c;
      i++;
      continue;
    }

    if (c === '"') {
      dentroDeComillas = true;
      i++;
      continue;
    }
    if (c === separador) {
      fila.push(campo);
      campo = "";
      i++;
      continue;
    }
    if (c === "\r") {
      i++;
      continue;
    }
    if (c === "\n") {
      fila.push(campo);
      filas.push(fila);
      fila = [];
      campo = "";
      i++;
      continue;
    }
    campo += c;
    i++;
  }

  // Última fila/campo si el archivo no termina en salto de línea.
  if (campo.length > 0 || fila.length > 0) {
    fila.push(campo);
    filas.push(fila);
  }

  return filas;
}
