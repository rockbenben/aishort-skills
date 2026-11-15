#!/usr/bin/env node
/**
 * Read the ClawHub security findings for every skill in this repo.
 *
 * Read summary and version-pinned raw scanner reports from the public API.
 * The website hides some low-confidence findings, so its card count is not the
 * scanner's issue count and must not be used to decide whether reports are complete.
 *
 * Usage:
 *   node scripts/audit-warnings.mjs            # published versions
 *   node scripts/audit-warnings.mjs --verbose  # also print the scanner excerpt
 *   node scripts/audit-warnings.mjs --slug md-web   # one skill
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";

const REGISTRY = "https://clawhub.ai";
const VERBOSE = process.argv.includes("--verbose");

const slugs = readdirSync(join(process.cwd(), "skills"), { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .filter((s) => {
    const i = process.argv.indexOf("--slug");
    return i < 0 || process.argv[i + 1] === s;
  });

if (process.argv.includes("--slug") && slugs.length === 0) {
  const slug = process.argv[process.argv.indexOf("--slug") + 1];
  console.error(slug && !slug.startsWith("--")
    ? `audit-warnings: unknown skill "${slug}"`
    : "audit-warnings: --slug requires a skill name");
  process.exit(2);
}

const findingsOf = (verification) => {
  const reports = verification?.security?.scannerReports;
  const inspector = reports?.skillspector;
  if (!Array.isArray(inspector?.issues)) throw new Error("raw Skillspector report unavailable");
  if (inspector.execution_successful === false) throw new Error("raw Skillspector execution failed");
  const findings = inspector.issues.map(issue => ({
    title: issue.pattern, severity: issue.severity, category: issue.category,
    confidence: issue.confidence, file: issue.location?.file ?? "(no file)",
    line: issue.location?.start_line ?? "?", description: issue.explanation ?? issue.finding ?? "",
    excerpt: issue.code_snippet ?? "",
  }));
  if (!Array.isArray(reports?.aig?.runs)) throw new Error("raw A.I.G report unavailable");
  for (const run of reports.aig.runs) {
    if (!Array.isArray(run.results)) throw new Error("raw A.I.G results unavailable");
    for (const issue of run.results) {
      const location = issue.locations?.[0]?.physicalLocation;
      findings.push({title: issue.message?.text ?? issue.ruleId, severity: issue.level,
        category: issue.ruleId, confidence: "n/a", file: location?.artifactLocation?.uri ?? "(no file)",
        line: location?.region?.startLine ?? "?", description: issue.properties?.description ?? "", excerpt: ""});
    }
  }
  return { findings, issueCount: inspector.issues.length, coverage: inspector.analysis_completeness?.status };
};

for (const slug of slugs) {
  try {
    const scanRes = await fetch(`${REGISTRY}/api/v1/skills/${slug}/scan`, { signal: AbortSignal.timeout(30000) });
    if (scanRes.status === 404) {
      console.log(`\n=== ${slug} ===\n  no published scan available (HTTP 404)`);
      continue;
    }
    if (!scanRes.ok) throw new Error(`scan summary HTTP ${scanRes.status}`);
    const scan = await scanRes.json();
    if (!scan || typeof scan !== "object" || !scan.security) throw new Error("scan summary has an unknown format");
    const version = scan?.version?.version ?? "(none published)";
    const ss = scan?.security?.scanners?.skillspector;
    const llm = scan?.security?.scanners?.llm;

    console.log(`\n=== ${slug} @ ${version} ===`);
    console.log(
      `  skillspector: ${ss?.status ?? "?"} score=${ss?.score ?? "?"} severity=${ss?.severity ?? "?"} issues=${ss?.issueCount ?? 0}`,
    );
    console.log(
      `  llm: ${llm?.normalizedStatus ?? "?"} verdict=${llm?.verdict ?? "?"} confidence=${llm?.confidence ?? "?"}`,
    );
    if (llm?.guidance) console.log(`  llm guidance: ${llm.guidance}`);
    for (const d of llm?.dimensions ?? []) {
      if (d.rating !== "ok") console.log(`    - [${d.rating}] ${d.label}: ${d.detail}`);
    }

    const requestedVersion = scan?.version?.version;
    const suffix = requestedVersion ? "?version=" + encodeURIComponent(requestedVersion) : "";
    const details = await fetch(`${REGISTRY}/api/v1/skills/${slug}/verify${suffix}`, { signal: AbortSignal.timeout(30000) });
    if (!details.ok) throw new Error(`raw scan reports HTTP ${details.status}`);
    const verification = await details.json();
    if (requestedVersion && verification.version !== requestedVersion) throw new Error("raw report version differs from summary");
    const { findings, issueCount, coverage } = findingsOf(verification);
    if (!Number.isInteger(ss?.issueCount) || issueCount !== ss.issueCount) throw new Error("raw report issue count differs from summary");
    if (coverage) console.log(`  scanner coverage: ${coverage} (this is not a security pass)`);
    if (!findings.length) {
      if (/pending|running|error|failed/i.test(ss?.status || "unknown")) throw new Error("scanner incomplete");
      console.log("  findings: none");
      continue;
    }
    for (const f of findings) {
      console.log(`  - ${f.title} [${f.severity}] ${f.category} (${f.confidence})`);
      console.log(`      ${f.file} line ${f.line}`);
      console.log(`      ${f.description}`);
      if (VERBOSE) console.log(`      excerpt: ${f.excerpt.slice(0, 400)}`);
    }
  } catch (error) {
    console.error(`  ${slug}: scan incomplete — ${error.message}`);
    process.exitCode = 2;
  }
}
