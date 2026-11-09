import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
import { createViewerServer } from './serve-viewer.mjs';
import yaml from 'js-yaml';
import { parseSkillMetadata, getSkillVersion } from './skill-metadata.mjs';

const root = path.resolve(import.meta.dirname, '..');

test('skill versions support portable metadata and legacy frontmatter', () => {
  for (const field of ['version: "1.2.3"', 'metadata:\n  version: "1.2.3"']) {
    const source = `---\nname: fixture\n${field}\n---\nversion: 9.9.9\n`;
    assert.equal(getSkillVersion(parseSkillMetadata(source)), '1.2.3');
  }
  assert.equal(getSkillVersion({metadata: {version: '2.0.0'}, version: '1.0.0'}), '2.0.0');
});

for (const historicalFormat of ['legacy', 'nested']) {
  test(`version bump gate reads ${historicalFormat} history during metadata migration`, () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-version-'));
    assert.equal(path.dirname(temporary), path.resolve(os.tmpdir()));
    const run = (command, args) => spawnSync(command, args, {
      cwd: temporary, encoding: 'utf8', timeout: 10000,
    });
    try {
      fs.mkdirSync(path.join(temporary, 'scripts'));
      fs.mkdirSync(path.join(temporary, 'skills/fixture'), {recursive: true});
      fs.symlinkSync(path.join(root, 'node_modules'), path.join(temporary, 'node_modules'), 'junction');
      for (const name of ['validate-skills.mjs', 'skill-metadata.mjs']) {
        fs.copyFileSync(path.join(root, 'scripts', name), path.join(temporary, 'scripts', name));
      }
      const skillFile = path.join(temporary, 'skills/fixture/SKILL.md');
      const source = (field, body) => `---\nname: fixture\ndescription: Version migration fixture\n${field}\n---\n${body}\n`;
      const before = historicalFormat === 'legacy' ? 'version: "1.2.3"' : 'metadata:\n  version: "1.2.3"';
      fs.writeFileSync(skillFile, source(before, 'Before'));
      for (const args of [
        ['init', '-q'], ['add', 'skills'],
        ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
          '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Version fixture'],
      ]) {
        const result = run('git', args);
        assert.equal(result.status, 0, result.stderr);
      }
      fs.writeFileSync(skillFile, source('metadata:\n  version: "1.2.3"', 'Changed'));
      const unchanged = run(process.execPath, ['scripts/validate-skills.mjs', '--changed-since', 'HEAD']);
      assert.equal(unchanged.status, 1, unchanged.stderr);
      assert.match(unchanged.stderr, /version is still 1\.2\.3/);
      fs.writeFileSync(skillFile, source('metadata:\n  version: "1.2.4"', 'Changed'));
      const bumped = run(process.execPath, ['scripts/validate-skills.mjs', '--changed-since', 'HEAD']);
      assert.equal(bumped.status, 0, bumped.stderr);
      assert.match(bumped.stdout, /fixture\s+v1\.2\.4/);
    } finally {
      fs.rmSync(temporary, {recursive: true, force: true});
    }
  });
}

test('publish workflow emits the version for nested and legacy skills', () => {
  const workflow = yaml.load(fs.readFileSync(path.join(root, '.github/workflows/publish-clawhub.yml'), 'utf8'));
  const step = workflow.jobs.publish.steps.find(step => step.id === 'version');
  const code = step.run.match(/<<'NODE'\n([\s\S]*?)\nNODE/)[1];
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-version-'));
  assert.equal(path.dirname(temporary), path.resolve(os.tmpdir()));
  try {
    fs.mkdirSync(path.join(temporary, 'scripts'));
    fs.copyFileSync(path.join(root, 'scripts/skill-metadata.mjs'), path.join(temporary, 'scripts/skill-metadata.mjs'));
    fs.symlinkSync(path.join(root, 'node_modules'), path.join(temporary, 'node_modules'), 'junction');
    for (const [skill, field, version] of [
      ['nested', 'metadata:\n  version: "1.2.3"', '1.2.3'],
      ['legacy', 'version: "2.3.4"', '2.3.4'],
    ]) {
      fs.mkdirSync(path.join(temporary, 'skills', skill), {recursive: true});
      fs.writeFileSync(path.join(temporary, 'skills', skill, 'SKILL.md'), `---\nname: ${skill}\n${field}\n---\n`);
      const output = path.join(temporary, skill);
      const result = spawnSync(process.execPath, ['--input-type=module'], {
        cwd: temporary, encoding: 'utf8', input: code, timeout: 10000,
        env: {...process.env, SKILL: skill, GITHUB_OUTPUT: output},
      });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(fs.readFileSync(output, 'utf8'), `value=${version}\n`);
    }
  } finally {
    fs.rmSync(temporary, {recursive: true, force: true});
  }
});

function mockedCommand(file, setup) {
  return spawnSync(process.execPath, ['--input-type=module'], {
    cwd: root, encoding: 'utf8', timeout: 10000,
    input: setup + '\nawait import(' + JSON.stringify(pathToFileURL(path.join(root, file)).href) + ');',
  });
}

test('DeepL glossary replacement preserves literal dollar sequences', () => {
  const result = mockedCommand('skills/deepl-translate-node/translate.mjs', `
    process.env.DEEPL_API_KEY = 'test-only';
    process.argv = ['node', 'translate.mjs', '--target', 'EN', '--text', 'TERM', '--glossary', 'TERM=$&'];
    globalThis.fetch = async () => Response.json({translations: [{text: 'TERM'}]});
  `);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '$&\n');
});

