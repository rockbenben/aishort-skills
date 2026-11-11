import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import yaml from 'js-yaml';

const workflow = yaml.load(fs.readFileSync('skills/wpf-desktop/templates/ci.yml', 'utf8'));

test('default desktop workflows publish directly through gated release jobs', () => {
  const tauri = yaml.load(fs.readFileSync('skills/desktop-app-standard/templates/workflows/release-tauri.yml', 'utf8'));
  const electron = yaml.load(fs.readFileSync('skills/desktop-app-standard/templates/workflows/release-electron.yml', 'utf8'));
  for (const config of [tauri, electron, workflow]) {
    for (const job of Object.values(config.jobs)) {
      assert.equal(job.environment, undefined);
      assert.ok(!job.steps.some(step => step.with?.draft === true || step.with?.releaseDraft === true));
    }
  }
  assert.equal(tauri.jobs.build.needs, 'validate');
  assert.equal(tauri.jobs.build.steps.find(step => step.uses?.startsWith('tauri-apps/tauri-action')).with.releaseDraft, false);
  assert.deepEqual(electron.jobs.publish.needs, ['validate', 'build']);
  assert.equal(electron.jobs.publish.steps.at(-1).with.draft, false);
  assert.equal(workflow.jobs.release.needs, 'test');
  assert.equal(workflow.jobs.release.steps.at(-1).with.draft, false);
});

test('Tauri default workflow delegates complete feed and digest verification', () => {
  const tauri = yaml.load(fs.readFileSync('skills/desktop-app-standard/templates/workflows/release-tauri.yml', 'utf8'));
  const step = tauri.jobs.verify.steps.find(step => step.run?.includes('verify-release'));
  assert.match(step.run, /gh api.*release.json/);
  assert.match(step.run, /release-assets.mjs verify-release/);
  assert.equal(tauri.jobs.verify.env.PLATFORMS.split(' ').length, 6);
});

test('Electron stable release validates tags before building', () => {
  const electron = yaml.load(fs.readFileSync('skills/desktop-app-standard/templates/workflows/release-electron.yml', 'utf8'));
  const guard = electron.jobs.validate.steps.find(step => step.id === 'version').run.split('\n')[0];
  const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
  for (const tag of ['v1.2.3', 'v1.2.3-beta.1', 'main']) {
    const result = spawnSync(bash, ['-c', guard], {encoding: 'utf8', env: {...process.env, TAG: tag}});
    assert.equal(result.status === 0, tag === 'v1.2.3', result.error?.message || result.stderr);
  }
});

