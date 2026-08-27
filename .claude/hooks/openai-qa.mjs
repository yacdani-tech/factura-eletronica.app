import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import crypto from "node:crypto";
import { readFile as read, loadEnvLocal, shouldRunQa, isDiffAlreadyReviewed, buildFullDiff, buildChangedFilesList, shouldPersistReviewHash, truncateWithNotice, isTruncated, DIFF_CHAR_LIMIT, readHookInput } from "./lib/shared.mjs";

function run(cmd) {
  return execSync(cmd, {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    maxBuffer: 1024 * 1024 * 10,
  }).trim();
}

loadEnvLocal();

function changedFiles() {
  try {
    return buildChangedFilesList(run);
  } catch {
    return "";
  }
}

function diff() {
  try {
    return buildFullDiff(run, read);
  } catch {
    return "";
  }
}

function extractText(json) {
  if (json.output_text) return json.output_text;

  const parts = [];
  for (const item of json.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text") parts.push(content.text);
    }
  }
  return parts.join("\n");
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

async function callOpenAI(prompt) {
  const model = process.env.OPENAI_QA_MODEL || "gpt-5.5";

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: prompt,
    }),
  });

  const body = await res.text();

  if (!res.ok) {
    throw new Error(`OpenAI API error ${res.status}: ${body.slice(0, 800)}`);
  }

  return extractText(JSON.parse(body));
}

async function main() {
  if (readHookInput().stop_hook_active) return;

  const files = changedFiles();

  if (!shouldRunQa(files)) {
    return;
  }

  const currentDiff = diff();

  if (!currentDiff.trim()) {
    return;
  }

  const diffHash = crypto.createHash("sha256").update(currentDiff).digest("hex");

  const hashFile = ".claude/qa-reports/last-reviewed.txt";

  // Sin salida: no es información nueva, y cualquier `hookSpecificOutput` acá
  // dispararía otra vuelta de turno con el mismo mensaje en cada Stop
  // mientras el diff no cambie (así se generó el loop de 9 vueltas).
  if (isDiffAlreadyReviewed(diffHash, hashFile)) return;

  if (!process.env.OPENAI_API_KEY) return;

  const prompt = `
Actúa como QA externo de factura-electronica.app.

Revisa este diff contra CLAUDE.md, el estándar de requisitos y los agentes.

Debes buscar especialmente:
- fugas multi-tenant
- uso de tenant_id desde cliente
- falta de RLS o filtros tenant
- dinero con float, Number o parseFloat
- documentos/registros emitidos mutables (deben ser inmutables)
- falta de snapshot al emitir un documento (los valores con que se emitió deben congelarse)
- endpoints públicos sin validación Zod / captcha / rate limit
- autorización por rol faltante o hecha en el cliente
- cambios críticos sin tests
- manejo de errores deficiente

Devuelve SOLO JSON válido:

{
  "veredicto": "APROBADO" | "NECESITA_CAMBIOS" | "BLOQUEADO",
  "resumen": "string corto",
  "bloqueantes": ["string"],
  "importantes": ["string"],
  "tests_faltantes": ["string"],
  "prompt_para_claude": "instrucciones concretas para Claude, en español"
}

Usa BLOQUEADO para riesgos críticos de tenant, dinero, seguridad o documentos mutables.
Usa NECESITA_CAMBIOS si falta cobertura importante.
Usa APROBADO solo si el cambio se ve seguro.

=== CLAUDE.md ===
${read("CLAUDE.md", 50000)}

=== ESTANDAR DE REQUISITOS ===
${read("docs/00-estandar-de-requisitos.md", 30000)}

=== AGENTE REVISOR ===
${read(".claude/agents/revisor.md", 30000)}

=== AGENTE QA ===
${read(".claude/agents/qa-tests.md", 30000)}

=== AGENTE DB ===
${read(".claude/agents/arquitecto-db.md", 30000)}

=== ARCHIVOS CAMBIADOS ===
${files}

=== DIFF ===
${truncateWithNotice(currentDiff, DIFF_CHAR_LIMIT)}
`;

  const text = await callOpenAI(prompt);

  let result = parseJson(text);

  if (!result) {
    result = {
      veredicto: "NECESITA_CAMBIOS",
      resumen: "El QA externo no devolvió JSON válido.",
      bloqueantes: [],
      importantes: ["Respuesta no parseable del modelo."],
      tests_faltantes: [],
      prompt_para_claude: text.slice(0, 3000),
    };
  }

  mkdirSync(".claude/qa-reports", { recursive: true });

  const reportFile = `.claude/qa-reports/${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  writeFileSync(reportFile, JSON.stringify(result, null, 2), "utf8");

  // Se marca como "revisado" sin importar el veredicto (dedup por diff, no
  // por resultado) — si el diff no cambia, repreguntarle a OpenAI lo mismo en
  // cada Stop no aporta nada nuevo. Cuando el diff cambie de verdad, el hash
  // deja de matchear y vuelve a correr solo. La única excepción es si el diff
  // se truncó: ahí la revisión fue incompleta y no debe marcarse como vista.
  if (shouldPersistReviewHash(result.veredicto, isTruncated(currentDiff, DIFF_CHAR_LIMIT))) {
    writeFileSync(hashFile, diffHash, "utf8");
  }

  const feedback = `
QA EXTERNO OPENAI: ${result.veredicto}

Resumen:
${result.resumen}

Bloqueantes:
${(result.bloqueantes || []).map((x) => `- ${x}`).join("\n") || "- Ninguno"}

Importantes:
${(result.importantes || []).map((x) => `- ${x}`).join("\n") || "- Ninguno"}

Tests faltantes:
${(result.tests_faltantes || []).map((x) => `- ${x}`).join("\n") || "- Ninguno"}

Instrucciones para Claude:
${result.prompt_para_claude || "Sin instrucciones."}

Reporte:
${reportFile}
`.trim();

  if (result.veredicto === "BLOQUEADO") {
    console.log(JSON.stringify({
      decision: "block",
      reason: feedback,
      hookSpecificOutput: {
        hookEventName: "Stop",
        additionalContext: feedback
      }
    }));
    return;
  }

  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "Stop",
      additionalContext: feedback
    }
  }));
}

main().catch((error) => {
  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "Stop",
      additionalContext: `QA externo OpenAI falló: ${error.message}`
    }
  }));
});

