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
  const scanRes = await fetch(`${REGISTRY}/api/v1/skills/${slug}/scan`).catch(() => null);
  const scan = scanRes?.ok ? await scanRes.json() : null;
  const version = scan?.version?.version ?? "(none published)";
  const ss = scan?.security?.scanners?.skillspector;
  const llm = scan?.security?.scanners?.llm;

  console.log(`\n=== ${slug} @ ${version} ===`);
  if (!scan) {
    console.log("  (not published yet — no scan to read)");
    continue;
  }
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

  const html = await (await fetch(`${REGISTRY}/${OWNER}/skills/${slug}/security-audit`)).text();
  const findings = findingsOf(html);
  if (!findings.length) {
    console.log("  findings: none");
    continue;
  }
  for (const f of findings) {
    console.log(`  - ${f.title} [${f.severity}] ${f.category} (${f.confidence})`);
    console.log(`      ${f.file} line ${f.line}`);
    console.log(`      ${f.description}`);
    if (VERBOSE) console.log(`      excerpt: ${f.excerpt.slice(0, 400)}`);
  }
}