test('WPF package step preserves external resources and runs the unpacked program', {
  skip: process.platform !== 'win32', timeout: 120000,
}, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wpf-package-regression-'));
  const markerName = path.basename(root) + '.txt';
  const marker = path.join(os.tmpdir(), markerName);
  const run = (command, args, env = {}) => spawnSync(command, args, {
    cwd: root, encoding: 'utf8', timeout: 90000, env: {...process.env, ...env},
  });
  try {
    fs.writeFileSync(path.join(root, 'Xxx.csproj'), '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net10.0</TargetFramework><UseAppHost>true</UseAppHost></PropertyGroup></Project>');
    fs.copyFileSync('skills/wpf-desktop/templates/UpdatePackage.cs', path.join(root, 'UpdatePackage.cs'));
    fs.writeFileSync(path.join(root, 'Program.cs'), `
      using System;
      using System.IO;
      if (DesktopDelivery.UpdatePackage.SelectZip(new[] { "Xxx-v1.2.3-win-x64.zip", "Xxx-v1.2.3-win-arm64-needs-dotnet10.zip", "Xxx-v1.2.3-win-arm64.zip" }, "Xxx", "v1.2.3", System.Runtime.InteropServices.Architecture.Arm64) != "Xxx-v1.2.3-win-arm64.zip") return 2;
      var x64Cache = DesktopDelivery.UpdatePackage.CacheDirectory("cache", "1.2.3", System.Runtime.InteropServices.Architecture.X64);
      var armCache = DesktopDelivery.UpdatePackage.CacheDirectory("cache", "1.2.3", System.Runtime.InteropServices.Architecture.Arm64);
      if (x64Cache == armCache || armCache == Path.Combine("cache", "1.2.3")) return 3;
      try { DesktopDelivery.UpdatePackage.CacheDirectory("cache", "../old", System.Runtime.InteropServices.Architecture.Arm64); return 5; }
      catch (ArgumentException) { }
      try { DesktopDelivery.UpdatePackage.Cpu(System.Runtime.InteropServices.Architecture.X86); return 6; }
      catch (PlatformNotSupportedException) { }
      if (!(Environment.GetEnvironmentVariable("APPDATA") ?? "").Contains("wpf-package-")) return 4;
      var resource = Path.Combine(AppContext.BaseDirectory, "resources", "required.txt");
      if (!File.Exists(resource) || File.ReadAllText(resource) != "required payload") return 1;
      File.AppendAllText(Environment.GetEnvironmentVariable("SMOKE_LOG"), AppContext.BaseDirectory + "\\n");
      File.WriteAllText(Path.Combine(Path.GetTempPath(), "${markerName}"), "OK");
      return 0;
    `);
    const build = run('dotnet', ['build', 'Xxx.csproj', '-c', 'Release', '-o', 'fixture']);
    assert.equal(build.status, 0, build.error?.message || build.stdout + build.stderr);
    const armBuild = run('dotnet', ['publish', 'Xxx.csproj', '-c', 'Release', '-r', 'win-arm64', '--self-contained', 'false', '-o', 'arm-fixture']);
    assert.equal(armBuild.status, 0, armBuild.stdout + armBuild.stderr);
    const fixture = path.join(root, 'fixture');
    fs.mkdirSync(path.join(fixture, 'resources'));
    fs.writeFileSync(path.join(fixture, 'resources/required.txt'), 'required payload');
    fs.writeFileSync(path.join(fixture, '.hidden-resource'), 'included');
    for (const arch of ['x64', 'arm64']) {
      for (const form of ['', '-needs-dotnet10']) {
        const target = path.join(root, `src/Xxx.App/bin/Release/publish-${arch}${form}`);
        fs.cpSync(fixture, target, {recursive: true});
        if (arch === 'arm64') fs.copyFileSync(path.join(root, 'arm-fixture/Xxx.exe'), path.join(target, 'Xxx.exe'));
      }
    }
    const packageStep = workflow.jobs.release.steps.find(step => step.id === 'package');
    fs.mkdirSync(path.join(root, 'tools'));
    fs.copyFileSync('skills/wpf-desktop/templates/package-release.ps1.txt', path.join(root, 'tools/package-release.ps1'));
    fs.copyFileSync(path.join(fixture, 'Xxx.exe'), path.join(root, 'Xxx-v1.2.3-setup.exe'));
    fs.writeFileSync(path.join(root, 'unrelated.zip'), 'not a release asset');
    fs.writeFileSync(path.join(root, 'package.ps1'), '$ErrorActionPreference = "Stop"\n' + packageStep.run.replace('-RequireSigning:', `-SmokeMarker '${markerName}' -RequireSigning:`));
    const env = {TAG: 'v1.2.3', INSTALLER: path.join(root, 'Xxx-v1.2.3-setup.exe'), RUNNER_TEMP: path.join(root, 'runner'), GITHUB_OUTPUT: path.join(root, 'outputs'), SMOKE_LOG: path.join(root, 'smokes')};
    fs.mkdirSync(env.RUNNER_TEMP);
    const packaged = run('pwsh', ['-NoProfile', '-File', 'package.ps1'], env);
    assert.equal(packaged.status, 0, packaged.error?.message || packaged.stdout + packaged.stderr);
    const smokes = fs.readFileSync(env.SMOKE_LOG, 'utf8').trim().split('\n');
    assert.equal(smokes.length, 2);
    assert.ok(smokes.every(dir => dir.includes('verify-x64')));
    const checksum = fs.readFileSync(path.join(root, 'SHA256SUMS.txt'), 'utf8');
    assert.equal(checksum.trim().split('\n').length, 5);
    assert.doesNotMatch(checksum, /unrelated|  SHA256SUMS/);
    const rerun = run('pwsh', ['-NoProfile', '-File', 'package.ps1'], env);
    assert.equal(rerun.status, 0, rerun.stdout + rerun.stderr);
    const rerunRows = fs.readFileSync(path.join(root, 'SHA256SUMS.txt'), 'utf8').trim().split('\n');
    assert.deepEqual(rerunRows.map(row => row.slice(66)), checksum.trim().split('\n').map(row => row.slice(66)));
    for (const row of rerunRows) assert.equal(row.slice(0, 64), createHash('sha256').update(fs.readFileSync(path.join(root, row.slice(66)))).digest('hex'));
    for (const arch of ['x64', 'arm64']) {
      for (const form of ['', '-needs-dotnet10']) {
        const listing = run('tar', ['-t', '-f', `Xxx-v1.2.3-win-${arch}${form}.zip`]);
        assert.equal(listing.status, 0, listing.stderr);
        assert.match(listing.stdout, /resources\/required.txt/);
        assert.match(listing.stdout, /\.hidden-resource/);
        assert.doesNotMatch(listing.stdout, /\.pdb/);
      }
    }
    // A missing external resource must make the same production smoke step fail.
    fs.unlinkSync(path.join(root, 'src/Xxx.App/bin/Release/publish-x64/resources/required.txt'));
    env.RUNNER_TEMP = path.join(root, 'runner-broken');
    fs.mkdirSync(env.RUNNER_TEMP);
    const broken = run('pwsh', ['-NoProfile', '-File', 'package.ps1'], env);
    assert.notEqual(broken.status, 0);
    assert.match(broken.stdout + broken.stderr, /Packaged smoke failed/);
    fs.writeFileSync(path.join(root, 'src/Xxx.App/bin/Release/publish-x64/resources/required.txt'), 'required payload');
    env.REQUIRE_SIGNING = 'true';
    const unsigned = run('pwsh', ['-NoProfile', '-File', 'package.ps1'], env);
    assert.notEqual(unsigned.status, 0);
    assert.match(unsigned.stdout + unsigned.stderr, /Configured signing did not produce valid signatures/);
    env.REQUIRE_SIGNING = 'false';
    const armExe = path.join(root, 'src/Xxx.App/bin/Release/publish-arm64/Xxx.exe');
    const armBytes = fs.readFileSync(armExe);
    fs.copyFileSync(path.join(fixture, 'Xxx.exe'), armExe);
    const wrongArch = run('pwsh', ['-NoProfile', '-File', 'package.ps1'], env);
    assert.notEqual(wrongArch.status, 0);
    assert.match(wrongArch.stdout + wrongArch.stderr, /Wrong PE architecture/);
    fs.writeFileSync(armExe, armBytes);
    const missingNative = run('pwsh', ['-NoProfile', '-File', 'tools/package-release.ps1', '-AppName', 'Xxx', '-Tag', 'v1.2.3',
      '-PublishRoot', 'src/Xxx.App/bin/Release', '-Installer', env.INSTALLER, '-RequiredFiles', 'e_sqlite3.dll'], env);
    assert.notEqual(missingNative.status, 0);
    assert.match(missingNative.stdout + missingNative.stderr, /Missing published file:[\s\S]*e_sqlite3/);
    const installerStep = workflow.jobs.release.steps.find(step => step.id === 'installer');
    fs.writeFileSync(path.join(root, 'installer.ps1'), '$ErrorActionPreference = "Stop"\n' + installerStep.run);
    const installer = run('pwsh', ['-NoProfile', '-File', 'installer.ps1'], env);
    assert.notEqual(installer.status, 0);
    assert.match(installer.stdout + installer.stderr, /Expected installer script/);
  } finally {
    fs.rmSync(marker, {force: true});
    fs.rmSync(root, {recursive: true, force: true});
  }
});
