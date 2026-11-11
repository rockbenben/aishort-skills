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
import { TOOL_VERSION } from '../skills/desktop-app-standard/scripts/core.mjs';
import { listenOnSafePort } from '../skills/html-shot/lib.mjs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { assertNsisEnglish } from '../skills/desktop-app-standard/scripts/delivery-checks.mjs';

const root = path.resolve(import.meta.dirname, '..');

test('installer YAML gate uses the application parser for block, flow and aliased configurations', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'installer-yaml-'));
  assert.equal(path.dirname(temporary), path.resolve(os.tmpdir()));
  try {
    // Model a strict dependency layout: js-yaml is private to app-builder-lib.
    for (const name of ['electron-builder', 'app-builder-lib']) {
      const directory = path.join(temporary, 'node_modules', name);
      fs.mkdirSync(directory, {recursive: true});
      fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({name, main: 'index.js'}));
      fs.writeFileSync(path.join(directory, 'index.js'), 'throw new Error("Do not execute builder code");');
    }
    const dependencies = path.join(temporary, 'node_modules/app-builder-lib/node_modules');
    fs.mkdirSync(dependencies);
    const require = createRequire(import.meta.url);
    fs.symlinkSync(path.dirname(require.resolve('js-yaml/package.json')), path.join(dependencies, 'js-yaml'), 'junction');
    const file = path.join(temporary, 'electron-builder.yml');
    const block = 'nsis:\n  installerLanguages: [en_US]\n  displayLanguageSelector: false\n';
    const accepted = [block,
      block.replace('  installerLanguages', '\n    installerLanguages').replace('  displayLanguageSelector', '    displayLanguageSelector').replace('[en_US]', '[en_US] # English only'),
      block.replace('[en_US]', '\n    - en_US'),
      'nsis: {installerLanguages: [en_US], displayLanguageSelector: false}\n',
      'defaults: &english {installerLanguages: [en_US], displayLanguageSelector: false}\nnsis: *english\n',
      'defaults: &english {installerLanguages: [en_US]}\nnsis:\n  <<: *english\n  displayLanguageSelector: false\n',
    ];
    for (const text of accepted) assertNsisEnglish(file, text);
    for (const text of [block.replace('[en_US]', '[en_US, zh_CN]'),
      block.replace('[en_US]', '\n    - en_US\n    - zh_CN'),
      block.replace('false', 'true'), 'nsis: {installerLanguages: [en_US], displayLanguageSelector: false,']) {
      assert.throws(() => assertNsisEnglish(file, text));
    }
    fs.writeFileSync(file, accepted[3]);
    const script = path.join(root, 'skills/desktop-app-standard/scripts/delivery-checks.mjs');
    const result = spawnSync(process.execPath, [script, '--installer', file], {encoding: 'utf8'});
    assert.equal(result.status, 0, result.stderr);
    fs.writeFileSync(file, block.replace('false', 'true'));
    assert.notEqual(spawnSync(process.execPath, [script, '--installer', file]).status, 0);
  } finally { fs.rmSync(temporary, {recursive: true, force: true}); }
});

