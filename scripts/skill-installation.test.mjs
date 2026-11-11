import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { listTextFiles } from 'clawhub/dist/skills.js';
import { parseSkillMetadata, getSkillVersion } from './skill-metadata.mjs';

const root = path.resolve(import.meta.dirname, '..');
const skills = fs.readdirSync(path.join(root, 'skills'), {withFileTypes: true})
  .filter(entry => entry.isDirectory()).map(entry => entry.name);
// Unset runs all Skills locally; CI passes the affected directories as JSON.
const selected = process.env.TEST_SKILLS === undefined ? skills : JSON.parse(process.env.TEST_SKILLS);
assert.ok(Array.isArray(selected) && selected.every(skill => skills.includes(skill)), 'TEST_SKILLS must list existing Skills');

for (const skill of skills.filter(skill => selected.includes(skill))) {
  test(`${skill} works from an isolated publish bundle`, async () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-install-'));
    assert.equal(path.dirname(temporary), path.resolve(os.tmpdir()));
    const installed = path.join(temporary, skill);
    const env = {...process.env, NODE_PATH: '', NODE_OPTIONS: ''};
    delete env.NODE_TEST_CONTEXT;
    const run = (args, expectedStatus = 0, timeout = 60000) => {
      const result = spawnSync(process.execPath, args, {
        cwd: installed, env, encoding: 'utf8', timeout,
      });
      assert.equal(result.status, expectedStatus, result.error?.message || result.stdout + result.stderr);
      return result;
    };
    try {
      const files = await listTextFiles(path.join(root, 'skills', skill));
      assert.ok(files.some(file => file.relPath === 'SKILL.md'));
      for (const file of files) {
        const target = path.join(installed, file.relPath);
        fs.mkdirSync(path.dirname(target), {recursive: true});
        fs.writeFileSync(target, file.bytes);
      }
      assert.equal(fs.existsSync(path.join(temporary, 'node_modules')), false);
      const metadata = parseSkillMetadata(fs.readFileSync(path.join(installed, 'SKILL.md'), 'utf8'));
      assert.equal(metadata.name, skill);
      if (skill === 'desktop-app-standard') {
        const tests = fs.readdirSync(path.join(installed, 'tests')).filter(file => file.endsWith('.test.mjs')).sort();
        const result = run(['--test', ...tests.map(file => 'tests/' + file)]);
        assert.match(result.stdout, /(?:#|ℹ) tests [1-9]\d*/);
        run(['scripts/audit.mjs', '--help']);
      }
      if (skill === 'md-web') {
        run(['upload.js', '--help']);
        assert.match(run(['--test', 'tests/shared-state.test.cjs']).stdout, /(?:#|ℹ) tests [1-9]\d*/);
      }
      if (skill === 'deepl-translate-node') {
        const result = run(['--input-type=module', '-e', `
          process.env.DEEPL_API_KEY = 'fixture-only';
          process.argv = ['node', 'translate.mjs', '--target', 'EN', '--text', 'fixture'];
          globalThis.fetch = async () => Response.json({translations: [{text: 'translated fixture'}]});
          await import(${JSON.stringify(pathToFileURL(path.join(installed, 'translate.mjs')).href)});
        `]);
        assert.equal(result.stdout, 'translated fixture\n');
      }
      if (skill === 'html-shot') {
        const command = process.platform === 'win32'
          ? [process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm ci --no-audit --no-fund']]
          : ['npm', ['ci', '--no-audit', '--no-fund']];
        const install = spawnSync(command[0], command[1], {
          cwd: installed, env, encoding: 'utf8', timeout: 120000,
        });
        assert.equal(install.status, 0, install.error?.message || install.stdout + install.stderr);
        for (const script of ['render.mjs', 'icons.mjs']) {
          assert.equal(run([script, '--version']).stdout.trim(), getSkillVersion(metadata));
          run([script, '--help']);
        }
        run(['inspect.mjs', '--help']);
        assert.match(run(['--test', 'test/unit.test.mjs']).stdout, /(?:#|ℹ) tests [1-9]\d*/);
        if (process.env.CI === 'true') {
          if (!env.HTML_SHOT_EXECUTABLE) run(['node_modules/playwright/cli.js', 'install', 'chromium'], 0, 120000);
          assert.match(run(['--test', '--test-concurrency=1', 'test/integration.test.mjs'], 0, 180000).stdout, /(?:#|ℹ) tests [1-9]\d*/);
        }
      }
      // Reference-only Skills are checked against every declared resource after packing.
      for (const resource of metadata.metadata?.openclaw?.files ?? []) {
        assert.ok(files.some(file => resource.endsWith('/**')
          ? file.relPath.startsWith(resource.slice(0, -2)) : file.relPath === resource), resource);
      }
    } finally {
      fs.rmSync(temporary, {recursive: true, force: true});
    }
  });
}
