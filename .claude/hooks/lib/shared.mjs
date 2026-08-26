import { existsSync, readFileSync, lstatSync } from "node:fs";
import crypto from "node:crypto";

export function readFile(file, max = 60000) {
  if (!existsSync(file)) return "";
  return readFileSync(file, "utf8").slice(0, max);
}

/**
 * Claude Code re-dispara un Stop hook cuando este emite `hookSpecificOutput`
 * (el hook "tiene algo que decir" y eso cuenta como una vuelta más de turno).
 * Si el hook sigue emitiendo lo mismo cada vez (ej. "ya revisado, sin
 * cambios"), esto genera un loop: Stop → hook habla → nueva vuelta → Stop de
 * nuevo → mismo mensaje → ad infinitum, hasta que Claude Code lo corta a la
 * fuerza ("A hook blocked the turn from ending N consecutive times"). El
 * campo `stop_hook_active` en el JSON de stdin es `true` cuando este Stop ya
 * es una repetición disparada por un hook anterior — en ese caso hay que
 * devolver éxito sin volver a emitir nada, o el loop nunca termina solo.
 */
export function readHookInput(stdinFd = 0) {
  try {
    return JSON.parse(readFileSync(stdinFd, "utf8"));
  } catch {
    return {};
  }
}

/**
 * Un placeholder CONSTANTE (ej. "[contenido omitido: lockfile]") hace que dos
 * cambios reales distintos de ese archivo produzcan el mismo texto redactado
 * → mismo hash de dedup → el segundo cambio se saltearía como "ya revisado"
 * aunque el contenido real (ej. una versión de dependencia distinta) sea
 * diferente. El fingerprint es un hash corto del contenido REAL: nunca se
 * manda ese contenido a OpenAI, pero el hash de dedup sí varía si cambia.
 */
export function contentFingerprint(text) {
  return crypto.createHash("sha256").update(text).digest("hex").slice(0, 12);
}

/**
 * Lee el archivo COMPLETO como Buffer para el fingerprint — a propósito
 * separado de `readFile()` (que trunca a `max` para el prompt). Si el
 * fingerprint se calculara sobre contenido truncado, dos archivos distintos
 * que solo difieran después del corte producirían el mismo fingerprint y
 * colisionarían en el dedup — exactamente lo que el fingerprint existe para
 * evitar. Para los tamaños reales de este repo (lockfiles de cientos de KB,
 * assets chicos) leer completo en memoria es aceptable; no vale la pena la
 * complejidad de un hash por streaming para un hook que corre una vez por Stop.
 */
export function readFileBuffer(file) {
  return readFileSync(file);
}

/**
 * `currentDiff.slice(0, N)` corta el texto en silencio: si el diff completo
 * (tracked + untracked) supera N caracteres, todo lo que venga después del
 * corte — archivos enteros incluidos — nunca llega al prompt, y el reviewer
 * reporta "este archivo no está en el diff" sin que sea mentira: literalmente
 * no lo vio. Pasó de verdad con un diff de 177958 caracteres donde componentes
 * completos quedaban después del corte de 100000/120000. Esta función deja
 * un aviso explícito en vez de cortar en silencio.
 */
export const DIFF_CHAR_LIMIT = 300000;