test('CI selects changed Skills independently of publishing and shared tool changes', () => {
  const workflow = yaml.load(fs.readFileSync(path.join(root, '.github/workflows/publish-clawhub.yml'), 'utf8'));
  const step = workflow.jobs.detect.steps.find(step => step.id === 'list');
  const code = step.run.match(/<<'NODE'\n([\s\S]*?)\nNODE/)[1];
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-ci-'));
  assert.equal(path.dirname(temporary), path.resolve(os.tmpdir()));
  const git = (...args) => {
    const result = spawnSync('git', args, {cwd: temporary, encoding: 'utf8'});
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  try {
    const all = ['deepl-translate-node', 'html-shot', 'wpf-desktop'];
    for (const skill of all) {
      fs.mkdirSync(path.join(temporary, 'skills', skill), {recursive: true});
      fs.writeFileSync(path.join(temporary, 'skills', skill, 'SKILL.md'), 'fixture');
    }
    git('init', '-q');
    const commit = () => {
      git('add', '.');
      git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Fixture');
      return git('rev-parse', 'HEAD');
    };
    const base = commit();
    fs.writeFileSync(path.join(temporary, 'skills/deepl-translate-node/SKILL.md'), 'changed');
    const changed = commit();
    const select = (env, succeeds = true) => {
      const output = path.join(temporary, 'output');
      fs.rmSync(output, {force: true});
      const result = spawnSync(process.execPath, ['--input-type=module'], {
        cwd: temporary, encoding: 'utf8', input: code,
        env: {...process.env, EVENT: 'push', BEFORE: base, SHA: changed, PR_BASE: base, INPUT_SKILL: '', GITHUB_OUTPUT: output, ...env},
      });
      assert.equal(result.status === 0, succeeds, result.stderr);
      if (!succeeds) return;
      const values = Object.fromEntries(fs.readFileSync(output, 'utf8').trim().split('\n').map(line => {
        const at = line.indexOf('='); return [line.slice(0, at), line.slice(at + 1)];
      }));
      return {publish: JSON.parse(values.skills), tests: JSON.parse(values['test-skills'])};
    };
    assert.deepEqual(select({}), {publish: ['deepl-translate-node'], tests: ['deepl-translate-node']});
    assert.deepEqual(select({EVENT: 'pull_request'}), {publish: [], tests: ['deepl-translate-node']});
    assert.deepEqual(select({EVENT: 'workflow_dispatch', INPUT_SKILL: 'wpf-desktop'}), {publish: ['wpf-desktop'], tests: ['wpf-desktop']});
    assert.deepEqual(select({EVENT: 'workflow_dispatch'}), {publish: all, tests: all});
    select({EVENT: 'workflow_dispatch', INPUT_SKILL: '../html-shot'}, false);
    select({EVENT: 'pull_request', PR_BASE: 'invalid-base'}, false);
    fs.mkdirSync(path.join(temporary, 'scripts'));
    fs.writeFileSync(path.join(temporary, 'scripts/fixture.mjs'), '// shared');
    const shared = commit();
    assert.deepEqual(select({BEFORE: changed, SHA: shared}), {publish: [], tests: all});
    assert.deepEqual(select({SHA: shared}), {publish: ['deepl-translate-node'], tests: all});
    assert.deepEqual(select({EVENT: 'pull_request', SHA: shared}), {publish: [], tests: all});
    fs.rmSync(path.join(temporary, 'skills/wpf-desktop'), {recursive: true, force: true});
    const deleted = commit();
    assert.deepEqual(select({BEFORE: shared, SHA: deleted}), {publish: [], tests: []});
  } finally { fs.rmSync(temporary, {recursive: true, force: true}); }
});

test('isolated installation selection does not install or run unrelated Skills', () => {
  const env = {...process.env, TEST_SKILLS: '["deepl-translate-node"]'};
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ['--test', 'scripts/skill-installation.test.mjs'], {
    cwd: root, env, encoding: 'utf8', timeout: 10000,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /deepl-translate-node works/);
  assert.doesNotMatch(result.stdout, /html-shot works|desktop-app-standard works|wpf-desktop works/);
});

test('publishing accepts skipped WPF checks and rejects failed or cancelled dependencies', () => {
  const workflow = yaml.load(fs.readFileSync(path.join(root, '.github/workflows/publish-clawhub.yml'), 'utf8'));
  assert.equal(workflow.jobs['wpf-packaging'].needs, 'detect');
  const condition = workflow.jobs.publish.if.replace(/^\$\{\{\s*|\s*\}\}$/g, '')
    .replaceAll('needs.wpf-packaging', "needs['wpf-packaging']");
  for (const [event, detected, packaged, skills, cancelled, expected] of [
    ['push', 'success', 'skipped', '["deepl-translate-node"]', false, true],
    ['push', 'success', 'success', '["wpf-desktop"]', false, true],
    ['push', 'success', 'failure', '["wpf-desktop"]', false, false],
    ['push', 'failure', 'skipped', '["deepl-translate-node"]', false, false],
    ['pull_request', 'success', 'success', '["wpf-desktop"]', false, false],
    ['push', 'success', 'skipped', '[]', false, false],
    ['push', 'success', 'skipped', '["deepl-translate-node"]', true, false],
  ]) {
    assert.equal(vm.runInNewContext(condition, {
      github: {event_name: event}, cancelled: () => cancelled,
      needs: {detect: {result: detected, outputs: {skills}}, 'wpf-packaging': {result: packaged}},
    }), expected, `${event}: ${detected}/${packaged}, cancelled=${cancelled}`);
  }
});

test('desktop metadata agrees with the runtime tool version', () => {
  const metadata = parseSkillMetadata(fs.readFileSync(path.join(root, 'skills/desktop-app-standard/SKILL.md'), 'utf8'));
  assert.equal(getSkillVersion(metadata), TOOL_VERSION);
});

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
      for (const version of ['1.2.2', '01.02.3', '1.2.3-1..2', 'v1.2.4', '1.2.3+build']) {
        fs.writeFileSync(skillFile, source(`metadata:\n  version: "${version}"`, 'Changed'));
        const invalid = run(process.execPath, ['scripts/validate-skills.mjs', '--changed-since', 'HEAD']);
        assert.equal(invalid.status, 1, `${version}: ${invalid.stdout}`);
        assert.match(invalid.stderr, /valid semver|must increase/);
      }
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

test('bundle validation uses publisher ignores and checks installed Markdown references', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-bundle-'));
  assert.equal(path.dirname(temporary), path.resolve(os.tmpdir()));
  try {
    fs.mkdirSync(path.join(temporary, 'scripts'));
    const fixture = path.join(temporary, 'skills/fixture');
    fs.mkdirSync(fixture, {recursive: true});
    fs.symlinkSync(path.join(root, 'node_modules'), path.join(temporary, 'node_modules'), 'junction');
    for (const name of ['validate-skills.mjs', 'skill-metadata.mjs']) {
      fs.copyFileSync(path.join(root, 'scripts', name), path.join(temporary, 'scripts', name));
    }
    fs.writeFileSync(path.join(fixture, 'SKILL.md'), '---\nname: fixture\ndescription: Fixture\nmetadata:\n  version: "1.0.0"\n  openclaw:\n    files: [resource.md]\n---\n[resource](resource.md)\n');
    fs.writeFileSync(path.join(fixture, 'resource.md'), '[missing](../../README.md)\n');
    const validate = () => spawnSync(process.execPath, ['scripts/validate-skills.mjs'], {
      cwd: temporary, encoding: 'utf8', timeout: 10000,
    });
    const outside = validate();
    assert.equal(outside.status, 1);
    assert.match(outside.stderr, /outside the publish bundle/);
    fs.writeFileSync(path.join(fixture, 'resource.md'), '# Resource\n');
    for (const ignore of ['.gitignore', '.clawhubignore', '.clawdhubignore']) {
      fs.writeFileSync(path.join(fixture, ignore), 'resource.md\n');
      const ignored = validate();
      assert.equal(ignored.status, 1);
      assert.match(ignored.stderr, /which clawhub never uploads/);
      fs.writeFileSync(path.join(fixture, ignore), '*.md\n!SKILL.md\n!resource.md\n');
      const restored = validate();
      assert.equal(restored.status, 0, restored.stderr);
      fs.unlinkSync(path.join(fixture, ignore));
    }
  } finally {
    fs.rmSync(temporary, {recursive: true, force: true});
  }
});

