import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import crypto from "node:crypto";
import { readFile as read, loadEnvLocal, isDiffAlreadyReviewed, buildFullDiff, shouldPersistReviewHash, truncateWithNotice, isTruncated, DIFF_CHAR_LIMIT, readHookInput } from "./lib/shared.mjs";

function run(cmd) {
  return execSync(cmd, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], maxBuffer: 1024 * 1024 * 10 }).trim();
}

loadEnvLocal();

function diff() {
  try { return buildFullDiff(run, read); } catch { return ""; }
}

function extractText(json) {
  if (json.output_text) return json.output_text;
  const parts = [];
  for (const item of json.output || []) {
    for (const c of item.content || []) {
      if (c.type === "output_text") parts.push(c.text);
    }
  }
  return parts.join("\n");
}

function parseJson(text) {
  try { return JSON.parse(text); } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try { return JSON.parse(m[0]); } catch { return null; }
  }
}

async function callOpenAI(prompt) {
  const model = process.env.OPENAI_CODE_REVIEW_MODEL || process.env.OPENAI_QA_MODEL || "gpt-5.5";

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, input: prompt }),
  });

  const body = await res.text();
  if (!res.ok) throw new Error(`OpenAI API error ${res.status}: ${body.slice(0, 800)}`);
  return extractText(JSON.parse(body));
}

async function main() {
  // Apagador EXPLÍCITO (decisión del dueño del producto): la máquina del carril de
  // QA no debe usar este revisor de OpenAI, sin depender de que falte
  // OPENAI_API_KEY (esa ausencia ya lo desactivaba de hecho, pero un apagador
  // explícito no depende de un accidente de configuración). Mismo patrón que
  // RESEND_ENVIO/MATCHING_IA/CLASIFICACION_IA — ver docs/qa/ONBOARDING-QA.md.
  if (process.env.REVISION_IA === "off") return;

  if (readHookInput().stop_hook_active) return;

  const currentDiff = diff();
  if (!currentDiff.trim()) return;

  const diffHash = crypto.createHash("sha256").update(currentDiff).digest("hex");
  const hashFile = ".claude/code-review-reports/last-reviewed.txt";

  // Sin salida (ni siquiera texto plano): esto no es información nueva para
  // el modelo, y cualquier `hookSpecificOutput` acá dispararía otra vuelta de
  // turno con el mismo mensaje en cada Stop mientras el diff no cambie.
  if (isDiffAlreadyReviewed(diffHash, hashFile)) return;

  if (!process.env.OPENAI_API_KEY) return;

  const prompt = `
Actúa como senior code reviewer estilo Codex para factura-eletronica.app.

NO eres el QA de negocio. Tu foco es calidad de código.

Revisa el diff buscando:
- bugs lógicos
- errores TypeScript
- errores async/await
- imports rotos
- código muerto
- duplicación
- mala separación de responsabilidades
- validaciones faltantes
- errores de manejo de estado
- problemas de rendimiento
- tests débiles o ausentes
- APIs frágiles
- edge cases no cubiertos

No bloquees por preferencias menores. Sé práctico.

Devuelve SOLO JSON válido:

{
  "veredicto": "APROBADO" | "NECESITA_CAMBIOS" | "BLOQUEADO",
  "resumen": "string corto",
  "bloqueantes": ["string"],
  "importantes": ["string"],
  "sugerencias": ["string"],
  "tests_recomendados": ["string"],
  "prompt_para_claude": "instrucciones concretas para corregir"
}

Usa BLOQUEADO solo para bugs claros que romperían build, datos, seguridad o flujo crítico.
Usa NECESITA_CAMBIOS para problemas importantes pero corregibles.
Usa APROBADO si el código está razonable.

=== CLAUDE.md ===
${read("CLAUDE.md", 30000)}

=== PACKAGE.JSON ===
${read("package.json", 20000)}

=== DIFF ===
${truncateWithNotice(currentDiff, DIFF_CHAR_LIMIT)}
`;

  const text = await callOpenAI(prompt);
  let result = parseJson(text);

  if (!result) {
    result = {
      veredicto: "NECESITA_CAMBIOS",
      resumen: "Code review no devolvió JSON válido.",
      bloqueantes: [],
      importantes: ["Respuesta no parseable."],
      sugerencias: [],
      tests_recomendados: [],
      prompt_para_claude: text.slice(0, 3000),
    };
  }

  mkdirSync(".claude/code-review-reports", { recursive: true });

  const reportFile = `.claude/code-review-reports/${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  writeFileSync(reportFile, JSON.stringify(result, null, 2), "utf8");

  // Se marca como "revisado" sin importar el veredicto (dedup por diff, no
  // por resultado) — si el diff no cambia, repreguntarle a OpenAI lo mismo en
  // cada Stop no aporta nada nuevo. Cuando el diff cambie de verdad, el hash
  // deja de matchear y vuelve a correr solo. La única excepción es si el diff
  // se truncó: ahí la revisión fue incompleta y no debe marcarse como vista.
  if (shouldPersistReviewHash(result.veredicto, isTruncated(currentDiff, DIFF_CHAR_LIMIT))) {
    writeFileSync(hashFile, diffHash, "utf8");
  }

  // MODO SILENCIOSO (decisión del dueño del producto): el reporte completo queda
  // SOLO en el archivo JSON de arriba — NO se imprime nada al chat para
  // APROBADO ni NECESITA_CAMBIOS (el dueño del producto no quiere ver el feedback del hook en
  // la conversación; el orquestador revisa los reportes pendientes en
  // .claude/code-review-reports/ antes de cada commit). ÚNICA excepción:
  // BLOQUEADO (bug crítico que rompería build/datos/seguridad/flujo) sí
  // bloquea el Stop con el detalle — es exactamente la categoría de hallazgo
  // que la regla del dueño del producto pide escalar.
  if (result.veredicto === "BLOQUEADO") {
    const feedback = `
CODE REVIEW OPENAI: BLOQUEADO

Resumen:
${result.resumen}

Bloqueantes:
${(result.bloqueantes || []).map(x => `- ${x}`).join("\n") || "- Ninguno"}

Instrucciones para Claude:
${result.prompt_para_claude || "Sin instrucciones."}

Reporte completo:
${reportFile}
`.trim();

    console.log(JSON.stringify({
      decision: "block",
      reason: feedback,
      hookSpecificOutput: {
        hookEventName: "Stop",
        additionalContext: feedback
      }
    }));
  }
}

main().catch(error => {
  // También silencioso ante errores (misma decisión del dueño del producto): un fallo del
  // hook (API caída, timeout, etc.) no debe ensuciar el chat — queda en un
  // log que el orquestador puede revisar si nota que dejaron de generarse
  // reportes nuevos.
  try {
    mkdirSync(".claude/code-review-reports", { recursive: true });
    writeFileSync(
      ".claude/code-review-reports/errores.log",
      `${new Date().toISOString()} — ${error.message}\n`,
      { flag: "a" }
    );
  } catch { /* nada: mejor perder el log que romper el Stop */ }
});
