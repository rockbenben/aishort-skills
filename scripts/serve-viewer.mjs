#!/usr/bin/env node
/**
 * Throwaway static server for the md-web viewer, so the page can be opened in a
 * browser and checked for real. Not part of the skill: it lives in the repo's
 * scripts/ only for this verification.
 *
 * Usage: node scripts/serve-viewer.mjs <port>
 */
import { createServer } from "node:http";
import { readFile, realpath, stat } from "node:fs/promises";
import { join, extname, relative, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

export function createViewerServer(root) {
  return createServer(async (req, res) => {
    let rel;
    try {
      const url = new URL(req.url, "http://localhost");
      rel = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html";
      if (rel.includes("\0")) throw new Error("Invalid path");
    } catch {
      res.writeHead(400).end("invalid path");
      return;
    }
    try {
      const base = await realpath(root);
      const file = await realpath(join(base, rel));
      const within = relative(base, file);
      if (within === ".." || within.startsWith("../") || within.startsWith("..\\") || isAbsolute(within)) {
        res.writeHead(403).end("forbidden");
        return;
      }
      if (!(await stat(file)).isFile()) {
        res.writeHead(404).end("not found");
        return;
      }
      const body = await readFile(file);
      res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = join(process.cwd(), "skills", "md-web", "docsify-server");
  const server = createViewerServer(root);
  server.listen(Number(process.argv[2] ?? 8099), "127.0.0.1", () =>
    console.log(`serving ${root} on http://127.0.0.1:${server.address().port}`));
}