test('registry failures cannot become an empty security report', () => {
  for (const response of [
    "new Response('unavailable', {status: 503})",
    "new Response('<html>new layout</html>')",
  ]) {
    const result = mockedCommand('scripts/audit-warnings.mjs', `
      process.argv = ['node', 'audit-warnings.mjs', '--slug', 'md-web'];
      globalThis.fetch = async url => url.includes('/api/v1/')
        ? Response.json({security: {scanners: {skillspector: {issueCount: 3}}}})
        : ${response};
    `);
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /scan incomplete/);
    assert.doesNotMatch(result.stdout, /findings: none/);
  }
});

test('registry distinguishes unavailable summary from confirmed zero findings', () => {
  const failed = mockedCommand('scripts/audit-warnings.mjs', `
    process.argv = ['node', 'audit-warnings.mjs', '--slug', 'md-web'];
    globalThis.fetch = async () => new Response('unavailable', {status: 503});
  `);
  assert.equal(failed.status, 2);
  assert.doesNotMatch(failed.stdout, /not published|findings: none/);
  const empty = mockedCommand('scripts/audit-warnings.mjs', `
    process.argv = ['node', 'audit-warnings.mjs', '--slug', 'md-web'];
    globalThis.fetch = async url => url.includes('/api/v1/')
      ? Response.json({security: {scanners: {skillspector: {issueCount: 0, status: 'clean'}}}})
      : new Response('<html>Security audit: no findings</html>');
  `);
  assert.equal(empty.status, 0, empty.stderr);
  assert.match(empty.stdout, /findings: none/);
});

test('viewer serves only regular files within its real root', async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'viewer-regression-'));
  assert.equal(path.dirname(temporary), path.resolve(os.tmpdir()));
  const publicDir = path.join(temporary, 'public');
  fs.mkdirSync(publicDir);
  fs.writeFileSync(path.join(publicDir, 'index.html'), 'viewer');
  fs.writeFileSync(path.join(temporary, 'private.txt'), 'private');
  fs.symlinkSync(temporary, path.join(publicDir, 'outside'), 'junction');
  const server = createViewerServer(publicDir);
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    assert.equal(await (await fetch(base)).text(), 'viewer');
    assert.equal((await fetch(base + '/outside/private.txt')).status, 403);
    assert.equal((await fetch(base + '/%zz')).status, 400);
    assert.equal((await fetch(base + '/missing')).status, 404);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(temporary, {recursive: true, force: true});
  }
});

function snippet(file, heading, language) {
  const text = fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
  const headingAt = text.indexOf(heading);
  assert.notEqual(headingAt, -1, `Missing section ${heading}`);
  const section = text.slice(headingAt);
  const marker = '```' + language + '\n';
  const fence = section.indexOf(marker);
  assert.notEqual(fence, -1, `Missing ${language} block in ${heading}`);
  const start = fence + marker.length;
  const end = section.indexOf('\n```', start);
  assert.notEqual(end, -1, `Unclosed code block in ${heading}`);
  return section.slice(start, end);
}

test('Electron window movement is coalesced and close saves final bounds', t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const source = snippet('skills/nextjs-to-electron/electron-files.md', '### electron/window-state.js', 'js');
  const context = {module: {exports: {}}, setTimeout, clearTimeout};
  vm.runInNewContext(source, context);
  const writes = [];
  const handlers = {};
  let x = 0, maximized = false;
  const store = {get: (_key, fallback) => fallback, set: (_key, value) => writes.push(value)};
  const win = {on: (event, handler) => { handlers[event] = handler; }, isMaximized: () => maximized,
    isMinimized: () => false, getBounds: () => ({x, y: 0, width: 800, height: 600})};
  context.module.exports.createWindowStateKeeper(store).track(win);
  for (; x < 100; x++) handlers.move();
  assert.equal(writes.length, 0);
  t.mock.timers.tick(150);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].x, 99);
  handlers.close();
  assert.equal(writes.length, 2);
  assert.equal(writes[1].x, 100);
  x = 200;
  handlers.move();
  maximized = true;
  handlers.resize();
  handlers.close();
  assert.equal(writes[2].x, 200);
  assert.equal(writes[2].maximized, true);
  t.mock.timers.tick(150);
  assert.equal(writes.length, 3);
});

test('Tauri skips a declined version before downloading', async () => {
  let source = snippet('skills/nextjs-to-tauri/frontend-integration.md', '## `desktop/updater.ts`', 'ts');
  source = source.replace('import { isTauri } from "./externalLink";', '')
    .replace('export interface', 'interface').replace('export const', 'const')
    .replace('await import("@tauri-apps/plugin-updater")', 'plugin');
  source = stripTypeScriptTypes(source) + '\nglobalThis.checkForUpdates = checkForUpdates;';
  let downloads = 0, closes = 0;
  const context = {isTauri: async () => true, plugin: {check: async () => ({version: '1.2.3',
    download: async () => { downloads++; }, close: async () => { closes++; }, install: async () => {}})}};
  vm.runInNewContext(source, context);
  await context.checkForUpdates('1.2.3');
  assert.equal(downloads, 0);
  assert.equal(closes, 1);
  await context.checkForUpdates('1.2.2');
  assert.equal(downloads, 1);
});


test('Tauri migration verifier resolves API asset IDs within its draft', () => {
  const workflow = fs.readFileSync(path.join(root, 'skills/nextjs-to-tauri/desktop-build.yml'), 'utf8');
  assert.match(workflow, /https:\/\/api\.github\.com\/repos\//);
  assert.ok(workflow.includes('releases/$DRAFT_ID/assets?'));
  assert.ok(workflow.includes('select(.id == $id) | .name'));
  assert.ok(workflow.includes('https://github.com/$REPO/releases/download/$TAG/'));
});