test('validation and publishing use the locked ClawHub toolchain', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  const installed = JSON.parse(fs.readFileSync(path.join(root, 'node_modules/clawhub/package.json'), 'utf8'));
  assert.equal(installed.version, pkg.devDependencies.clawhub);
  assert.equal(lock.packages['node_modules/clawhub'].version, installed.version);
  assert.equal(pkg.scripts['publish:skill'], 'clawhub publish');
  const workflow = yaml.load(fs.readFileSync(path.join(root, '.github/workflows/publish-clawhub.yml'), 'utf8'));
  for (const job of ['detect', 'publish']) {
    assert.ok(workflow.jobs[job].steps.some(step => step.run === 'npm ci'));
  }
  assert.match(workflow.jobs.publish.steps.at(-1).run, /^npm run publish:skill -- /);
});

function mockedCommand(file, setup) {
  return spawnSync(process.execPath, ['--input-type=module'], {
    cwd: root, encoding: 'utf8', timeout: 10000,
    input: setup + '\nawait import(' + JSON.stringify(pathToFileURL(path.join(root, file)).href) + ');',
  });
}

test('registry rejects unknown and missing slug values before any request', () => {
  for (const args of [
    ['--slug', 'missing-skill-fixture'],
    ['--slug'],
    ['--slug', '--verbose'],
  ]) {
    const result = mockedCommand('scripts/audit-warnings.mjs', `
      process.argv = ['node', 'audit-warnings.mjs', ...${JSON.stringify(args)}];
      globalThis.fetch = () => { throw new Error('unexpected network request'); };
    `);
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /unknown skill|--slug requires a skill name/);
    assert.doesNotMatch(result.stderr, /unexpected network request/);
    assert.equal(result.stdout, '');
  }
});

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
    await listenOnSafePort(server);
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