export function truncateWithNotice(text, max) {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n[DIFF TRUNCADO: había ${text.length} caracteres, se cortó a ${max}. Si algo parece faltar, es por este corte — no asumas que el archivo no existe.]`;
}

export function isTruncated(text, max) {
  return text.length > max;
}

const VALID_VEREDICTOS = new Set(["APROBADO", "NECESITA_CAMBIOS", "BLOQUEADO"]);

export function isValidVeredicto(veredicto) {
  return VALID_VEREDICTOS.has(veredicto);
}

/**
 * El dedup depende de si el DIFF cambió, no de CUÁL fue el veredicto (ver
 * más abajo por qué). Pero sí depende de que la revisión haya sido
 * *confiable*: si OpenAI devolvió JSON sin `veredicto` o con un valor que no
 * es ninguno de los tres esperados, esa revisión no es confiable y no debe
 * marcarse como "ya vista" — la próxima vez tiene que reintentar de verdad
 * en lugar de quedar pegada a un resultado basura.
 *
 * Dicho esto: mientras el veredicto SEA válido, persistir solo en APROBADO
 * sonaba prudente (no silenciar un NECESITA_CAMBIOS sin resolver), pero en la
 * práctica generaba un loop: mientras el diff no cambie y el veredicto siga
 * en NECESITA_CAMBIOS (ej. porque la observación es una decisión de negocio
 * pendiente, no algo para tocar en código), el hook volvía a llamar a OpenAI
 * y repetía el mismo reporte en CADA Stop, sin aportar nada nuevo. Si el
 * humano ya vio el feedback y el diff es idéntico, no hay razón para
 * repetirlo — cuando el diff cambie de verdad, el hash deja de matchear y
 * vuelve a correr solo.
 */
export function shouldPersistReviewHash(veredicto, truncated = false) {
  return isValidVeredicto(veredicto) && !truncated;
}

export function parseEnvLocal(content) {
  const vars = {};
  for (const line of content.split(/\r?\n/)) {
    const m = line.match(/^\s*OPENAI_[A-Z_]+\s*=\s*(.*)\s*$/);
    if (m) {
      const key = line.split("=")[0].trim();
      // (.*) es greedy y se traga espacios finales antes de que \s*$ los pueda
      // matchear en 0 repeticiones — hay que trimear a mano.
      vars[key] = m[1].trim().replace(/^["']|["']$/g, "");
    }
  }
  return vars;
}

/**
 * Carga variables OPENAI_* de .env.local hacia `env` sin pisar las que ya existan.
 * No falla si envPath no existe.
 */
export function loadEnvLocal(env = process.env, envPath = ".env.local") {
  if (!existsSync(envPath)) return;
  const vars = parseEnvLocal(readFile(envPath, 20000));
  for (const [key, value] of Object.entries(vars)) {
    if (env[key]) continue;
    env[key] = value;
  }
}

export function shouldRunQa(files) {
  if (!files.trim()) return false;

  return files
    .split(/\r?\n/)
    .map((x) => x.replaceAll("\\", "/"))
    .some(
      (file) =>
        file === "CLAUDE.md" ||
        file.startsWith("docs/") ||
        file.startsWith("src/") ||
        file.startsWith("app/") ||
        file.startsWith("lib/") ||
        file.startsWith("components/") ||
        file.startsWith("apps/") ||
        file.startsWith("supabase/") ||
        file.startsWith(".claude/agents/") ||
        file.startsWith(".claude/hooks/") ||
        file === "package.json" ||
        file === "package-lock.json" ||
        file.endsWith("/package.json") ||
        file.endsWith("/package-lock.json") ||
        file.startsWith("middleware.")
    );
}

/**
 * El hash se escribe con writeFileSync sin salto de línea; se hace trim() del
 * lado del archivo por si quedó un "\n" colgado (ej. alguien lo abrió con un
 * editor), pero NO se hace trim() del diffHash recibido — ese siempre viene
 * limpio de crypto.createHash(...).digest("hex").
 */
export function isDiffAlreadyReviewed(diffHash, hashFile) {
  return existsSync(hashFile) && readFileSync(hashFile, "utf8").trim() === diffHash;
}

/**
 * Nunca hay que mandarle a OpenAI el CONTENIDO de secretos ni de binarios
 * (serían basura como texto, y en el caso de secretos, una fuga real). Esto
 * es una segunda capa además de .gitignore — no confiar en que todo secreto
 * ya esté ignorado. El NOMBRE del archivo sí se sigue mostrando (en
 * shouldRunQa y en el placeholder de buildFullDiff): que se agregó un
 * binario o un .env es información útil para el reviewer, la fuga real
 * sería mandar el contenido.
 */
const SENSITIVE_FILENAME_RE = /^\.env(\..+)?$/;
const SENSITIVE_NAME_RE = /^(credentials\.json|service-account.*\.json|secrets?\..*|.*\.secret\..*|\.npmrc)$/i;
// "token" a secas da falsos positivos (design-tokens.ts, tokens.ts) — solo
// cuenta si va calificado como credencial (auth-token, access_token, etc.)
const SENSITIVE_KEYWORD_RE = /(service[_-]?role|(?:auth|access|refresh|api|secret)[_-]?token)/i;
const SENSITIVE_EXT_RE = /\.(pem|key|p12|pfx|crt|cer|der)$/i;
const BINARY_EXT_RE =
  /\.(png|jpe?g|gif|webp|ico|bmp|pdf|zip|gz|tgz|7z|woff2?|ttf|eot|otf|mp4|mov|avi|mp3|wav|sqlite|db)$/i;

export function isSensitivePath(file) {
  const base = file.split("/").pop() || "";
  if (base === ".env.example") return false;
  if (SENSITIVE_FILENAME_RE.test(base)) return true;
  if (/^id_rsa/.test(base)) return true;
  if (SENSITIVE_NAME_RE.test(base)) return true;
  if (SENSITIVE_KEYWORD_RE.test(base)) return true;
  return SENSITIVE_EXT_RE.test(base);
}

export function isBinaryLikePath(file) {
  return BINARY_EXT_RE.test(file);
}

/**
 * Lockfiles son generados, mecánicos y enormes (nuestro package-lock.json
 * mide ~260KB) — un reviewer de código no necesita leerlos línea por línea,
 * y dejarlos en el diff completo desperdicia el presupuesto de caracteres
 * que sí hace falta para el código fuente real. Pasó de verdad: el lockfile
 * consumía 123527 de 148820 caracteres del diff trackeado (63%) y empujaba
 * los archivos de código hacia el corte de `truncateWithNotice`.
 */
const LOCKFILE_RE = /^(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml)$/i;

export function isLockfile(file) {
  const base = file.split("/").pop() || "";
  return LOCKFILE_RE.test(base);
}

/**
 * Un untracked "inocuo" podría ser un symlink apuntando a un secreto FUERA
 * del repo (ej. ~/.ssh/id_rsa con un nombre de archivo cualquiera). lstat
 * (a diferencia de stat/readFileSync) NO sigue el symlink, así que detecta
 * este caso antes de leer contenido. También cubre otros no-regulares
 * (FIFOs, devices) que no tiene sentido leer como texto.
 */
export function isRegularFile(file, lstatFn = lstatSync) {
  try {
    return lstatFn(file).isFile();
  } catch {
    return false;
  }
}

// 60000 y no 20000: una migración SQL o suite pgTAP real supera fácil los 20k
// (medido: 21.7k y 29k en la tarea 1.1) y el reviewer externo recibía el
// archivo cortado — reportó "migración incompleta" como bloqueante siendo un
// falso positivo del hook. El presupuesto total (DIFF_CHAR_LIMIT = 300000)
// sigue protegido por truncateWithNotice.
const MAX_UNTRACKED_FILE_CHARS = 60000;

/**
 * git diff --name-only / git diff -- . NO incluyen archivos sin trackear
 * (untracked). Como esta suite crea/mueve archivos nuevos todo el tiempo
 * (ej. este mismo shared.mjs), hay que sumarlos a mano o el reviewer externo
 * termina revisando un diff incompleto y quejándose de "archivos que no
 * aparecen en el diff" — que es justamente lo que pasó.
 *
 * `run` se inyecta (en vez de importar child_process acá) para que esta
 * lógica sea testeable sin invocar git de verdad.
 */
export function listUntrackedFiles(run) {
  const out = run("git ls-files --others --exclude-standard");
  return out
    .split(/\r?\n/)
    .map((f) => f.trim())
    .filter(Boolean);
}

/**
 * `git diff --name-only`/`git diff -- .` solo comparan working tree vs índice
 * (unstaged). Si hay cambios ya con `git add`, quedan afuera. `git diff HEAD`
 * compara directo contra el último commit y cubre staged + unstaged en un
 * solo comando.
 */
export function buildChangedFilesList(run) {
  const tracked = run("git diff --name-only HEAD");
  const untracked = listUntrackedFiles(run).join("\n");
  return [tracked, untracked].filter(Boolean).join("\n");
}

/**
 * Separa un diff unificado (`git diff ...`) en un bloque de texto por archivo,
 * cada uno empezando en su línea "diff --git a/... b/...". Se procesa como
 * texto plano (no se interpola ningún nombre de archivo en un comando de
 * shell) para redactar el contenido de archivos sensibles/binarios AUNQUE
 * ya estén trackeados o en el índice — `isSensitivePath`/`isBinaryLikePath`
 * solo se aplicaban antes a los untracked; un secreto ya trackeado (ej. con
 * `git add -f`) igual pasaba completo por `git diff HEAD -- .`.
 */
/**
 * `git diff` para archivos binarios no imprime el contenido, solo
 * "Binary files a/x and b/x differ" — ese texto es IDÉNTICO sin importar
 * cuánto cambió el binario, así que hashear `segLines.join("\n")` para
 * fingerprint colisiona entre dos cambios reales distintos del mismo binario
 * trackeado. La línea "index <antes>..<después> <modo>" del diff SÍ tiene los
 * hashes de blob de git (que son, por definición, distintos si el contenido
 * es distinto) — usar eso en vez de hashear el texto plano del segmento.
 */
function extractIndexHashes(segLines) {
  for (const line of segLines) {
    const m = line.match(/^index\s+(\S+)\.\.(\S+)/);
    if (m) return `${m[1]}..${m[2]}`;
  }
  return null;
}

export function redactSensitiveDiffSegments(diffText) {
  if (!diffText.trim()) return diffText;

  const lines = diffText.split(/\r?\n/);
  const segments = [];
  let current = null;
  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      if (current) segments.push(current);
      current = [line];
    } else if (current) {
      current.push(line);
    } else {
      // contenido antes del primer header (no debería pasar con git diff real)
      current = [line];
    }
  }
  if (current) segments.push(current);

  return segments
    .map((segLines) => {
      const header = segLines[0];
      const m = header.match(/^diff --git a\/(.+?) b\/(.+)$/);
      // Un rename de/hacia un nombre sensible (ej. .env.local -> config.txt,
      // o al revés) debe redactarse igual: revisar AMBOS lados del header,
      // no solo el destino.
      const fromFile = m ? m[1] : null;
      const toFile = m ? m[2] : null;
      const eitherIsSensitive = [fromFile, toFile].some((f) => f && isSensitivePath(f));
      const eitherIsBinary = [fromFile, toFile].some((f) => f && isBinaryLikePath(f));
      const eitherIsLockfile = [fromFile, toFile].some((f) => f && isLockfile(f));
      // Sin fingerprint para sensibles: un hash (aunque corto) de un secreto de
      // baja entropía es un oráculo real para fuerza bruta/diccionario. Para
      // binarios y lockfiles el contenido no es confidencial, así que el
      // fingerprint ahí solo sirve para no romper el dedup (ver aprendizaje).
      if (eitherIsSensitive) {
        return `${header}\n[contenido omitido: nombre sugiere secreto/credencial]`;
      }
      // Preferir los hashes de blob de la línea "index a..b" (garantizados
      // distintos si el contenido lo es) sobre hashear el texto del segmento
      // — para binarios ese texto suele ser un "Binary files ... differ"
      // fijo que no refleja el contenido real que cambió.
      const fingerprintSource = extractIndexHashes(segLines) || segLines.join("\n");
      if (eitherIsBinary) {
        return `${header}\n[contenido omitido: binario] [fingerprint: ${contentFingerprint(fingerprintSource)}]`;
      }
      if (eitherIsLockfile) {
        return `${header}\n[contenido omitido: lockfile generado — no es código fuente, revisar el package.json correspondiente para ver qué dependencia cambió] [fingerprint: ${contentFingerprint(fingerprintSource)}]`;
      }
      return segLines.join("\n");
    })
    .join("\n");
}

export function buildFullDiff(run, readFn, lstatFn = lstatSync, hashReadFn = readFileBuffer) {
  const tracked = redactSensitiveDiffSegments(run("git diff HEAD -- ."));
  const untrackedBlocks = listUntrackedFiles(run).map((file) => {
    // El chequeo de symlink va primero: si no es un archivo regular, nunca se
    // lee contenido (ni para mostrarlo ni para el fingerprint) — podría estar
    // apuntando a un secreto fuera del repo.
    if (!isRegularFile(file, lstatFn)) {
      return `diff --git a/${file} b/${file}\nnew file (untracked) — contenido omitido: no es un archivo regular (symlink u otro)`;
    }

    // Sin fingerprint para sensibles (ver comentario en redactSensitiveDiffSegments):
    // un hash de un secreto de baja entropía es un oráculo real. Ni siquiera se lee
    // el archivo en este caso — no hace falta su contenido para nada.
    if (isSensitivePath(file)) {
      return `diff --git a/${file} b/${file}\nnew file (untracked) — contenido omitido: nombre sugiere secreto/credencial`;
    }

    const binary = isBinaryLikePath(file);
    const lockfile = isLockfile(file);

    if (binary || lockfile) {
      // Fingerprint sobre el contenido COMPLETO (hashReadFn), no sobre lo
      // truncado a MAX_UNTRACKED_FILE_CHARS — si no, dos archivos que difieran
      // después del corte colisionarían al mismo fingerprint.
      const reason = binary ? "binario" : "lockfile generado";
      return `diff --git a/${file} b/${file}\nnew file (untracked) — contenido omitido: ${reason} [fingerprint: ${contentFingerprint(hashReadFn(file))}]`;
    }

    const raw = readFn(file, MAX_UNTRACKED_FILE_CHARS);
    // El fingerprint del contenido COMPLETO en el aviso de truncado no es
    // cosmético: el hash de dedup se calcula sobre este texto, y sin él dos
    // versiones del archivo que solo difieran DESPUÉS del corte producirían
    // el mismo hash → el cambio nuevo se marcaría como "ya revisado". Seguro
    // de fingerprinear: los sensibles ya salieron por el early-return de arriba.
    const content = raw.length >= MAX_UNTRACKED_FILE_CHARS
      ? `${raw}\n[TRUNCADO a ${MAX_UNTRACKED_FILE_CHARS} caracteres — el archivo completo existe en el repo; fingerprint del contenido completo: ${contentFingerprint(hashReadFn(file))}]`
      : raw;
    return `diff --git a/${file} b/${file}\nnew file (untracked)\n--- /dev/null\n+++ b/${file}\n${content}`;
  });
  return [tracked, ...untrackedBlocks].filter(Boolean).join("\n\n");
}
