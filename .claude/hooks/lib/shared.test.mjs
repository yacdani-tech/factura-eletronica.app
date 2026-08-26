import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseEnvLocal,
  loadEnvLocal,
  shouldRunQa,
  isDiffAlreadyReviewed,
  listUntrackedFiles,
  buildChangedFilesList,
  buildFullDiff,
  isSensitivePath,
  isBinaryLikePath,
  redactSensitiveDiffSegments,
  shouldPersistReviewHash,
  isValidVeredicto,
  isRegularFile,
  truncateWithNotice,
  isTruncated,
  isLockfile,
  contentFingerprint,
} from "./shared.mjs";

test("parseEnvLocal: extrae solo variables OPENAI_* y les quita comillas", () => {
  const content = [
    'OPENAI_API_KEY="sk-abc123"',
    "OPENAI_QA_MODEL=gpt-5.5",
    "OTRA_VAR=no-deberia-aparecer",
    "# comentario",
    "",
  ].join("\n");

  assert.deepEqual(parseEnvLocal(content), {
    OPENAI_API_KEY: "sk-abc123",
    OPENAI_QA_MODEL: "gpt-5.5",
  });
});

test("parseEnvLocal: contenido vacío da objeto vacío", () => {
  assert.deepEqual(parseEnvLocal(""), {});
});

test("parseEnvLocal: recorta espacios finales en el valor (regex greedy no lo hacía)", () => {
  assert.deepEqual(parseEnvLocal("OPENAI_API_KEY=sk-abc123   "), {
    OPENAI_API_KEY: "sk-abc123",
  });
  assert.deepEqual(parseEnvLocal('OPENAI_API_KEY="sk-abc123"   '), {
    OPENAI_API_KEY: "sk-abc123",
  });
});

test("loadEnvLocal: no falla si el archivo no existe", () => {
  const env = {};
  assert.doesNotThrow(() => loadEnvLocal(env, join(tmpdir(), "no-existe-" + Date.now() + ".local")));
  assert.deepEqual(env, {});
});

test("loadEnvLocal: carga variables OPENAI_* sin pisar las ya seteadas", () => {
  const dir = mkdtempSync(join(tmpdir(), "hooks-test-"));
  const envPath = join(dir, ".env.local");
  writeFileSync(envPath, 'OPENAI_API_KEY="sk-desde-archivo"\nOPENAI_QA_MODEL=gpt-5.5\n', "utf8");

  const env = { OPENAI_API_KEY: "sk-ya-seteada" };
  loadEnvLocal(env, envPath);

  assert.equal(env.OPENAI_API_KEY, "sk-ya-seteada", "no debe sobrescribir una var ya presente");
  assert.equal(env.OPENAI_QA_MODEL, "gpt-5.5", "debe cargar vars nuevas");

  rmSync(dir, { recursive: true, force: true });
});

test("shouldRunQa: dispara para rutas de la app (raíz y monorepo)", () => {
  for (const file of [
    "CLAUDE.md",
    "docs/PLAN_MVP.md",
    "app/page.tsx",
    "lib/utils.ts",
    "components/ui/button.tsx",
    "apps/web/app/page.tsx",
    "apps/landing/app/page.tsx",
    "apps/web/lib/supabase/client.ts",
    "supabase/migrations/0001_init.sql",
    ".claude/agents/motor-calculo.md",
    ".claude/hooks/openai-qa.mjs",
    ".claude/hooks/lib/shared.mjs",
    "package.json",
    "package-lock.json",
    "apps/web/package.json",
    "apps/web/package-lock.json",
    "middleware.ts",
  ]) {
    assert.equal(shouldRunQa(file), true, `esperaba true para ${file}`);
  }
});

test("shouldRunQa: no dispara para archivos irrelevantes", () => {
  for (const file of ["README.md", "node_modules/foo/index.js", ".gitignore", "apps.txt"]) {
    assert.equal(shouldRunQa(file), false, `esperaba false para ${file}`);
  }
});

