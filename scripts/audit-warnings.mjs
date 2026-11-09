#!/usr/bin/env node
/**
 * Read the ClawHub security findings for every skill in this repo.
 *
 * The public REST API (/api/v1/skills/<slug>/scan) only carries the summary
 * (skillspector score + issueCount); the findings themselves are rendered by the
 * site from the loader payload, so the report is parsed out of the rendered
 * security-audit page.
 *
 * Usage:
 *   node scripts/audit-warnings.mjs            # published versions
 *   node scripts/audit-warnings.mjs --verbose  # also print the scanner excerpt
 *   node scripts/audit-warnings.mjs --slug md-web   # one skill
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";

const REGISTRY = "https://clawhub.ai";
const OWNER = "rockbenben";
const VERBOSE = process.argv.includes("--verbose");

const decode = (s) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");

const stripTags = (s) => decode(s.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();

const slugs = readdirSync(join(process.cwd(), "skills"), { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .filter((s) => {
    const i = process.argv.indexOf("--slug");
    return i < 0 || process.argv[i + 1] === s;
  });

const findingsOf = (html) => {
  const out = [];
  const blocks = html.split('<article class="static-analysis-finding">').slice(1);
  for (const block of blocks) {
    const title = stripTags(block.match(/agentic-risk-finding-title">(.*?)<\/h3>/)?.[1] ?? "?");
    const severity = stripTags(block.match(/agentic-risk-finding-badges">(.*?)<\/div>/)?.[1] ?? "?");
    const category = stripTags(block.match(/<dt>Category<\/dt><dd>(.*?)<\/dd>/)?.[1] ?? "?");
    const confidence = stripTags(block.match(/<dt>Confidence<\/dt><dd>(.*?)<\/dd>/)?.[1] ?? "?");
    const where = block.match(/Scanner excerpt (.*?) \(reported line (\d+)\)/);
    const excerpt = block.match(/<code class="language-md">([\s\S]*?)<\/code>/)?.[1] ?? "";
    const desc = block.match(/<dt>Finding<\/dt><dd[^>]*>([\s\S]*?)<\/dd>/)?.[1] ?? "";
    out.push({
      title,
      severity,
      category,
      confidence,
      file: where?.[1]?.trim() ?? "(no file)",
      line: where?.[2] ?? "?",
      description: stripTags(desc),
      excerpt: stripTags(excerpt),
    });
  }
  return out;
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

    const details = await fetch(`${REGISTRY}/${OWNER}/skills/${slug}/security-audit`, { signal: AbortSignal.timeout(30000) });
    if (!details.ok) throw new Error(`scan details HTTP ${details.status}`);
    const html = await details.text();
    const findings = findingsOf(html);
    if (findings.length < (ss?.issueCount ?? 0)) throw new Error("scan details incomplete: fewer findings than the summary");
    if (!findings.length) {
      // Only a completed scanner with zero reported issues establishes an empty result.
      if (ss?.issueCount !== 0 || /pending|running|error|failed/i.test(ss?.status || "unknown")) throw new Error("scan details unavailable or scanner incomplete");
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
