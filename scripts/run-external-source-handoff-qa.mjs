// Keep a disposable native VS Code destination open while a tester copies from
// other apps. This process never reads or changes the operating-system clipboard.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { extensiveUiFixtures } from './extensive-ui-fixtures.mjs';

assert.equal(process.platform, 'darwin', 'This interactive handoff runner currently targets macOS.');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await mkdtemp(join(tmpdir(), 'mdlp-external-source-'));
const workspace = join(temporary, 'External Source QA');
const profile = join(temporary, 'profile');
const artifacts = join(root, '.vscode-test', process.env.MDLP_HANDOFF_ARTIFACTS ?? 'external-source-handoff');
const executable = '/Applications/Visual Studio Code.app/Contents/MacOS/Code';
// Extra input listeners can change browser event timing; allow untraced QA.
const traceInput = process.env.MDLP_HANDOFF_TRACE !== '0';
const report = { startedAt: new Date().toISOString(), executable, traceInput, checks: [], failures: [], pageErrors: [], editorErrors: [], completed: false, savedChecks: 0 };
let browser, child, page, frame, current, baseline, launchError, number = 0;
const baselines = new Map();
const observedFrames = new Map();
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
const respond = value => console.log(JSON.stringify(value));

// Send one JSON object per line: fixture, inspect, verify, or finish. All native
// clicks, focus changes, app switches, and key presses are performed separately
// by the human/CUA. CDP is only used for passive diagnostic observation.
try {
  await Promise.all([mkdir(workspace), mkdir(join(profile, 'User'), { recursive: true }), mkdir(artifacts, { recursive: true })]);
  const fixtures = {
    'Empty.md': '',
    'Paragraph.md': 'Replace this external paste target.',
    'Table.md': '# Table paste\n\n| Item | Status |\n| --- | --- |\n| Original | Keep |\n\nEnd of table.',
    'Code.md': '# Code paste\n\n```text\nOriginal code\n```\n\nEnd of code.',
    'Lock.md': '# Locked paste\n\nKeep this content unchanged.\n\n- [ ] Task remains unchecked.\n',
    ...(process.env.MDLP_EXTENSIVE_UI === '1' ? extensiveUiFixtures : {}),
  };
  for (const [name, text] of Object.entries(fixtures)) { await writeFile(join(workspace, name), text); baselines.set(name, text); }
  current = 'Paragraph.md'; baseline = fixtures[current];
  await writeFile(join(profile, 'User/settings.json'), JSON.stringify({
    'workbench.startupEditor': 'none', 'update.mode': 'none', 'telemetry.telemetryLevel': 'off',
    'window.dialogStyle': 'custom', 'files.autoSave': 'off', 'git.openRepositoryInParentFolders': 'never',
    'security.workspace.trust.enabled': false, 'mdLivePreview.defaultEditor': 'livePreview',
    'workbench.editorAssociations': { '*.md': 'mdLivePreview.editor' },
    'mdLivePreview.defaultEditingMode': 'editing', 'mdLivePreview.vault.openBehavior': 'newTab',
  }, null, 2));
  const port = await reservePort();
  child = spawn(executable, [workspace, join(workspace, current), '--new-window', '--disable-updates', '--disable-telemetry', '--skip-welcome', '--skip-release-notes',
    `--extensionDevelopmentPath=${root}`, `--user-data-dir=${profile}`, `--extensions-dir=${join(temporary, 'extensions')}`, `--remote-debugging-port=${port}`],
  { cwd: root, stdio: 'ignore', env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } });
  child.once('error', error => { launchError = error; });
  await wait(async () => { if (launchError) throw launchError; try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`); return true; } catch { return false; } }, 'VS Code startup', 30000);
  await wait(() => browser.contexts().flatMap(context => context.pages()).length > 0, 'workbench');
  page = browser.contexts().flatMap(context => context.pages())[0];
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => report.pageErrors.push({ message: String(error), check: report.activeCheck }));
  page.on('console', message => {
    if (message.type() === 'error' && (message.location().url.includes('/dist/webview-editor.js') || message.text().includes('CodeMirror plugin crashed'))) {
      report.editorErrors.push({ message: message.text(), check: report.activeCheck });
    }
  });
  respond({ ready: true, pid: child.pid, workspace, artifacts, fixtures: Object.keys(fixtures), commands: ['fixture', 'inspect', 'verify', 'finish'] });
  for await (const line of input) {
    if (!line.trim()) continue;
    let command;
    try {
      command = JSON.parse(line);
      if (command.action === 'finish') { report.completed = true; break; }
      const result = await dispatch(command);
      respond({ action: command.action, ok: true, ...result });
    } catch (error) {
      report.failures.push({ action: command?.action, check: report.activeCheck, error: String(error) });
      respond({ action: command?.action, ok: false, error: String(error),
        state: await inspect(command?.compact === true || command?.expectedSha256 !== undefined).catch(() => null) });
    }
    await writeReport();
  }
} catch (error) { report.failures.push({ error: String(error), stack: error.stack }); respond({ fatal: String(error) }); }
finally {
  input.close();
  await browser?.close().catch(() => {});
  if (child && child.exitCode === null) { child.kill(); await Promise.race([new Promise(done => child.once('exit', done)), delay(5000)]); }
  report.finishedAt = new Date().toISOString();
  report.passed = report.completed && !report.failures.length && !report.pageErrors.length && !report.editorErrors.length;
  await writeReport();
  await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  respond({ completed: report.completed, passed: report.passed, checks: report.checks.length, artifacts });
  if (!report.passed) process.exitCode = 1;
}

async function dispatch(command) {
  assert.ok(command && typeof command === 'object');
  if (command.action === 'fixture') {
    assert.equal(typeof command.label, 'string');
    const text = command.source ?? 'Replace this external paste target.';
    assert.equal(typeof text, 'string');
    report.activeCheck = command.label;
    current = `External-${String(++number).padStart(3, '0')}.md`;
    baseline = text;
    baselines.set(current, text);
    await writeFile(join(workspace, current), text);
    return { file: current, path: join(workspace, current), source: text };
  }
  if (command.file !== undefined) {
    assert.ok(baselines.has(command.file), 'Only synthetic fixture filenames are permitted.');
    current = command.file;
    baseline = baselines.get(current);
  }
  if (command.label !== undefined) { assert.equal(typeof command.label, 'string'); report.activeCheck = command.label; }
  await observeFrame();
  if (command.action === 'inspect') return inspect(command.compact === true);
  if (command.action === 'verify') {
    const matches = createExpectation(command);
    await wait(async () => {
      const actual = await source(), disk = await readFile(join(workspace, current), 'utf8');
      return actual === disk && matches(actual);
    }, 'exact editor and saved source', command.timeout ?? 10000);
    // Detect delayed duplicate paste or save replays after the initial match.
    await delay(500);
    const actual = await source(), disk = await readFile(join(workspace, current), 'utf8');
    assert.ok(matches(actual), 'Source changed after reaching the expected value.');
    assert.equal(disk, actual, 'Saved source differs from the verified editor source.');
    const check = { label: report.activeCheck, file: current, ...fingerprint(actual),
      events: await frame.evaluate(() => window.__externalHandoffEvents ?? []) };
    report.checks.push(check); report.savedChecks++;
    return { verified: true, bytes: check.bytes, sha256: check.sha256 };
  }
  throw new Error(`Unknown action: ${command.action}`);
}

async function observeFrame() {
  const retained = observedFrames.get(current);
  if (retained && !retained.isDetached()) { frame = retained; return; }
  await wait(async () => {
    const disk = await readFile(join(workspace, current), 'utf8');
    for (const candidate of page.frames()) if (!candidate.isDetached() && await candidate.locator('.cm-content').count()
      && await (await candidate.frameElement()).isVisible()
      && await candidate.evaluate(text => document.visibilityState === 'visible'
        && document.querySelector('.cm-content').cmTile.root.view.state.doc.toString() === text, disk).catch(() => false)) {
      frame = candidate; observedFrames.set(current, candidate); return true;
    }
    return false;
  }, 'active Markdown webview');
  if (traceInput) await trace();
}
async function source() { return frame.evaluate(() => document.querySelector('.cm-content').cmTile.root.view.state.doc.toString()); }
async function inspect(compact = false) {
  const actual = await source(), disk = await readFile(join(workspace, current), 'utf8');
  return { file: current, source: compact ? fingerprint(actual) : actual, disk: compact ? fingerprint(disk) : disk,
    state: await frame.evaluate(() => {
      const view = document.querySelector('.cm-content').cmTile.root.view;
      return { selection: { from: view.state.selection.main.from, to: view.state.selection.main.to }, activeTag: document.activeElement?.tagName,
        activeClass: document.activeElement?.className, locked: document.querySelector('.mlp-editing-mode-toggle')?.getAttribute('aria-pressed'),
        events: window.__externalHandoffEvents ?? [] };
    }), alerts: await frame.locator('[role="alert"]:visible').allTextContents() };
}
function fingerprint(text) { return { bytes: Buffer.byteLength(text), sha256: createHash('sha256').update(text).digest('hex') }; }
function createExpectation(command) {
  const hasHash = command.expectedSha256 !== undefined || command.expectedBytes !== undefined;
  const options = Number(command.expected !== undefined) + Number(command.unchanged === true) + Number(hasHash);
  assert.equal(options, 1, 'Use exactly one verification expectation: expected text, unchanged=true, or expectedSha256 plus expectedBytes.');
  if (hasHash) {
    assert.ok(typeof command.expectedSha256 === 'string' && /^[a-f0-9]{64}$/i.test(command.expectedSha256), 'Expected SHA-256 must be 64 hexadecimal characters.');
    assert.ok(Number.isSafeInteger(command.expectedBytes) && command.expectedBytes >= 0, 'Expected byte length must be a nonnegative safe integer.');
    const expectedHash = command.expectedSha256.toLowerCase();
    return text => { const value = fingerprint(text); return value.bytes === command.expectedBytes && value.sha256 === expectedHash; };
  }
  const expected = command.unchanged === true ? baseline : command.expected;
  assert.equal(typeof expected, 'string', 'Verification requires exact expected source or an existing unchanged fixture.');
  return text => text === expected;
}
async function trace() {
  await frame.evaluate(() => {
    if (window.__externalHandoffListener) return;
    window.__externalHandoffEvents = [];
    window.__externalHandoffListener = true;
    for (const type of ['keydown', 'paste', 'beforeinput', 'input', 'focusin', 'focusout']) document.addEventListener(type, event => {
      const events = window.__externalHandoffEvents;
      // Only event metadata is recorded; clipboard data stays in its source app.
      if (events.length < 500) events.push({ type, key: event.key, meta: event.metaKey, shift: event.shiftKey, inputType: event.inputType,
        target: event.target?.className, formats: event.clipboardData && [...event.clipboardData.types].map(type => ({ type,
          bytes: new TextEncoder().encode(event.clipboardData.getData(type)).length })),
        files: event.clipboardData && [...event.clipboardData.files].map(file => ({ type: file.type, bytes: file.size })) });
    }, true);
  });
}
async function writeReport() { await mkdir(artifacts, { recursive: true }); await writeFile(join(artifacts, 'report.json'), JSON.stringify(report, null, 2)); }
async function wait(condition, label, timeout = 10000) { const end = Date.now() + timeout; while (Date.now() < end) { if (await condition()) return; await delay(80); } throw new Error(`Timed out: ${label}`); }
async function reservePort() { const server = createServer(); await new Promise(done => server.listen(0, '127.0.0.1', done)); const port = server.address().port; await new Promise(done => server.close(done)); return port; }