test("shouldRunQa: string vacío no dispara", () => {
  assert.equal(shouldRunQa(""), false);
  assert.equal(shouldRunQa("   \n  "), false);
});

test("isDiffAlreadyReviewed: true con match exacto, y también si el archivo tiene un salto de línea colgado", () => {
  const dir = mkdtempSync(join(tmpdir(), "hooks-test-"));
  const hashFile = join(dir, "last-reviewed.txt");
  const hash = "abc123";
  writeFileSync(hashFile, hash, "utf8");

  assert.equal(isDiffAlreadyReviewed(hash, hashFile), true);
  assert.equal(isDiffAlreadyReviewed("otro-hash", hashFile), false);

  writeFileSync(hashFile, hash + "\n", "utf8");
  assert.equal(isDiffAlreadyReviewed(hash, hashFile), true, "un \\n colgado en el archivo no debe romper el match");

  rmSync(dir, { recursive: true, force: true });
});

test("isDiffAlreadyReviewed: false si el archivo de hash no existe", () => {
  assert.equal(
    isDiffAlreadyReviewed("cualquier-hash", join(tmpdir(), "no-existe-" + Date.now() + ".txt")),
    false
  );
});

test("shouldPersistReviewHash: persiste con cualquier veredicto VÁLIDO — el dedup es por diff, no por resultado (evita re-preguntarle a OpenAI lo mismo en cada Stop si nada cambió)", () => {
  assert.equal(shouldPersistReviewHash("APROBADO"), true);
  assert.equal(shouldPersistReviewHash("NECESITA_CAMBIOS"), true);
  assert.equal(shouldPersistReviewHash("BLOQUEADO"), true);
});

test("shouldPersistReviewHash: NO persiste si el veredicto es inválido/ausente (respuesta de OpenAI no confiable, no hay que darla por 'ya vista')", () => {
  assert.equal(shouldPersistReviewHash(undefined), false);
  assert.equal(shouldPersistReviewHash(""), false);
  assert.equal(shouldPersistReviewHash("aprobado"), false, "case-sensitive, no matchea variantes en minúscula");
  assert.equal(shouldPersistReviewHash("YOLO"), false);
});

test("isValidVeredicto: solo acepta los 3 valores esperados", () => {
  assert.equal(isValidVeredicto("APROBADO"), true);
  assert.equal(isValidVeredicto("NECESITA_CAMBIOS"), true);
  assert.equal(isValidVeredicto("BLOQUEADO"), true);
  assert.equal(isValidVeredicto(undefined), false);
  assert.equal(isValidVeredicto("otra-cosa"), false);
});

test("shouldPersistReviewHash: NUNCA persiste si el diff se truncó (la revisión fue incompleta, sin importar el veredicto)", () => {
  assert.equal(shouldPersistReviewHash("APROBADO", true), false);
  assert.equal(shouldPersistReviewHash("BLOQUEADO", true), false);
  assert.equal(shouldPersistReviewHash("APROBADO", false), true);
});

test("isSensitivePath: detecta .env*, claves, certificados y nombres típicos de credenciales, pero no .env.example", () => {
  for (const file of [
    ".env",
    ".env.local",
    ".env.production",
    "apps/web/.env.local",
    "id_rsa",
    "server.pem",
    "cert.key",
    "app.p12",
    "site.crt",
    "credentials.json",
    "service-account-prod.json",
    "secrets.yaml",
    "config.secret.json",
    ".npmrc",
    "supabase-service-role-key.txt",
    "auth-token.json",
    "access_token.txt",
    "api-token.json",
  ]) {
    assert.equal(isSensitivePath(file), true, `esperaba true para ${file}`);
  }
  for (const file of [".env.example", "apps/web/.env.example", "app/page.tsx"]) {
    assert.equal(isSensitivePath(file), false, `esperaba false para ${file}`);
  }
});

