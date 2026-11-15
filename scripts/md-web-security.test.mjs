import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';

const require = createRequire(import.meta.url);
const {migrateConfig} = require('../skills/md-web/upload.js');

test('credential migration creates a private file before writing secrets, and never overwrites a concurrent config', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'md-web-migrate-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const source = path.join(root, 'legacy.json'), destination = path.join(root, '.md-web/config.json');
  fs.writeFileSync(source, 'secret', {mode: 0o644});
  const calls = [];
  const io = {...fs,
    chmodSync: (...args) => { calls.push(['chmod', ...args]); fs.chmodSync(...args); },
    openSync: (...args) => { calls.push(['open', ...args]); return fs.openSync(...args); },
    writeFileSync: (...args) => { calls.push(['write']); fs.writeFileSync(...args); },
  };
  migrateConfig(source, destination, io, 'linux');
  assert.deepEqual(calls.map(c => c[0]), ['chmod', 'open', 'write']);
  assert.deepEqual(calls[0], ['chmod', path.dirname(destination), 0o700]);
  assert.deepEqual(calls[1], ['open', destination, 'wx', 0o600]);
  assert.equal(fs.readFileSync(destination, 'utf8'), 'secret');
  fs.writeFileSync(source, 'different secret');
  migrateConfig(source, destination);
  assert.equal(fs.readFileSync(destination, 'utf8'), 'secret');
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(destination).mode & 0o777, 0o600);
    assert.equal(fs.statSync(path.dirname(destination)).mode & 0o777, 0o700);
  }
});

test('credential migration fails before writing when directory permissions cannot be secured', () => {
  let opened = false;
  const io = {mkdirSync() {}, lstatSync: () => ({isDirectory: () => true, isSymbolicLink: () => false, uid: process.getuid?.()}),
    chmodSync() { throw Object.assign(new Error('denied'), {code: 'EPERM'}); }, openSync() { opened = true; }};
  assert.throws(() => migrateConfig('source', '/private/config.json', io, 'linux'), /denied/);
  assert.equal(opened, false);
});

test('credential migration refuses existing destination symlinks rather than following or overwriting them', () => {
  const io = {mkdirSync() {}, chmodSync() {},
    lstatSync: file => ({isDirectory: () => !file.endsWith('config.json'), isFile: () => false,
      isSymbolicLink: () => file.endsWith('config.json'), uid: process.getuid?.()}),
    openSync() { throw Object.assign(new Error('exists'), {code: 'EEXIST'}); }};
  assert.throws(() => migrateConfig('source', '/private/config.json', io, 'linux'), /regular file/);
});

test('viewer setup without shared-write confirmation stops before reading credentials or contacting S3', () => {
  const result = spawnSync(process.execPath, ['skills/md-web/upload.js', '--setup'], {encoding: 'utf8'});
  assert.equal(result.status, 1);
  assert.match(result.stderr, /requires --confirm-shared-writes/);
  assert.doesNotMatch(result.stderr, /CONFIG_MISSING|AccessDenied/);
});

test('the bundled search plugin escapes an attacker supplied query before creating its input HTML', () => {
  for (const query of ['"><img src=x onerror=alert(1)>', '" autofocus onfocus="alert(1)', 'a&b', '正常搜索']) {
    let mounted, markup;
    const element = {classList: {add() {}, remove() {}}, value: ''};
    const dom = {create(_tag, html) { markup = html; return element; }, find() { return element; },
      style() {}, toggleClass() {}, before() {}, on() {}};
    const context = {$docsify: {plugins: []}, Docsify: {dom, util: {isPrimitive: value => typeof value !== 'object'}},
      setTimeout() {}, clearTimeout() {}, window: {}};
    vm.runInNewContext(fs.readFileSync('skills/md-web/docsify-server/assets/search.min.js', 'utf8'), context);
    context.$docsify.plugins[0]({mounted(fn) { mounted = fn; }, doneEach() {}},
      {config: {search: {paths: 'auto'}}, router: {parse: () => ({query: {s: query}})}});
    mounted();
    const escaped = query.replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
    assert.ok(markup.includes('value="' + escaped + '" aria-label="Search text"'), markup);
    assert.ok(!markup.includes('<img'));
  }
});