test('Electron templates run with CommonJS and ESM project roots', () => {
  const guide = 'skills/nextjs-to-electron/electron-files.md';
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-modules-'));
  const testFiles = ['resolvePath', 'store', 'locale', 'window-state'].map(name => `electron/${name}.test.js`);
  try {
    fs.mkdirSync(path.join(temporary, 'electron'));
    fs.mkdirSync(path.join(temporary, 'scripts'));
    fs.mkdirSync(path.join(temporary, 'node_modules/electron'), {recursive: true});
    fs.writeFileSync(path.join(temporary, 'electron/package.json'), snippet(guide, '### electron/package.json', 'json'));
    for (const name of ['constants', 'resolvePath', 'store', 'locale', 'window-state',
      'resolvePath.test', 'store.test', 'locale.test', 'window-state.test']) {
      const file = `electron/${name}.js`;
      fs.writeFileSync(path.join(temporary, file), snippet(guide, `### ${file}`, 'js'));
    }
    fs.writeFileSync(path.join(temporary, 'scripts/electron-dev.cjs'), snippet(guide, '### scripts/electron-dev.cjs', 'js'));
    // Stand in for the Electron binary with Node, which runs a probe through the real launcher.
    fs.writeFileSync(path.join(temporary, 'node_modules/electron/index.js'), 'module.exports = process.execPath;');
    fs.writeFileSync(path.join(temporary, 'probe.cjs'), `
      require('node:assert/strict').equal(process.env.ELECTRON_DEV, '1');
      console.log('Development launcher reached the app');
    `);
    for (const type of ['commonjs', 'module']) {
      fs.writeFileSync(path.join(temporary, 'package.json'), JSON.stringify({type, main: 'probe.cjs'}));
      const env = {...process.env, TEMP: temporary, TMP: temporary, TMPDIR: temporary};
      delete env.NODE_TEST_CONTEXT;
      const options = {cwd: temporary, encoding: 'utf8', timeout: 10000, env};
      const tests = spawnSync(process.execPath, ['--test', ...testFiles], options);
      assert.equal(tests.status, 0, `${type}: ${tests.stdout}\n${tests.stderr}`);
      assert.match(tests.stdout, /(?:#|ℹ) tests [1-9]\d*/);
      const launcher = spawnSync(process.execPath, ['scripts/electron-dev.cjs'], options);
      assert.equal(launcher.status, 0, `${type}: ${launcher.stderr}`);
      assert.match(launcher.stdout, /Development launcher reached the app/);
    }
  } finally {
    fs.rmSync(temporary, {recursive: true, force: true});
  }
});

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

test('Tauri documented version command works in CommonJS and ESM projects', () => {
  const guide = 'skills/nextjs-to-tauri/tauri-files.md';
  const source = snippet(guide, '## `update-version.cjs`', 'js');
  const command = fs.readFileSync(path.join(root, guide), 'utf8')
    .match(/"update-version": "node ([^"]+)"/)[1];
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'tauri-version-'));
  assert.equal(path.dirname(temporary), path.resolve(os.tmpdir()));
  try {
    fs.mkdirSync(path.join(temporary, 'src-tauri'));
    fs.writeFileSync(path.join(temporary, command), source);
    const configPath = path.join(temporary, 'src-tauri/tauri.conf.json');
    const packagePath = path.join(temporary, 'package.json');
    for (const type of ['commonjs', 'module']) {
      const pkg = JSON.stringify({type, version: '2.3.4', scripts: {'update-version': `node ${command}`}});
      fs.writeFileSync(packagePath, pkg);
      const config = {version: '1.0.0', identifier: 'test.fixture', bundle: {createUpdaterArtifacts: true}};
      fs.writeFileSync(configPath, JSON.stringify(config));
      for (let attempt = 0; attempt < 2; attempt++) {
        const result = spawnSync(process.execPath, [command], {
          cwd: temporary, encoding: 'utf8', timeout: 10000,
        });
        assert.equal(result.status, 0, `${type}: ${result.stderr}`);
        assert.deepEqual(JSON.parse(fs.readFileSync(configPath, 'utf8')), {...config, version: '2.3.4'});
        assert.equal(fs.readFileSync(packagePath, 'utf8'), pkg);
        assert.equal(fs.readFileSync(path.join(temporary, command), 'utf8'), source);
      }
    }
  } finally {
    fs.rmSync(temporary, {recursive: true, force: true});
  }
});