test("isSensitivePath: 'token' a secas NO dispara falso positivo (design tokens, etc.)", () => {
  for (const file of ["design-tokens.ts", "tokens.ts", "lib/tokens/colors.ts"]) {
    assert.equal(isSensitivePath(file), false, `esperaba false para ${file}`);
  }
});

test("isBinaryLikePath: detecta extensiones binarias comunes", () => {
  for (const file of ["logo.png", "photo.jpg", "doc.pdf", "archive.zip", "font.woff2"]) {
    assert.equal(isBinaryLikePath(file), true, `esperaba true para ${file}`);
  }
  for (const file of ["icon.svg", "app/page.tsx", "styles.css"]) {
    assert.equal(isBinaryLikePath(file), false, `esperaba false para ${file}`);
  }
});

test("listUntrackedFiles: parsea la salida de git ls-files, ignora líneas vacías", () => {
  const fakeRun = () => "apps/landing/package.json\napps/web/package.json\n\n";
  assert.deepEqual(listUntrackedFiles(fakeRun), ["apps/landing/package.json", "apps/web/package.json"]);
});

test("listUntrackedFiles: salida vacía da array vacío", () => {
  assert.deepEqual(listUntrackedFiles(() => ""), []);
});

test("listUntrackedFiles: NO filtra nombres — la lista de archivos es solo visibilidad, no expone contenido", () => {
  const fakeRun = () => "apps/web/.env.local\napps/web/lib/utils.ts\nlogo.png\nserver.pem\n";
  assert.deepEqual(listUntrackedFiles(fakeRun), [
    "apps/web/.env.local",
    "apps/web/lib/utils.ts",
    "logo.png",
    "server.pem",
  ]);
});

test("buildChangedFilesList: combina staged+unstaged (git diff --name-only HEAD) y untracked (git ls-files)", () => {
  const fakeRun = (cmd) => {
    if (cmd === "git diff --name-only HEAD") return "CLAUDE.md\ndocs/PROGRESO.md";
    if (cmd === "git ls-files --others --exclude-standard") return "apps/landing/package.json";
    throw new Error(`comando inesperado: ${cmd}`);
  };
  assert.equal(buildChangedFilesList(fakeRun), "CLAUDE.md\ndocs/PROGRESO.md\napps/landing/package.json");
});

test("buildFullDiff: usa git diff HEAD (staged+unstaged) y agrega untracked que git diff normal no muestra", () => {
  const fakeRun = (cmd) => {
    if (cmd === "git diff HEAD -- .") return "diff --git a/CLAUDE.md b/CLAUDE.md\n+una línea";
    if (cmd === "git ls-files --others --exclude-standard") return "apps/landing/package.json";
    throw new Error(`comando inesperado: ${cmd}`);
  };
  const fakeRead = (file) => (file === "apps/landing/package.json" ? '{"name":"casilleros-landing"}' : "");
  const fakeLstat = () => ({ isFile: () => true });

  const result = buildFullDiff(fakeRun, fakeRead, fakeLstat);

  assert.match(result, /CLAUDE\.md/);
  assert.match(result, /apps\/landing\/package\.json/);
  assert.match(result, /casilleros-landing/, "debe incluir el contenido real del archivo untracked");
});

test("buildFullDiff: para sensibles/binarios muestra el NOMBRE con un placeholder, pero nunca el contenido", () => {
  const fakeRun = (cmd) => {
    if (cmd === "git diff HEAD -- .") return "";
    if (cmd === "git ls-files --others --exclude-standard") return "apps/web/.env.local\nlogo.png";
    throw new Error(`comando inesperado: ${cmd}`);
  };
  const fakeRead = () => "CONTENIDO-SECRETO-O-BINARIO";
  const fakeLstat = () => ({ isFile: () => true });
  const fakeHashRead = () => Buffer.from("CONTENIDO-SECRETO-O-BINARIO");

  const result = buildFullDiff(fakeRun, fakeRead, fakeLstat, fakeHashRead);

  assert.match(result, /apps\/web\/\.env\.local/, "el nombre del archivo sensible sí debe verse");
  assert.match(result, /logo\.png/, "el nombre del binario sí debe verse");
  assert.doesNotMatch(result, /CONTENIDO-SECRETO-O-BINARIO/, "el contenido nunca debe aparecer");
  assert.match(result, /contenido omitido/i);
});

