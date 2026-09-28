#!/usr/bin/env node
/**
 * Validate every skill under skills/ against what ClawHub and OpenClaw actually enforce,
 * before the publish workflow uploads anything.
 *
 * Rules come from the ClawHub skill-format docs and from the clawhub CLI's own source
 * (MAX_PUBLISH_FILE_BYTES, MAX_PUBLISH_TOTAL_BYTES, "SKILL.md required", semver on
 * --version), plus OpenClaw's runtime gating, which compares metadata.openclaw.os against
 * process.platform.
 *
 * It also models which files the publish bundle actually carries. The CLI's listTextFiles()
 * (dist/skills.js, read at 0.8.0; publish.js calls it) walks with its own readdir loop, which
 * skips every entry whose name starts with "." — file or directory — plus node_modules/, and then
 * drops anything whose extension is outside the text allowlist (dist/schema/textFiles.js). A real
 * file on disk can therefore be invisible to an install. Nothing here enforces
 * metadata.openclaw.files: that field is not in ClawHub's documented field list, the CLI never
 * reads it, and publish uploads every file in the folder regardless, so declaring a file neither
 * lets it in nor keeps it out.
 *
 * One thing this model leaves out on purpose: listTextFiles() also seeds the skill folder's own
 * .gitignore, .clawhubignore and .clawdhubignore into its matcher, and matching those faithfully
 * takes the `ignore` package's semantics rather than a line matcher. The consequence is one-sided
 * — a skill that ignores one of its own text files is modeled here as shipping it.
 *
 * Usage:
 *   node scripts/validate-skills.mjs
 *   node scripts/validate-skills.mjs --changed-since <git-ref>   # also require a version bump
 *
 * Needs js-yaml (npm install --no-save js-yaml@4). Parsing with a real YAML parser is the
 * point of the strictest check here: OpenClaw parses frontmatter as YAML and silently falls
 * back to a single-line parser when that fails, which drops the whole nested
 * metadata.openclaw block. A plain scalar holding ": " is enough to trigger it.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, relative } from "node:path";

const yaml = await import("js-yaml").then((m) => m.default ?? m).catch(() => {
  console.error("validate-skills: js-yaml is not installed.\n  npm install --no-save js-yaml@4");
  process.exit(2);
});

const ROOT = process.cwd();
const SKILLS = join(ROOT, "skills");
const since = process.argv.includes("--changed-since")
  ? process.argv[process.argv.indexOf("--changed-since") + 1]
  : null;

// From the clawhub CLI: per-file and per-bundle publish caps, and the file-count ceiling.
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_BYTES = 50 * 1024 * 1024;
const MAX_FILE_COUNT = 10_000;
// The extensions listTextFiles() is willing to upload. Anything else — images, fonts, binaries
// — stays in the repo and out of the bundle, which is why README artwork lives at the root.
const TEXT_EXTENSIONS = new Set([
  "md", "mdx", "txt", "json", "json5", "yaml", "yml", "toml", "js", "cjs", "mjs", "ts", "tsx",
  "jsx", "py", "sh", "rb", "go", "rs", "swift", "kt", "java", "cs", "cpp", "c", "h", "hpp",
  "sql", "csv", "ini", "cfg", "env", "xml", "html", "css", "scss", "sass", "svg",
]);
// OpenClaw's authoring guide: one line, under 160 characters.
const DESC_LIMIT = 160;
// evaluateRuntimeEligibility() compares this list against resolveRuntimePlatform(), which
// returns process.platform. "macos" (the value the format reference's example uses) never matches.
const OS_VALUES = ["darwin", "linux", "win32"];
const INSTALL_KINDS = ["brew", "node", "go", "uv"];
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

let failures = 0;
let warnings = 0;
const fail = (skill, msg) => { console.error(`  FAIL  ${skill}: ${msg}`); failures++; };
const warn = (skill, msg) => { console.error(`  warn  ${skill}: ${msg}`); warnings++; };

// The paths clawhub would actually upload for this skill dir, as skill-relative paths.
function bundleFiles(dir) {
  const out = [];
  const step = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      // Skipped wholesale, subtree included — this is how a .nojekyll disappears.
      if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === ".git") continue;
      const p = join(current, entry.name);
      if (entry.isDirectory()) step(p);
      else if (entry.isFile() && TEXT_EXTENSIONS.has(entry.name.split(".").pop().toLowerCase()))
        out.push(relative(dir, p).replace(/\\/g, "/"));
    }
  };
  step(dir);
  return out;
}

// A files: entry may be a literal path or a "dir/**" prefix, which is how md-web ships its server.
const declaredFileExists = (dir, pattern) =>
  pattern.endsWith("/**")
    ? existsSync(join(dir, pattern.slice(0, -3)))
    : existsSync(join(dir, pattern));

const versionAt = (ref, relPath) => {
  try {
    const src = execFileSync("git", ["show", `${ref}:${relPath}`], { encoding: "utf8" });
    return src.match(/^version:\s*(.+)$/m)?.[1].trim() ?? null;
  } catch { return null; } // absent at that ref = a new skill, nothing to compare
};

for (const dirent of readdirSync(SKILLS, { withFileTypes: true })) {
  if (!dirent.isDirectory()) continue;
  const skill = dirent.name;
  const dir = join(SKILLS, skill);
  const mdPath = join(dir, "SKILL.md");
  const failedBefore = failures;

  if (!existsSync(mdPath)) { fail(skill, "SKILL.md is required"); continue; }

  const raw = readFileSync(mdPath, "utf8").replace(/\r\n/g, "\n");
  const fm = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!fm) { fail(skill, "SKILL.md has no YAML frontmatter"); continue; }

  let meta;
  try {
    meta = yaml.load(fm[1]);
  } catch (e) {
    // The failure this validator exists for.
    fail(skill, `frontmatter is not valid YAML (OpenClaw would drop metadata.openclaw): ${e.message.split("\n")[0]}`);
    continue;
  }
  if (!meta || typeof meta !== "object") { fail(skill, "frontmatter did not parse to a mapping"); continue; }

  if (typeof meta.name !== "string" || !meta.name) fail(skill, "name is required");
  else {
    if (!NAME.test(meta.name) || meta.name.length > 64)
      fail(skill, `name "${meta.name}" must be 1-64 lowercase letters, digits and single hyphens`);
    if (meta.name !== skill) fail(skill, `name "${meta.name}" must match the directory name`);
  }

  if (typeof meta.description !== "string" || !meta.description.trim()) fail(skill, "description is required");
  else if (meta.description.length >= DESC_LIMIT)
    warn(skill, `description is ${meta.description.length} chars; OpenClaw asks for one line under ${DESC_LIMIT}`);

  // The publish workflow reads this line and passes it to `clawhub publish --version`.
  if (typeof meta.version !== "string" || !SEMVER.test(meta.version))
    fail(skill, `version must be valid semver, got ${JSON.stringify(meta.version)}`);

  const bundled = bundleFiles(dir);
  const ships = new Set(bundled);

  const oc = meta.metadata?.openclaw;
  if (meta.metadata?.clawdbot && !oc)
    warn(skill, "metadata.clawdbot is the legacy key; OpenClaw prefers metadata.openclaw");
  if (oc) {
    for (const f of oc.files ?? []) {
      if (!declaredFileExists(dir, f)) { fail(skill, `metadata.openclaw.files lists "${f}", which is not on disk`); continue; }
      // On disk is not enough: a declared file the bundler drops never reaches anyone.
      if (!f.endsWith("/**") && !ships.has(f))
        fail(skill, `metadata.openclaw.files lists "${f}", which clawhub never uploads (dot-named or off the text allowlist)`);
    }

    for (const value of oc.os ?? [])
      if (!OS_VALUES.includes(value))
        fail(skill, `metadata.openclaw.os "${value}" never matches; use one of ${OS_VALUES.join(", ")}`);

    const requiredEnv = oc.requires?.env ?? [];
    for (const entry of oc.envVars ?? []) {
      if (!entry?.name) { fail(skill, "each metadata.openclaw.envVars entry needs a name"); continue; }
      // The format reference is explicit: optional variables must stay out of requires.env,
      // or the skill is gated off for everyone who has not set an optional value.
      if (entry.required === false && requiredEnv.includes(entry.name))
        fail(skill, `${entry.name} is declared optional but also listed in requires.env`);
    }

    for (const spec of oc.install ?? [])
      if (spec?.kind && !INSTALL_KINDS.includes(spec.kind))
        fail(skill, `install kind "${spec.kind}" is not one of ${INSTALL_KINDS.join(", ")}`);
  }

  // A path SKILL.md tells the agent to run or open has to survive the bundler. node_modules/ paths
  // are excluded because the skill installs those itself.
  const referenced = new Set(
    [...raw.matchAll(/\{SKILL_DIR\}\/([\w.\-/]+)/g)]
      .map(([, p]) => p.replace(/[.,;:)\]]+$/, ""))
      .filter((p) => !p.startsWith("node_modules/")),
  );
  for (const p of referenced)
    if (!ships.has(p)) fail(skill, `SKILL.md points at {SKILL_DIR}/${p}, which clawhub never uploads`);

  // A bump that misses package.json leaves a private package versioned differently from the
  // skill that ships it, and the lockfile has to agree with package.json or npm ci refuses.
  if (existsSync(join(dir, "package.json"))) {
    let pkg;
    try {
      pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    } catch (e) {
      fail(skill, `package.json is not valid JSON: ${e.message.split("\n")[0]}`);
    }
    if (pkg) {
      if (pkg.version !== meta.version)
        fail(skill, `package.json is ${pkg.version} while SKILL.md is ${meta.version}; one bump has to move both`);
      const lockPath = join(dir, "package-lock.json");
      if (existsSync(lockPath)) {
        const lock = JSON.parse(readFileSync(lockPath, "utf8"));
        if (lock.version !== pkg.version || lock.packages?.[""]?.version !== pkg.version)
          fail(skill, `package-lock.json says ${lock.version}/${lock.packages?.[""]?.version} against package.json ${pkg.version}`);
      }
    }
  }

  // Same for a file named without a path. Matched against what is actually in the directory, so a
  // mention of some file in the user's own project is not a finding.
  const body = raw.replace(/^---\n[\s\S]*?\n---\n/, "");
  for (const local of readdirSync(dir)) {
    if (local === "SKILL.md" || !statSync(join(dir, local)).isFile()) continue;
    const pattern = local.replace(/[.]/g, "\\$&");
    if (!new RegExp(`(?<![-\\w.])${pattern}(?![-\\w])`).test(body)) continue;
    if (!ships.has(local)) fail(skill, `SKILL.md names ${local}, which clawhub never uploads`);
  }

  // Publish caps, measured over what actually ships.
  const files = bundled.map((rel) => join(dir, rel));
  let total = 0;
  for (const f of files) {
    const size = statSync(f).size;
    total += size;
    if (size > MAX_FILE_BYTES)
      fail(skill, `${relative(dir, f)} is ${(size / 1048576).toFixed(1)} MB; ClawHub rejects files over 10 MB`);
  }
  if (total > MAX_TOTAL_BYTES) fail(skill, `bundle is ${(total / 1048576).toFixed(1)} MB; the cap is 50 MB`);
  if (files.length > MAX_FILE_COUNT) fail(skill, `${files.length} files exceeds the ${MAX_FILE_COUNT} cap`);

  // Changed content on an unchanged version is a guaranteed rejection at publish time.
  if (since) {
    const rel = `skills/${skill}`;
    let changed = false;
    try {
      changed = execFileSync("git", ["diff", "--name-only", since, "--", rel], { encoding: "utf8" }).trim().length > 0;
    } catch { changed = false; }
    if (changed) {
      const before = versionAt(since, `${rel}/SKILL.md`);
      if (before && before === meta.version)
        fail(skill, `content changed since ${since} but version is still ${meta.version}; bump it or ClawHub refuses the release`);
    }
  }

  if (failures === failedBefore) console.log(`  ok    ${skill}  v${meta.version}  desc ${meta.description.length}`);
}

console.error(`\n${failures} failure(s), ${warnings} warning(s)`);
process.exit(failures ? 1 : 0);
