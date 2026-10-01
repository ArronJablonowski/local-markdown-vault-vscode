// Disposable native VS Code notes exercise navigation with real keyboard input.
// Read-only probes observe caret geometry; all selections come from UI gestures.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { downloadAndUnzipVSCode } from '@vscode/test-electron';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await mkdtemp(join(tmpdir(), 'mdlp-arrow-qa-'));
const workspace = join(temporary, 'Arrow QA Vault');
const profile = join(temporary, 'profile');
const artifacts = join(root, '.vscode-test', process.env.MDLP_ARROW_ARTIFACTS ?? 'arrow-navigation-ui');
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
const version = process.env.MDLP_QA_VSCODE_VERSION ?? '1.139.1';
const report = { startedAt: new Date().toISOString(), version, completed: false, passed: false, files: [], checks: [], failures: [], pageErrors: [], consoleErrors: [], samples: [], keyPresses: 0, pointerActions: 0 };
const objects = {
	HEADING: '### A heading with **bold** and *emphasis*\n\nA paragraph with `inline code`, ==highlight==, ~~deleted text~~, [local link](#arrow-report), $a^2$, and :smile:.',
	LIST: '- An intentionally long list item whose wrapped continuation should remain aligned with the first letter after the bullet. '.repeat(1) + 'Additional detail keeps this line wrapping as the cursor moves.\n  - Nested detail\n    - Third level\n- [x] Completed **task**\n- [ ] Remaining task\n\n1. Ordered item\n   1. Nested ordered item\n2. Final item',
	TABLE: '| Record | Explanation | Result |\n| --- | --- | --- |\n' + Array.from({ length: 16 }, (_, i) => `| Item ${i} | A long **formatted** explanation with a link [here](#arrow-report) | Retain |`).join('\n'),
	CODE: '```typescript\n// LONG_CODE_ ' + 'Retained long code comment. '.repeat(32) + '\n' + Array.from({ length: 12 }, (_, i) => `const value${i} = ${i}; // Arrow navigation`).join('\n') + '\n```',
	INDENTED: '    let first = 1;\n    let second = 2;\n    console.log(first + second);',
	FLOW: '```mermaid\nflowchart LR\nA[Capture] --> B{Review}\nB --> C[Retain]\n```',
	ER: '```mermaid\nerDiagram\nNOTE ||--o{ REVISION : has\nNOTE {\n string id PK\n string title\n}\nREVISION {\n int number\n}\n```',
	DRAWIO: '```drawio\n<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" value="Arrow review" vertex="1" parent="1"><mxGeometry x="0" y="0" width="180" height="75" as="geometry"/></mxCell></root></mxGraphModel>\n```',
	CALLOUT: '> [!warning]+ Review\n> Keep navigation within the note.\n>\n> - List entry\n>   - Nested entry\n>\n> | Name | Value |\n> | --- | --- |\n> | A | B |\n>\n> ```text\n> Example\n> ```',
	COLLAPSED: '> [!note]- Folded details\n> Hidden body\n> - Hidden list\n> Final hidden line',
	MATH: '$$\n\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}\n$$\n\nInline $x^2 + y^2$ stays local.',
	FOOTNOTE: 'A reference[^local] and a [[Local note|wiki alias]].\n\n[^local]: A local footnote definition.\n\n---',
};
let browser, child, page, frame, current, source;
try {
	await Promise.all([mkdir(workspace), mkdir(join(profile, 'User'), { recursive: true }), mkdir(artifacts, { recursive: true })]);
	await writeFile(join(profile, 'User/settings.json'), JSON.stringify({
		'workbench.startupEditor': 'none', 'update.mode': 'none', 'telemetry.telemetryLevel': 'off',
		'window.dialogStyle': 'custom', 'files.autoSave': 'off', 'git.openRepositoryInParentFolders': 'never',
		'security.workspace.trust.enabled': false, 'mdLivePreview.defaultEditor': 'livePreview',
		'mdLivePreview.defaultEditingMode': 'editing', 'mdLivePreview.vault.openBehavior': 'newTab',
		'mdLivePreview.showWhitespace': 'off', 'mdLivePreview.stickyTableHeaders': false,
	}, null, 2));
	for (const [index, minimum] of [150000, 600000, 1800000].entries()) {
		const text = makeNote(index + 1, minimum), name = `Arrow report ${index + 1}.md`;
		await writeFile(join(workspace, name), text);
		report.files.push({ name, bytes: Buffer.byteLength(text), lines: text.split('\n').length, sha256: hash(text) });
	}
	const port = await reservePort();
	child = spawn(await downloadAndUnzipVSCode(version), [workspace, '--new-window', '--disable-updates', '--disable-telemetry', '--skip-welcome', '--skip-release-notes',
		`--extensionDevelopmentPath=${root}`, `--user-data-dir=${profile}`, `--extensions-dir=${join(temporary, 'extensions')}`, `--remote-debugging-port=${port}`],
	{ cwd: root, stdio: 'ignore', env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } });
	await wait(async () => { try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`); return true; } catch { return false; } }, 'debug browser', 30000);
	await wait(() => browser.contexts().flatMap(context => context.pages()).length > 0, 'workbench');
	page = browser.contexts().flatMap(context => context.pages())[0];
	page.setDefaultTimeout(10000);
	page.on('pageerror', error => report.pageErrors.push(String(error)));
	page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()); });
	await page.bringToFront();
	await page.getByRole('tab', { name: /Local Markdown Vault/ }).click();
	await page.getByRole('treeitem', { name: 'File: Arrow report 1.md', exact: true }).waitFor({ timeout: 30000 });
	for (const file of report.files) {
		current = file.name; source = await readFile(join(workspace, current), 'utf8');
		await page.getByRole('treeitem', { name: `File: ${current}`, exact: true }).dblclick(); report.pointerActions++;
		await wait(async () => {
			for (const candidate of page.frames()) {
				if (candidate.isDetached() || !await candidate.locator('.cm-content').count()) continue;
				if (await candidate.evaluate(title => document.visibilityState === 'visible' && document.querySelector('.cm-content')?.cmTile?.root.view.state.doc.toString().startsWith(`---\ntitle: ${title}`), current.replace('.md', '')).catch(() => false)) { frame = candidate; return true; }
			}
			return false;
		}, 'visible note', 20000);
		for (const kind of Object.keys(objects)) {
			await check(`${current}: ${kind} ArrowDown and ArrowUp traversal`, () => vertical(kind));
			await check(`${current}: ${kind} horizontal and Shift selection at boundaries`, () => horizontal(kind));
		}
		await check(`${current}: word line and selection navigation`, async () => {
			await find('Additional detail'); await press('ArrowLeft');
			let previous = (await snapshot()).head;
			for (let i = 0; i < 4; i++) {
				await press(process.platform === 'darwin' ? 'Alt+ArrowRight' : 'Control+ArrowRight');
				const state = await observe('word-right'); assert.ok(state.head > previous); previous = state.head;
			}
			for (let i = 0; i < 4; i++) {
				await press(process.platform === 'darwin' ? 'Alt+ArrowLeft' : 'Control+ArrowLeft');
				const state = await observe('word-left'); assert.ok(state.head < previous); previous = state.head;
			}
			await press(process.platform === 'darwin' ? 'Meta+ArrowLeft' : 'Home'); await observe('line-start');
			const start = (await snapshot()).head;
			await press(process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End'); await observe('line-end');
			assert.ok((await snapshot()).head > start);
			const anchor = (await snapshot()).head;
			for (let i = 0; i < 6; i++) { await press('Shift+ArrowDown'); await observe('select-down'); }
			let selection = await snapshot(); assert.equal(selection.from, anchor); assert.ok(selection.to > anchor);
			for (let i = 0; i < 3; i++) { await press('Shift+ArrowUp'); await observe('select-up'); }
			const shortened = await snapshot(); assert.equal(shortened.from, anchor); assert.ok(shortened.to < selection.to);
			await press('ArrowRight'); await unchanged();
		});
		await check(`${current}: long code line horizontal visibility`, async () => {
			await find('LONG_CODE_'); await press('ArrowRight');
			await press(process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End');
			for (let i = 0; i < 20; i++) {
				await press('ArrowLeft'); const state = await observe('long-code-left');
				assert.ok(state.caret.right >= state.viewport.left - 2 && state.caret.left <= state.viewport.right + 2, 'Long code caret is horizontally clipped');
			}
			await unchanged();
		});
		await check(`${current}: page navigation and document edges`, async () => {
			await find('DOCUMENT_END'); await press('ArrowRight');
			const end = (await snapshot()).head;
			for (let i = 0; i < 5; i++) { await press('ArrowDown'); assert.equal((await snapshot()).head, end); }
			for (let i = 0; i < 8; i++) { await press('PageUp'); await observe('PageUp'); }
			for (let i = 0; i < 8; i++) { await press('PageDown'); await observe('PageDown'); }
			await press(`${mod}+Home`); await observe('document-start');
			assert.equal((await snapshot()).head, 0);
			for (let i = 0; i < 4; i++) await press('ArrowLeft');
			assert.equal((await snapshot()).head, 0);
			await unchanged();
		});
		file.finalSha256 = hash(await readFile(join(workspace, current), 'utf8'));
		assert.equal(file.finalSha256, file.sha256);
	}
	report.completed = true; report.passed = !report.failures.length && !report.pageErrors.length;
} catch (error) { report.failures.push({ error: String(error), stack: error.stack }); console.error(error); }
finally {
	report.finishedAt = new Date().toISOString();
	await writeFile(join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
	await browser?.close().catch(() => {});
	if (child && child.exitCode === null) { child.kill(); await Promise.race([new Promise(done => child.once('exit', done)), delay(5000)]); }
	await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
	if (!report.passed) process.exitCode = 1;
	console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, failures: report.failures.length, keys: report.keyPresses, samples: report.samples.length, artifacts }));
}

async function vertical(kind) {
	const before = `BEFORE_${kind}`, after = `AFTER_${kind}`;
	for (const [start, target, key, direction] of [[before, after, 'ArrowDown', 1], [after, before, 'ArrowUp', -1]]) {
		await find(start); await press('ArrowLeft');
		const targetPos = source.indexOf(target), limit = objects[kind].split('\n').length * 4 + 35;
		let previous = (await snapshot()).head, stalled = 0, reached = false;
		for (let i = 0; i < limit; i++) {
			await press(key); const state = await observe(`${kind}-${key}-${i}`);
			assert.ok(direction > 0 ? state.head >= previous : state.head <= previous, `${key} reversed direction from ${previous} to ${state.head}`);
			stalled = state.head === previous ? stalled + 1 : 0;
			assert.ok(stalled < 4, `${key} trapped at ${state.head}: ${state.lineText}`);
			previous = state.head;
			if (direction > 0 ? state.head >= targetPos : state.head <= targetPos + before.length) { reached = true; break; }
		}
		assert.ok(reached, `${key} did not cross ${kind}`);
		await unchanged();
	}
	await page.screenshot({ path: join(artifacts, `${current.replace('.md', '')}-${kind}.png`) });
}
async function horizontal(kind) {
	await find(`BEFORE_${kind}`); await press('ArrowRight');
	let previous = (await snapshot()).head;
	for (let i = 0; i < 24; i++) {
		await press('ArrowRight'); const state = await observe(`${kind}-right-${i}`);
		assert.ok(state.head > previous, `Right did not advance at ${previous}`); previous = state.head;
	}
	for (let i = 0; i < 12; i++) {
		await press('Shift+ArrowLeft'); const state = await observe(`${kind}-select-left-${i}`);
		assert.ok(state.head < previous && state.to > state.from, `Shift+Left did not extend selection at ${previous}`); previous = state.head;
	}
	await press('ArrowRight');
	await find(`AFTER_${kind}`); await press('ArrowLeft');
	previous = (await snapshot()).head;
	for (let i = 0; i < 16; i++) {
		await press('ArrowLeft'); const state = await observe(`${kind}-left-${i}`);
		assert.ok(state.head < previous, `Left did not advance at ${previous}`); previous = state.head;
	}
	await unchanged();
}
async function find(text) {
	await frame.locator('.cm-content').focus(); await press(`${mod}+f`);
	const input = frame.locator('.cm-search input[name="search"]');
	await input.click(); report.pointerActions++; await press(`${mod}+a`); await page.keyboard.type(text, { delay: 2 });
	await press('Enter'); await press('Escape');
	assert.equal((await snapshot()).selected, text, 'Find failed to locate navigation anchor');
}
async function press(key) { report.keyPresses++; await page.keyboard.press(key); }
async function snapshot() {
	return frame.evaluate(() => {
		const view = document.querySelector('.cm-content').cmTile.root.view, range = view.state.selection.main;
		// At a source/widget edge, measure the selected text's inward side just
		// like CodeMirror's native scroll target, not the next widget's box.
		const side = range.empty ? (range.assoc || 1) : range.head > range.anchor ? -1 : 1;
		const rect = view.coordsAtPos(range.head, side), bounds = view.scrollDOM.getBoundingClientRect();
		const selection = window.getSelection(), node = selection?.focusNode;
		const line = (node instanceof Element ? node : node?.parentElement)?.closest('.cm-line');
		return { head: range.head, from: range.from, to: range.to, assoc: range.assoc, caretSide: side, selected: view.state.sliceDoc(range.from, range.to), line: view.state.doc.lineAt(range.head).number,
			lineText: view.state.doc.lineAt(range.head).text, classes: line?.className, focus: view.hasFocus,
			caret: rect && { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right },
			viewport: { top: bounds.top, bottom: bounds.bottom, left: bounds.left, right: bounds.right }, scrollTop: view.scrollDOM.scrollTop };
	});
}
async function observe(label) {
	// Observe after CodeMirror's scheduled measurement, not halfway through a frame.
	await frame.evaluate(() => new Promise(done => requestAnimationFrame(() => setTimeout(done, 0))));
	const value = await snapshot(); report.samples.push({ file: current, label, ...value });
	assert.ok(value.focus, 'Arrow navigation lost editor focus');
	assert.ok(value.caret, 'Caret no longer has a rendered position');
	// A source-reveal resize can schedule another measurement in the next frame.
	if (value.caret.top < value.viewport.top - 2 || value.caret.bottom > value.viewport.bottom + 2) {
		await delay(120); const settled = await snapshot();
		assert.ok(settled.caret && settled.caret.top >= settled.viewport.top - 2 && settled.caret.bottom <= settled.viewport.bottom + 2, `Caret scrolled outside editor: ${JSON.stringify(settled)}`);
	}
	return value;
}
async function unchanged() {
	assert.equal(await frame.evaluate(() => document.querySelector('.cm-content').cmTile.root.view.state.doc.toString()), source, 'Navigation changed editor source');
	assert.equal(await readFile(join(workspace, current), 'utf8'), source, 'Navigation changed saved Markdown');
}
async function check(label, operation) {
	try { await operation(); report.checks.push(label); console.log(`PASS ${label}`); }
	catch (error) {
		report.failures.push({ label, error: String(error), stack: error.stack });
		await page.screenshot({ path: join(artifacts, `failure-${report.failures.length}.png`) }).catch(() => {});
		console.error(`FAIL ${label}: ${error}`); await press('Escape');
	}
	await writeFile(join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
}
async function wait(condition, label, timeout = 10000) {
	const end = Date.now() + timeout;
	while (Date.now() < end) { if (await condition()) return; await delay(100); }
	throw new Error(`Timed out: ${label}`);
}
async function reservePort() {
	const server = createServer(); await new Promise(done => server.listen(0, '127.0.0.1', done));
	const port = server.address().port; await new Promise(done => server.close(done)); return port;
}
function hash(text) { return createHash('sha256').update(text).digest('hex'); }
function makeNote(id, minimum) {
	let result = `---\ntitle: Arrow report ${id}\ntags: [qa, navigation]\n---\n\n# Arrow report\n\nSynthetic local-only arrow-key navigation notes.\n`;
	let n = 0;
	const filler = () => `\n## Retained context ${n++}\n\nText with **emphasis**, *italics*, and $x^2$ alongside a long paragraph that wraps naturally.\n\n- First item\n  - Nested detail\n- [ ] Review\n\n> [!note] Context\n> Retain every byte.\n\n| Item | Value |\n| --- | --- |\n| A | B |\n\n\`\`\`json\n{"local":true}\n\`\`\`\n`;
	while (Buffer.byteLength(result) < minimum / 2) result += filler();
	for (const [kind, object] of Object.entries(objects)) result += `\n\nBEFORE_${kind}\n\n${object}\n\nAFTER_${kind}\n`;
	while (Buffer.byteLength(result) < minimum) result += filler();
	return result + '\nDOCUMENT_END';
}