test("redactSensitiveDiffSegments: redacta el contenido de un archivo sensible/binario TRACKEADO o STAGED (no solo untracked)", () => {
  const diffText = [
    "diff --git a/app/page.tsx b/app/page.tsx",
    "index abc..def 100644",
    "--- a/app/page.tsx",
    "+++ b/app/page.tsx",
    "@@ -1,1 +1,1 @@",
    "-vieja línea",
    "+línea normal, no sensible",
    "diff --git a/apps/web/.env.local b/apps/web/.env.local",
    "index 000..111 100644",
    "--- a/apps/web/.env.local",
    "+++ b/apps/web/.env.local",
    "@@ -0,0 +1,1 @@",
    "+OPENAI_API_KEY=sk-super-secreta-de-verdad",
    "diff --git a/public/logo.png b/public/logo.png",
    "Binary files a/public/logo.png and b/public/logo.png differ",
  ].join("\n");

  const result = redactSensitiveDiffSegments(diffText);

  assert.match(result, /línea normal, no sensible/, "el diff no sensible se conserva completo");
  assert.doesNotMatch(result, /sk-super-secreta-de-verdad/, "el secreto TRACKEADO nunca debe aparecer");
  assert.match(result, /apps\/web\/\.env\.local/, "el nombre del archivo sensible sigue visible");
  assert.match(result, /contenido omitido: nombre sugiere secreto/i);
  assert.match(result, /contenido omitido: binario/i);
});

test("redactSensitiveDiffSegments: los archivos SENSIBLES nunca llevan fingerprint (un hash de un secreto de baja entropía es un oráculo de fuerza bruta) — binarios y lockfiles sí", () => {
  const diffText = [
    "diff --git a/apps/web/.env.local b/apps/web/.env.local",
    "+OPENAI_API_KEY=sk-super-secreta",
    "diff --git a/public/logo.png b/public/logo.png",
    "Binary files a/public/logo.png and b/public/logo.png differ",
    "diff --git a/package-lock.json b/package-lock.json",
    '+"lodash": "4.17.21"',
  ].join("\n");

  const result = redactSensitiveDiffSegments(diffText);
  const sensitiveBlock = result.split("diff --git a/public/logo.png")[0];
  const binaryBlock = result.split("diff --git a/public/logo.png")[1].split("diff --git a/package-lock.json")[0];
  const lockfileBlock = result.split("diff --git a/package-lock.json")[1];

  assert.doesNotMatch(sensitiveBlock, /fingerprint/i, "un secreto no debe llevar fingerprint derivado de su contenido");
  assert.match(binaryBlock, /fingerprint/i, "un binario sí puede llevar fingerprint (no es confidencial)");
  assert.match(lockfileBlock, /fingerprint/i, "un lockfile sí puede llevar fingerprint (no es confidencial)");
});

test("buildFullDiff: un archivo sensible untracked ni siquiera se lee (no hace falta su contenido para nada, ni para fingerprint)", () => {
  const fakeRun = (cmd) => {
    if (cmd === "git diff HEAD -- .") return "";
    if (cmd === "git ls-files --others --exclude-standard") return "apps/web/.env.local";
    throw new Error(`comando inesperado: ${cmd}`);
  };
  let readCalled = false;
  const fakeRead = () => {
    readCalled = true;
    return "OPENAI_API_KEY=sk-super-secreta";
  };
  const fakeLstat = () => ({ isFile: () => true });

  const result = buildFullDiff(fakeRun, fakeRead, fakeLstat);

  assert.equal(readCalled, false, "no debería llamarse readFn para un archivo sensible");
  assert.doesNotMatch(result, /fingerprint/i);
});

