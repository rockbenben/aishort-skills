import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

test('portable WPF startup template passes isolated transaction and UAC regressions', {
  skip: process.platform !== 'win32', timeout: 120000,
}, () => {
  const artifacts = fs.mkdtempSync(path.join(os.tmpdir(), 'wpf-startup-tests-'));
  try {
    const script = path.join(artifacts, 'Test-ElevatedStartup.ps1');
    fs.copyFileSync('skills/wpf-desktop/templates/test-startup.ps1.txt', script);
    const result = spawnSync('pwsh', ['-NoProfile', '-File', script, '-TemplateDirectory',
      path.resolve('skills/wpf-desktop/templates')], {encoding: 'utf8', timeout: 90000});
    assert.equal(result.status, 0, result.error?.message || result.stdout + result.stderr);
    assert.match(result.stdout, /isolated startup checks passed; no OS startup state accessed/);
  } finally {
    fs.rmSync(artifacts, {recursive: true, force: true});
  }
});