test('Tauri locale restoration preserves complete locale segments and the current URL', () => {
  const guide = 'skills/nextjs-to-tauri/frontend-integration.md';
  const source = snippet(guide, '`desktop/useLanguagePreference.ts`', 'ts')
    .replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
  const load = (pathname, preference) => {
    const state = {pathname, preference, redirects: [], writes: []};
    const context = {
      useEffect: effect => effect(), usePathname: () => state.pathname,
      useRouter: () => ({replace: url => state.redirects.push(url)}),
      isTauriRuntime: () => true,
      localStorage: {getItem: () => state.preference, setItem: (...args) => state.writes.push(args)},
      window: {location: {search: '?from=desktop', hash: '#details'}},
    };
    vm.runInNewContext(stripTypeScriptTypes(source) + '\nglobalThis.restore = useLanguagePreference;', context);
    return {state, restore: context.restore};
  };
  const regional = load('/zh-Hant-TW/tool', 'en');
  regional.restore(['en', 'zh-Hant-TW']);
  assert.deepEqual(regional.state.redirects, ['/en/tool?from=desktop#details']);
  assert.deepEqual(regional.state.writes, []);
  regional.state.pathname = '/en/tool';
  regional.state.preference = 'zh-Hant-TW';
  regional.restore(['en', 'zh-Hant-TW']);
  assert.equal(regional.state.redirects.length, 1, 'layout remount must not repeat startup restoration');

  const nonLocale = load('/english/tool', 'zh');
  nonLocale.restore(['en', 'zh']);
  assert.deepEqual(nonLocale.state.redirects, []);

  const switcher = snippet(guide, '**Language switcher**', 'ts').replace(/^import .*;\n/gm, '');
  const pushes = [], preferences = [];
  const context = {pathname: '/zh-Hant-TW/tool', router: {push: url => pushes.push(url)},
    window: {location: {search: '?from=desktop', hash: '#details'}},
    isTauriRuntime: () => true, setPreferredLanguage: locale => preferences.push(locale)};
  vm.runInNewContext(stripTypeScriptTypes(switcher) + '\nglobalThis.pick = onPick;', context);
  context.pick('en');
  assert.deepEqual(pushes, ['/en/tool?from=desktop#details']);
  assert.deepEqual(preferences, ['en']);
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


test('Tauri migration retains its optional verifier and per-build proof before attestation', () => {
  const canonical = fs.readFileSync(path.join(root, 'skills/desktop-app-standard/scripts/release-assets.mjs'), 'utf8');
  assert.equal(fs.readFileSync(path.join(root, 'skills/nextjs-to-tauri/release-assets.mjs'), 'utf8'), canonical);
  for (const [file, buildName, verifyName] of [
    ['skills/nextjs-to-tauri/desktop-build.yml', 'publish-tauri', 'verify-draft'],
  ]) {
    const workflow = yaml.load(fs.readFileSync(path.join(root, file), 'utf8'));
    const build = workflow.jobs[buildName];
    assert.ok(build.steps.some(step => step.run?.includes('release-assets.mjs record') && step.env.ARTIFACT_PATHS.includes('steps.tauri.outputs.artifactPaths')));
    assert.ok(build.steps.some(step => step.uses?.startsWith('actions/upload-artifact') && step.with.name.includes('tauri-evidence')));
    const steps = workflow.jobs[verifyName].steps;
    assert.ok(steps.some(step => step.uses?.startsWith('actions/download-artifact')));
    const verify = steps.findIndex(step => step.run?.includes('release-assets.mjs verify'));
    const attest = steps.findIndex(step => step.uses?.startsWith('actions/attest@'));
    assert.ok(verify >= 0 && attest > verify);
    const expectedTargets = workflow.jobs[verifyName].env.TARGETS.split(' ').sort();
    assert.deepEqual(build.strategy.matrix.include.map(leg => leg.target).sort(), expectedTargets);
  }
});

function updaterHarness(update, events) {
  let source = snippet('skills/nextjs-to-tauri/frontend-integration.md', '## `desktop/updater.ts`', 'ts');
  source = source.replace('import { isTauri } from "./externalLink";', '')
    .replace('export interface', 'interface').replace('export const', 'const')
    .replace('await import("@tauri-apps/plugin-updater")', 'plugin')
    .replace('await import("@tauri-apps/plugin-process")', 'processPlugin');
  const context = {isTauri: async () => true, plugin: {check: async () => update},
    processPlugin: {relaunch: async () => { events.push('restart'); }}, console: {error: () => {}}};
  vm.runInNewContext(stripTypeScriptTypes(source) + '\nglobalThis.checkForUpdates = checkForUpdates;', context);
  return context;
}

test('Tauri update closes on cancellation and failure, and restarts after installation', async () => {
  for (const failure of [null, 'download', 'install']) {
    const events = [];
    const update = {version: '1.2.3', download: async () => { events.push('download'); if (failure === 'download') throw new Error('download failed'); },
      install: async () => { events.push('install'); if (failure === 'install') throw new Error('install failed'); },
      close: async () => { events.push('close'); }};
    const context = updaterHarness(update, events);
    const result = await context.checkForUpdates();
    if (failure === 'download') {
      assert.equal(result.hasUpdate, false);
      assert.match(result.error, /download failed/);
      assert.deepEqual(events, ['download', 'close']);
      continue;
    }
    if (failure === 'install') await assert.rejects(result.install(), /install failed/);
    else await result.install();
    await result.close();
    await assert.rejects(result.install(), /already been released/);
    assert.deepEqual(events, failure ? ['download', 'install', 'close'] : ['download', 'install', 'restart', 'close']);
  }
  const events = [];
  const context = updaterHarness({version: '1.2.3', download: async () => events.push('download'), close: async () => events.push('close')}, events);
  const result = await context.checkForUpdates();
  await result.close();
  await result.close();
  assert.deepEqual(events, ['download', 'close']);
});

test('Tauri update dialog clears loading, releases skipped updates and cleans up on unmount', async () => {
  for (const outcome of ['success', 'failure', 'cancel', 'unmount']) {
    const events = [], callbacks = [], cleanup = [];
    let dialog;
    const result = {hasUpdate: true, downloaded: true, version: '1.2.3',
      install: async () => { events.push('install'); if (outcome === 'failure') throw new Error('failed'); }, close: async () => events.push('close')};
    let source = snippet('skills/nextjs-to-tauri/frontend-integration.md', '## `desktop/useAutoUpdate.ts`', 'ts');
    source = source.replace(/^import .*$/gm, '').replace('export const', 'const');
    const context = {useRef: value => ({current: value}), useCallback: callback => { callbacks.push(callback); return callback; },
      useEffect: effect => cleanup.push(effect()), isTauri: async () => true, checkForUpdates: async () => result,
      localStorage: {getItem: () => null, setItem: (_key, value) => events.push(value)}, console: {error: () => {}},
      App: {useApp: () => ({modal: {confirm: options => { dialog = options; return {destroy: () => events.push('destroy-dialog')}; }},
        message: {loading: () => events.push('loading'), destroy: () => events.push('clear-loading'), error: () => events.push('error')}})},
      setTimeout: () => 1, clearTimeout: () => {}, setInterval: () => 1, clearInterval: () => {}};
    vm.runInNewContext(stripTypeScriptTypes(source) + '\nglobalThis.useAutoUpdate = useAutoUpdate;', context);
    context.useAutoUpdate();
    await callbacks[1]();
    if (outcome === 'cancel') { await dialog.onCancel(); assert.deepEqual(events, ['1.2.3', 'close']); }
    else if (outcome === 'unmount') { cleanup[0](); await Promise.resolve(); assert.deepEqual(events, ['destroy-dialog', 'close']); }
    else {
      await dialog.onOk();
      assert.ok(events.includes('clear-loading') && events.includes('close'));
      assert.equal(events.includes('error'), outcome === 'failure');
    }
  }
});

test('Electron release template verifies the current ZIP and rejects stale assets before publication', () => {
  const workflow = yaml.load(snippet('skills/nextjs-to-electron/electron-files.md', '### .github/workflows/electron.yml', 'yaml'));
  const steps = workflow.jobs.build.steps;
  const versionStep = steps.findIndex(step => step.name === 'Set the release version from the tag');
  assert.ok(versionStep >= 0 && versionStep < steps.findIndex(step => step.run === 'yarn electron:build'));
  const code = steps.find(step => step.name === 'Verify the draft assets and publish on tag').run.match(/node <<'NODE'\n([\s\S]*?)\nNODE/)[1];
  for (const failure of [null, 'stale', 'digest', 'tag', 'version', 'published', 'older']) {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-release-'));
    assert.equal(path.dirname(temporary), path.resolve(os.tmpdir()));
    try {
      const tag = 'v1.2.3', commit = 'a'.repeat(40);
      fs.mkdirSync(path.join(temporary, 'dist-electron'));
      const name = `TextDiff-${tag}-win.zip`;
      fs.writeFileSync(path.join(temporary, 'dist-electron', name), 'this build');
      fs.writeFileSync(path.join(temporary, 'package.json'), JSON.stringify({version: failure === 'version' ? '0.0.1' : '1.2.3'}));
      const commands = [];
      let assets = [];
      const digest = file => createHash('sha256').update(fs.readFileSync(path.join(temporary, file))).digest('hex');
      const execFileSync = (command, args) => {
        if (command === 'git') return commit;
        assert.equal(command, 'gh');
        commands.push(args);
        const endpoint = args.find(arg => arg.startsWith('repos/'));
        if (args[0] === 'release' && args[1] === 'upload') {
          assets = [{name, digest: 'sha256:' + digest('dist-electron/' + name)},
            {name: 'SHA256SUMS', digest: 'sha256:' + digest('dist-electron/SHA256SUMS')}];
          if (failure === 'stale') assets.push({name: 'old.zip', digest: 'sha256:old'});
          if (failure === 'digest') assets[0].digest = 'sha256:wrong';
        }
        if (args.includes('PATCH')) return '{}';
        if (endpoint?.includes('/assets?')) return JSON.stringify([assets]);
        if (endpoint?.includes('/releases?')) return JSON.stringify([[{id: 41, tag_name: tag, draft: failure !== 'published'},
          ...(failure === 'older' ? [{tag_name: 'v9.0.0', draft: false, prerelease: false}] : [])]]);
        if (endpoint?.includes('/commits/')) return JSON.stringify({sha: failure === 'tag' ? 'b'.repeat(40) : commit});
        if (endpoint?.endsWith('/releases/latest')) return JSON.stringify({tag_name: tag});
        return JSON.stringify({id: 41, draft: true});
      };
      const modules = {'node:fs': {
        readFileSync: (file, ...args) => fs.readFileSync(path.join(temporary, file), ...args),
        writeFileSync: (file, ...args) => fs.writeFileSync(path.join(temporary, file), ...args),
      }, 'node:crypto': {createHash}, 'node:child_process': {execFileSync}};
      const execute = () => vm.runInNewContext(code, {require: name => modules[name], process: {env: {REPO: 'org/app', GITHUB_REF_NAME: tag}}});
      if (failure && failure !== 'older') assert.throws(execute);
      else execute();
      const promotion = commands.filter(args => args.includes('PATCH'));
      assert.equal(promotion.length, !failure || failure === 'older' ? 1 : 0, failure);
      if (failure === 'older') assert.ok(promotion[0].includes('make_latest=false'));
    } finally { fs.rmSync(temporary, {recursive: true, force: true}); }
  }
});