test("redactSensitiveDiffSegments: diff vacío se devuelve tal cual", () => {
  assert.equal(redactSensitiveDiffSegments(""), "");
});

test("buildFullDiff: redacta también un secreto que aparece en el diff TRACKEADO (git diff HEAD -- .), no solo untracked", () => {
  const fakeRun = (cmd) => {
    if (cmd === "git diff HEAD -- .") {
      return [
        "diff --git a/apps/web/.env.local b/apps/web/.env.local",
        "+OPENAI_API_KEY=sk-secreta-trackeada",
      ].join("\n");
    }
    if (cmd === "git ls-files --others --exclude-standard") return "";
    throw new Error(`comando inesperado: ${cmd}`);
  };

  const result = buildFullDiff(fakeRun, () => "");

  assert.doesNotMatch(result, /sk-secreta-trackeada/);
  assert.match(result, /apps\/web\/\.env\.local/);
});

test("buildFullDiff: marca cuando un archivo untracked se truncó, con fingerprint del contenido completo", () => {
  const bigContent = "x".repeat(60000);
  const fakeRun = (cmd) => {
    if (cmd === "git diff HEAD -- .") return "";
    if (cmd === "git ls-files --others --exclude-standard") return "apps/web/lib/big.ts";
    throw new Error(`comando inesperado: ${cmd}`);
  };
  const fakeRead = (_file, max) => bigContent.slice(0, max);
  const fakeLstat = () => ({ isFile: () => true });

  // Mismos primeros 60000 caracteres, cola distinta — sin fingerprint del
  // contenido completo, ambos producirían el mismo texto → mismo hash de
  // dedup → el segundo cambio se daría por "ya revisado".
  const resultA = buildFullDiff(fakeRun, fakeRead, fakeLstat, () => Buffer.from(bigContent + "cola-A"));
  const resultB = buildFullDiff(fakeRun, fakeRead, fakeLstat, () => Buffer.from(bigContent + "cola-B"));

  assert.match(resultA, /\[TRUNCADO a 60000 caracteres/);
  assert.match(resultA, /fingerprint del contenido completo: [0-9a-f]{12}\]/);
  assert.notEqual(resultA, resultB, "dos colas distintas después del corte no deben colisionar");
});

test("isRegularFile: false para symlinks/no-regulares o si lstat falla (no existe)", () => {
  assert.equal(isRegularFile("cualquier.txt", () => ({ isFile: () => true })), true);
  assert.equal(isRegularFile("un-symlink", () => ({ isFile: () => false })), false);
  assert.equal(
    isRegularFile("no-existe.txt", () => {
      throw new Error("ENOENT");
    }),
    false
  );
});

test("buildFullDiff: un untracked symlink/no-regular con nombre inocuo NO expone contenido", () => {
  const fakeRun = (cmd) => {
    if (cmd === "git diff HEAD -- .") return "";
    if (cmd === "git ls-files --others --exclude-standard") return "config.txt";
    throw new Error(`comando inesperado: ${cmd}`);
  };
  // nombre inocuo, pero es un symlink (probablemente apuntando fuera del repo)
  const fakeLstat = () => ({ isFile: () => false, isSymbolicLink: () => true });
  const fakeRead = () => "CONTENIDO-DEL-OBJETIVO-DEL-SYMLINK";

  const result = buildFullDiff(fakeRun, fakeRead, fakeLstat);

  assert.match(result, /config\.txt/, "el nombre sí debe verse");
  assert.doesNotMatch(result, /CONTENIDO-DEL-OBJETIVO-DEL-SYMLINK/, "nunca debe leer/exponer el contenido");
  assert.match(result, /no es un archivo regular/i);
});

test("redactSensitiveDiffSegments: un rename hacia un nombre sensible también se redacta (no solo desde)", () => {
  const diffText = [
    "diff --git a/config.txt b/apps/web/.env.local",
    "similarity index 100%",
    "rename from config.txt",
    "rename to apps/web/.env.local",
  ].join("\n");

  const result = redactSensitiveDiffSegments(diffText);

  assert.match(result, /contenido omitido: nombre sugiere secreto/i);
});

test("truncateWithNotice: texto corto pasa igual, sin aviso", () => {
  assert.equal(truncateWithNotice("hola", 100), "hola");
});

test("truncateWithNotice: texto largo se corta y avisa (así el reviewer no confunde el corte con 'archivo ausente')", () => {
  const text = "x".repeat(50);
  const result = truncateWithNotice(text, 10);

  assert.match(result, /^x{10}/);
  assert.match(result, /\[DIFF TRUNCADO/);
  assert.match(result, /había 50 caracteres, se cortó a 10/);
});

test("isTruncated: detecta si el texto excede el límite", () => {
  assert.equal(isTruncated("corto", 100), false);
  assert.equal(isTruncated("x".repeat(101), 100), true);
  assert.equal(isTruncated("x".repeat(100), 100), false);
});

test("isLockfile: detecta lockfiles comunes de cualquier ruta, no otros JSON/YAML", () => {
  for (const file of ["package-lock.json", "apps/web/package-lock.json", "yarn.lock", "pnpm-lock.yaml", "npm-shrinkwrap.json"]) {
    assert.equal(isLockfile(file), true, `esperaba true para ${file}`);
  }
  for (const file of ["package.json", "apps/web/package.json", "config.yaml", "data.json"]) {
    assert.equal(isLockfile(file), false, `esperaba false para ${file}`);
  }
});

test("redactSensitiveDiffSegments: redacta el contenido de un lockfile (generado, no es código fuente revisable)", () => {
  const diffText = [
    "diff --git a/app/page.tsx b/app/page.tsx",
    "+línea normal",
    "diff --git a/package-lock.json b/package-lock.json",
    "-\"lodash\": \"4.17.20\"",
    "+\"lodash\": \"4.17.21\"",
  ].join("\n");

  const result = redactSensitiveDiffSegments(diffText);

  assert.match(result, /línea normal/, "el diff de código fuente se conserva");
  assert.doesNotMatch(result, /lodash/, "el contenido del lockfile no debe aparecer");
  assert.match(result, /contenido omitido: lockfile generado/i);
});

test("buildFullDiff: un lockfile tracked no consume el presupuesto del diff con su contenido completo", () => {
  const fakeRun = (cmd) => {
    if (cmd === "git diff HEAD -- .") {
      return [
        "diff --git a/app/page.tsx b/app/page.tsx",
        "+línea de código real",
        "diff --git a/package-lock.json b/package-lock.json",
        "+" + "x".repeat(5000), // simula un lockfile enorme
      ].join("\n");
    }
    if (cmd === "git ls-files --others --exclude-standard") return "";
    throw new Error(`comando inesperado: ${cmd}`);
  };

  const result = buildFullDiff(fakeRun, () => "");

  assert.match(result, /línea de código real/);
  assert.ok(result.length < 1000, "el bloque del lockfile no debe inflar el diff con su contenido real");
});

test("contentFingerprint: mismo texto da mismo fingerprint, texto distinto da fingerprint distinto", () => {
  assert.equal(contentFingerprint("hola"), contentFingerprint("hola"));
  assert.notEqual(contentFingerprint("hola"), contentFingerprint("chau"));
});

test("redactSensitiveDiffSegments: dos cambios de lockfile con contenido real distinto producen texto redactado distinto (el fingerprint evita que colisionen en el dedup)", () => {
  const diffA = [
    "diff --git a/package-lock.json b/package-lock.json",
    '-"lodash": "4.17.20"',
    '+"lodash": "4.17.21"',
  ].join("\n");
  const diffB = [
    "diff --git a/package-lock.json b/package-lock.json",
    '-"lodash": "4.17.20"',
    '+"lodash": "4.18.0"', // cambio real distinto
  ].join("\n");

  const redactedA = redactSensitiveDiffSegments(diffA);
  const redactedB = redactSensitiveDiffSegments(diffB);

  assert.notEqual(
    redactedA,
    redactedB,
    "un placeholder constante haría que estos dos cambios reales distintos colisionen en el mismo hash de dedup"
  );
  assert.doesNotMatch(redactedA, /4\.17\.21|4\.18\.0/, "el contenido real sigue sin llegar al prompt");
});

test("buildFullDiff: un lockfile untracked con contenido distinto también produce fingerprints distintos (usa hashReadFn, no readFn truncado)", () => {
  const fakeRun = (cmd) => {
    if (cmd === "git diff HEAD -- .") return "";
    if (cmd === "git ls-files --others --exclude-standard") return "package-lock.json";
    throw new Error(`comando inesperado: ${cmd}`);
  };
  const fakeLstat = () => ({ isFile: () => true });

  const resultA = buildFullDiff(fakeRun, () => "", fakeLstat, () => Buffer.from("contenido version A"));
  const resultB = buildFullDiff(fakeRun, () => "", fakeLstat, () => Buffer.from("contenido version B"));

  assert.notEqual(resultA, resultB);
  assert.doesNotMatch(resultA, /version A/);
});

test("buildFullDiff: el fingerprint de un lockfile/binario untracked usa el contenido COMPLETO, no el truncado a MAX_UNTRACKED_FILE_CHARS (evita colisiones por corte)", () => {
  const fakeRun = (cmd) => {
    if (cmd === "git diff HEAD -- .") return "";
    if (cmd === "git ls-files --others --exclude-standard") return "package-lock.json";
    throw new Error(`comando inesperado: ${cmd}`);
  };
  const fakeLstat = () => ({ isFile: () => true });
  // Mismos primeros 20000 caracteres, cola distinta — si el fingerprint usara
  // contenido truncado (como readFn), estos dos colisionarían.
  const shared20k = "x".repeat(20000);

  const resultA = buildFullDiff(fakeRun, () => "", fakeLstat, () => Buffer.from(shared20k + "cola-A"));
  const resultB = buildFullDiff(fakeRun, () => "", fakeLstat, () => Buffer.from(shared20k + "cola-B"));

  assert.notEqual(resultA, resultB, "el fingerprint debe distinguir contenido que difiere después del límite de truncado del prompt");
});

test("redactSensitiveDiffSegments: dos binarios TRACKEADOS distintos con el mismo texto 'Binary files ... differ' no colisionan — usa los hashes de blob de la línea 'index a..b'", () => {
  const diffA = [
    "diff --git a/public/logo.png b/public/logo.png",
    "index 1111111..2222222 100644",
    "Binary files a/public/logo.png and b/public/logo.png differ",
  ].join("\n");
  const diffB = [
    "diff --git a/public/logo.png b/public/logo.png",
    "index 3333333..4444444 100644",
    "Binary files a/public/logo.png and b/public/logo.png differ",
  ].join("\n");

  const redactedA = redactSensitiveDiffSegments(diffA);
  const redactedB = redactSensitiveDiffSegments(diffB);

  assert.notEqual(
    redactedA,
    redactedB,
    "el texto 'Binary files ... differ' es idéntico en ambos — sin usar la línea index, colisionarían"
  );
});

test("redactSensitiveDiffSegments: sin línea 'index', el fingerprint de binario/lockfile cae al texto completo del segmento (fallback)", () => {
  const diffA = ["diff --git a/photo.png b/photo.png", "contenido-fake-A"].join("\n");
  const diffB = ["diff --git a/photo.png b/photo.png", "contenido-fake-B"].join("\n");

  assert.notEqual(redactSensitiveDiffSegments(diffA), redactSensitiveDiffSegments(diffB));
});
