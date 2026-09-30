// Native object-boundary QA uses disposable notes and real keyboard/pointer input.
// Read-only CodeMirror probes measure geometry and selection; they never edit notes.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { downloadAndUnzipVSCode } from '@vscode/test-electron';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await mkdtemp(join(tmpdir(), 'mdlp-object-boundary-'));
const workspace = join(temporary, 'Boundary QA Vault');
const profile = join(temporary, 'profile');
const artifacts = join(root, '.vscode-test', process.env.MDLP_BOUNDARY_ARTIFACTS ?? 'object-boundary-ui');
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
const version = process.env.MDLP_QA_VSCODE_VERSION ?? '1.139.1';
const report = { startedAt: new Date().toISOString(), completed: false, passed: false, version, files: [], checks: [], failures: [], pageErrors: [], consoleErrors: [], samples: [], typedCharacters: 0, keyPresses: 0, pointerActions: 0 };
const kinds = ['TABLE', 'CODE', 'INDENTED', 'ER', 'FLOW', 'DRAWIO', 'CALLOUT', 'MATH', 'LIST'];
let browser, child, page, frame, currentPath, expected, previousClipboard, fileIndex;

try {
	await Promise.all([mkdir(workspace, { recursive: true }), mkdir(join(profile, 'User'), { recursive: true }), mkdir(artifacts, { recursive: true })]);
	await writeFile(join(profile, 'User/settings.json'), JSON.stringify({
		'workbench.startupEditor': 'none', 'update.mode': 'none', 'telemetry.telemetryLevel': 'off',
		'window.dialogStyle': 'custom', 'files.autoSave': 'off', 'git.openRepositoryInParentFolders': 'never',
		'security.workspace.trust.enabled': false, 'mdLivePreview.defaultEditor': 'livePreview',
		'mdLivePreview.defaultEditingMode': 'editing', 'mdLivePreview.vault.openBehavior': 'newTab',
		'mdLivePreview.showWhitespace': 'off', 'mdLivePreview.stickyTableHeaders': false,
	}, null, 2));
	const sizes = [115000, 285000, 485000];
	if (process.env.MDLP_BOUNDARY_LARGE_EOF === '1') sizes.push(1900000);
	for (const [index, bytes] of sizes.entries()) {
		const name = `Boundary report ${index + 1}.md`;
		const source = makeNote(index + 1, bytes);
		await writeFile(join(workspace, name), source);
		report.files.push({ name, initialBytes: Buffer.byteLength(source), initialLines: source.split('\n').length, eofKind: index === 0 ? 'TABLE' : index === 2 ? 'CALLOUT' : 'CODE' });
	}
	if (process.platform === 'darwin') {
		previousClipboard = await commandOutput('pbpaste');
		await commandOutput('pbcopy', 'Synthetic boundary QA clipboard seed');
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
	page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push({ text: message.text(), location: message.location() }); });
	await page.bringToFront();
	await page.getByRole('tab', { name: /Local Markdown Vault/ }).click();
	await page.getByRole('treeitem', { name: 'File: Boundary report 1.md', exact: true }).waitFor({ timeout: 30000 });
	for (const [index, file] of report.files.entries()) {
		if (process.env.MDLP_BOUNDARY_FIRST_ONLY === '1' && index > 0) break;
		fileIndex = index + 1;
		currentPath = join(workspace, file.name);
		expected = await readFile(currentPath, 'utf8');
		await page.getByRole('treeitem', { name: `File: ${file.name}`, exact: true }).dblclick();
		frame = await editorFrame(`Boundary report ${fileIndex}`);
		file.tested = true;
		for (const kind of index < 3 ? kinds : []) {
			await check(`${file.name}: ${kind} preceding paragraph split, deletion and modified keys`, () => aboveBoundary(kind));
			await check(`${file.name}: ${kind} following paragraph joins and mouse replacement`, () => belowBoundary(kind));
		}
		await check(`${file.name}: end-of-file ${file.eofKind} escape`, () => eofBoundary(index));
		file.finalBytes = Buffer.byteLength(await disk());
		await writeFile(join(artifacts, `edited-${fileIndex}.md`), await disk());
		await screenshot(`final-${fileIndex}`);
	}
	const emptyTreeSamples = report.samples.filter(value => value.visibleVaultFiles === 0);
	if (emptyTreeSamples.length) report.failures.push({
		label: 'Vault file tree remains populated during document edits',
		error: `The file tree was empty in ${emptyTreeSamples.length} editing samples.`,
		samples: emptyTreeSamples.map(({ file, label, at }) => ({ file, label, at })),
	});
	report.completed = true;
	report.passed = report.failures.length === 0 && report.pageErrors.length === 0;
} catch (error) {
	report.failures.push({ error: String(error), stack: error.stack });
	console.error(error);
} finally {
	report.finishedAt = new Date().toISOString();
	await writeFile(join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
	await browser?.close().catch(() => {});
	if (child && child.exitCode === null) {
		child.kill();
		await Promise.race([new Promise(done => child.once('exit', done)), delay(5000)]);
	}
	if (previousClipboard !== undefined) await commandOutput('pbcopy', previousClipboard).catch(() => {});
	await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
	if (!report.passed) process.exitCode = 1;
	console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, failures: report.failures.length, typedCharacters: report.typedCharacters, samples: report.samples.length, artifacts }));
}

async function aboveBoundary(kind) {
	const marker = `BEFORE_${kind}_${fileIndex}`;
	await find(marker); await press('ArrowRight');
	await placeBoundaryNearTop(marker);
	if (['ER', 'FLOW', 'DRAWIO'].includes(kind)) {
		const title = { ER: 'REVISION', FLOW: 'Capture note', DRAWIO: 'Boundary review' }[kind];
		await wait(async () => (await frame.locator('.mlp-mermaid-wrap svg').allTextContents()).some(text => text.includes(title)), `rendered ${kind} below caret`, 20000);
	}
	if (kind === 'INDENTED') {
		const code = frame.locator('.mlp-line-code').filter({ hasText: 'const indentedValue0' }).first();
		await code.waitFor({ state: 'visible' });
		assert.ok(await code.getByRole('button', { name: 'Copy code block', exact: true }).count(), 'Indented code block lacks a copy control');
		await code.getByRole('button', { name: 'Copy code block', exact: true }).click(); report.pointerActions++;
		if (process.platform === 'darwin') {
			const copied = object('INDENTED', fileIndex).replace(/^ {4}/gm, '');
			await wait(async () => (await commandOutput('pbpaste')).toString() === copied, 'indented code clipboard content');
		}
		await code.getByRole('button', { name: 'Collapse code block', exact: true }).click(); report.pointerActions++;
		assert.equal(await frame.locator('.mlp-line-code').filter({ hasText: 'const indentedValue9' }).count(), 0, 'Indented block did not collapse');
		await code.getByRole('button', { name: 'Expand code block', exact: true }).click(); report.pointerActions++;
		await saved('indented code copy/fold controls never edit the source');
		await find(marker); await press('ArrowRight'); await placeBoundaryNearTop(marker);
	}
	await screenshot(`${fileIndex}-${kind}-before`);
	await type(' draft words');
	expected = expected.replace(marker, `${marker} draft words`);
	await saved('initial adjacent text');
	// Option+Backspace should delete a word without a delayed host command replay.
	await press(process.platform === 'darwin' ? 'Alt+Backspace' : 'Control+Backspace');
	await type('reviewed');
	expected = expected.replace(`${marker} draft words`, `${marker} draft reviewed`);
	await saved('modified word deletion followed immediately by typing');
	// Command+Backspace deletes this line prefix; short replacement text must stay prose.
	await press(process.platform === 'darwin' ? 'Meta+Backspace' : 'Home');
	if (process.platform !== 'darwin') { await press('Shift+End'); await press('Backspace'); }
	await type(marker);
	expected = expected.replace(`${marker} draft reviewed`, marker);
	await saved('modified prefix deletion followed immediately by typing');
	await press('Enter'); await type('abc');
	expected = expected.replace(marker, `${marker}\nabc`); await saved('split paragraph');
	for (let i = 0; i < 3; i++) await press('Backspace');
	expected = expected.replace(`${marker}\nabc`, `${marker}\n`); await saved('delete characters to empty line');
	await press('Backspace');
	expected = expected.replace(`${marker}\n\n\n`, `${marker}\n\n`); await saved('join paragraph at object edge');
	await press('Enter'); await press('Enter'); await type('New **boundary** note.');
	expected = expected.replace(marker, `${marker}\n\nNew **boundary** note.`);
	await saved('type formatted paragraph immediately above object');
	await sample(`${kind}-above-final`); await screenshot(`${fileIndex}-${kind}-above-final`);
}

async function belowBoundary(kind) {
	const marker = `AFTER_${kind}_${fileIndex}`;
	await find(marker); await press('ArrowLeft');
	const original = expected;
	await press('Backspace');
	expected = expected.replace(`\n\n${marker}`, `\n${marker}`);
	await saved('remove blank line immediately after object');
	// A second deletion intentionally merges the source boundary; Undo must recover it.
	await press('Backspace');
	expected = expected.replace(`\n${marker}`, marker);
	await saved('merge object boundary with following paragraph');
	await restoreWithUndo(original);
	await find(marker); await press('ArrowRight');
	await press('Enter'); await type('Second paragraph edge.');
	expected = expected.replace(marker, `${marker}\nSecond paragraph edge.`);
	await saved('split following paragraph');
	await press(process.platform === 'darwin' ? 'Meta+ArrowLeft' : 'Home');
	await press('Backspace');
	expected = expected.replace(`${marker}\nSecond paragraph edge.`, `${marker}Second paragraph edge.`);
	await saved('join following paragraph with modified navigation');
	await find('Second paragraph edge.'); await press('ArrowLeft');
	for (let i = 0; i < 7; i++) await press('Delete');
	expected = expected.replace(`${marker}Second paragraph edge.`, `${marker}paragraph edge.`);
	await saved('repeated forward deletion');
	await find(`${marker}paragraph edge.`);
	const line = frame.locator('.cm-line').filter({ hasText: `${marker}paragraph edge.` }).first();
	await line.scrollIntoViewIfNeeded();
	const box = await line.boundingBox(); assert.ok(box);
	await page.mouse.move(box.x + 5, box.y + box.height / 2); await page.mouse.down();
	await page.mouse.move(box.x + 135, box.y + box.height / 2, { steps: 20 }); await page.mouse.up();
	report.pointerActions += 4;
	const selection = await stateSelection();
	assert.ok(selection.text.length >= 3 && !selection.text.includes('\n'), `Unexpected pointer selection: ${JSON.stringify(selection)}`);
	const lineStart = expected.indexOf(`${marker}paragraph edge.`);
	assert.ok(selection.from >= lineStart && selection.to <= lineStart + `${marker}paragraph edge.`.length, 'Pointer selection jumped away from the adjacent paragraph');
	const prior = expected;
	await type('Reviewed');
	expected = prior.slice(0, selection.from) + 'Reviewed' + prior.slice(selection.to);
	await saved('pointer-selected text replacement');
	await sample(`${kind}-below-final`); await screenshot(`${fileIndex}-${kind}-below-final`);
}

async function eofBoundary(index) {
	const marker = `EOF_ANCHOR_${fileIndex}`;
	await find(marker); await press('ArrowRight');
	await sample('eof-before-escape');
	if (index === 0) {
		// Navigate out of the final table row into an independent paragraph using the editor command.
		await press(`${mod}+Enter`);
	} else if (index === 1 || index === 3) {
		await press(`${mod}+Enter`);
	} else {
		await press('Enter'); await press('Enter');
	}
	const beforeTyping = await frame.evaluate(() => document.querySelector('.cm-content').cmTile.root.view.state.doc.toString());
	assert.ok(beforeTyping.startsWith(expected) && /^\n+$/.test(beforeTyping.slice(expected.length)), 'EOF escape altered existing source instead of appending paragraph space');
	const selection = await stateSelection();
	await type('Independent final paragraph.');
	expected = beforeTyping.slice(0, selection.from) + 'Independent final paragraph.' + beforeTyping.slice(selection.to);
	await saved('end-of-file escape and typing');
	const outcome = await sample('eof-independent-paragraph');
	assert.ok(!outcome.lineClasses.some(value => /mlp-line-(?:code|quote|callout)|mlp-table-raw/.test(value)), `EOF paragraph retained object styling: ${JSON.stringify(outcome.lineClasses)}`);
	assert.ok(expected.endsWith('Independent final paragraph.'), 'Escape did not reach the end of the document');
	assert.ok(beforeTyping.includes(marker), 'Escape removed existing source text');
}

async function find(text) {
	await frame.locator('.cm-line').first().click(); report.pointerActions++;
	await press(`${mod}+f`);
	const input = frame.locator('.cm-search input[name="search"]');
	await input.click(); report.pointerActions++;
	await press(`${mod}+a`); await type(text, false);
	assert.equal(await input.inputValue(), text, 'Find lost typed characters');
	await press('Enter'); await press('Escape');
	assert.equal((await stateSelection()).text, text, 'Find close moved selection');
}
async function type(text, observe = true) {
	for (const [index, character] of Array.from(text).entries()) {
		await page.keyboard.type(character, { delay: 3 }); report.typedCharacters++;
		if (observe && (index < 4 || index % 10 === 0)) {
			const geometry = await sample(`typed-${text.slice(0, 18)}-${index}`);
			assert.ok(!geometry.lineClasses.some(value => /mlp-line-(?:code|quote|callout)|mlp-table-raw/.test(value)), `Adjacent prose inherited object styling: ${JSON.stringify(geometry.lineClasses)}`);
		}
		if (observe && index === 1 && text === 'New **boundary** note.') await screenshot(`${fileIndex}-transient-${report.samples.length}`);
	}
}
async function placeBoundaryNearTop(marker) {
	const line = frame.locator('.cm-line').filter({ hasText: marker }).first();
	for (let attempt = 0; attempt < 2; attempt++) {
		const box = await line.boundingBox(), viewport = await frame.locator('.cm-scroller').boundingBox();
		assert.ok(box && viewport);
		const displacement = box.y - viewport.y - 100;
		if (Math.abs(displacement) < 30) break;
		await page.mouse.move(box.x + 20, box.y + box.height / 2);
		await page.mouse.wheel(0, displacement); report.pointerActions += 2;
		await delay(250);
	}
}
async function press(key) { report.keyPresses++; await page.keyboard.press(key); }
async function stateSelection() {
	return frame.evaluate(() => {
		const state = document.querySelector('.cm-content').cmTile.root.view.state, range = state.selection.main;
		return { from: range.from, to: range.to, head: range.head, text: state.sliceDoc(range.from, range.to) };
	});
}
async function sample(label) {
	const value = await frame.evaluate(() => {
		const content = document.querySelector('.cm-content'), state = content.cmTile.root.view.state;
		const languageState = state.values.find(value => value?.context?.tree && value?.tree?.topNode);
		const range = state.selection.main, selection = window.getSelection();
		const node = selection?.anchorNode, element = node instanceof Element ? node : node?.parentElement;
		const line = element?.closest('.cm-line'), scroller = document.querySelector('.cm-scroller');
		const bounds = line?.getBoundingClientRect(), style = line && getComputedStyle(line);
		const ancestry = []; for (let el = line; el && el !== content; el = el.parentElement) ancestry.push(el.className);
		return { selection: { from: range.from, to: range.to, text: state.sliceDoc(range.from, range.to), line: state.doc.lineAt(range.head).number },
			documentLength: state.doc.length, parsedLength: languageState?.tree.length, parseContextLength: languageState?.context.tree.length,
			lineText: line?.textContent, lineClasses: ancestry, color: style?.color, background: style?.backgroundColor,
			font: style?.fontFamily, x: bounds?.x, y: bounds?.y, width: bounds?.width, height: bounds?.height,
			scrollTop: scroller?.scrollTop, scrollLeft: scroller?.scrollLeft, viewportWidth: scroller?.clientWidth,
			tables: document.querySelectorAll('.mlp-table').length };
	});
	// Diagram SVGs live in shadow roots; Playwright's locator pierces those roots.
	value.diagrams = await frame.locator('.mlp-mermaid-wrap svg').count();
	value.visibleVaultFiles = await page.getByRole('treeitem', { name: /^File: Boundary report / }).count();
	report.samples.push({ file: fileIndex, label, at: Date.now(), ...value }); return value;
}
async function disk() { return readFile(currentPath, 'utf8'); }
async function saved(label) { await wait(async () => await disk() === expected, `exact disk: ${label}`, 12000); }
async function screenshot(name) { await page.screenshot({ path: join(artifacts, `${name}.png`) }); }
async function restoreWithUndo(original) {
	for (let i = 0; i < 3; i++) {
		await press(`${mod}+z`); await delay(120);
		const source = await frame.evaluate(() => document.querySelector('.cm-content').cmTile.root.view.state.doc.toString());
		if (source === original) { expected = original; await saved('Undo restores boundary exactly'); return; }
	}
	throw new Error('Undo did not restore the exact pre-deletion object boundary');
}
async function check(label, operation) {
	try { await operation(); report.checks.push(label); console.log(`PASS ${label}`); }
	catch (error) {
		const id = `failure-${report.failures.length + 1}`;
		report.failures.push({ label, error: String(error), stack: error.stack });
		await sample(id).catch(() => {}); await screenshot(id).catch(() => {});
		await writeFile(join(artifacts, `${id}-expected.md`), expected);
		const actual = await disk(); await writeFile(join(artifacts, `${id}-actual.md`), actual);
		console.error(`FAIL ${label}: ${error}`);
		// Resume exploratory checks from the real source, but retain the failed verdict.
		expected = actual; await press('Escape');
	}
	await writeFile(join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
}
async function editorFrame(title) {
	let result;
	await wait(async () => {
		for (const candidate of page.frames()) {
			if (candidate.isDetached() || !await candidate.locator('.cm-content').count()) continue;
			if (!await candidate.evaluate(() => document.visibilityState === 'visible')) continue;
			if (!(await candidate.locator('.cm-content').innerText()).includes(title)) continue;
			let visible = true;
			for (let current = candidate; current?.parentFrame(); current = current.parentFrame()) {
				const owner = await current.frameElement();
				try { if (!await owner.isVisible()) visible = false; } finally { await owner.dispose(); }
			}
			if (visible) { result = candidate; return true; }
		}
		return false;
	}, 'visible editor frame', 20000);
	return result;
}
async function wait(condition, label, timeout = 10000) {
	const end = Date.now() + timeout;
	while (Date.now() < end) { if (await condition()) return; await delay(100); }
	throw new Error(`Timed out: ${label}`);
}
async function reservePort() {
	const server = createServer();
	await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
	const address = server.address(); await new Promise(done => server.close(done)); return address.port;
}
async function commandOutput(command, input) {
	const process = spawn(command, [], { stdio: ['pipe', 'pipe', 'pipe'] });
	const chunks = []; process.stdout.on('data', chunk => chunks.push(chunk)); process.stdin.end(input);
	await new Promise((done, reject) => { process.once('error', reject); process.once('exit', code => code === 0 ? done() : reject(new Error(`${command} exited ${code}`))); });
	return Buffer.concat(chunks);
}
function object(kind, id) {
	if (kind === 'TABLE') return '| Boundary evidence | Detailed explanation | State |\n| --- | --- | --- |\n' + Array.from({ length: 12 }, (_, i) => `| Entry ${id}-${i} | A wrapped explanation with **bold** and $n^2$ in a cell | Local |`).join('\n');
	if (kind === 'CODE') return '```typescript\n' + Array.from({ length: 14 }, (_, i) => `const value${i} = ${i}; // Retain code boundary ${id}`).join('\n') + '\n```';
	if (kind === 'INDENTED') return Array.from({ length: 10 }, (_, i) => `    const indentedValue${i} = ${i}; // Indented boundary ${id}`).join('\n');
	if (kind === 'ER') return '```mermaid\nerDiagram\n    NOTE ||--o{ REVISION : tracks\n    NOTE {\n      string id PK\n      string summary\n    }\n    REVISION {\n      int number\n      boolean verified\n    }\n```';
	if (kind === 'FLOW') return '```mermaid\nflowchart LR\nInput[Capture note] --> Review{Review}\nReview -->|Accept| Archive[Local archive]\nReview -->|Revise| Input\n```';
	if (kind === 'DRAWIO') return '```drawio\n<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" value="Boundary review" vertex="1" parent="1"><mxGeometry x="0" y="0" width="190" height="75" as="geometry"/></mxCell></root></mxGraphModel>\n```';
	if (kind === 'CALLOUT') return '> [!warning]+ Boundary review\n> Keep the full warning distinct from adjacent prose.\n>\n> - Review the source\n>   - Confirm local records\n> - [ ] Sign off\n>\n> | Item | Decision |\n> | --- | --- |\n> | Notes | Retain |';
	if (kind === 'MATH') return '$$\n\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}\n$$';
	return '- Parent boundary observation\n  - Nested detail with **emphasis**\n    - Deep detail\n- [ ] Review the conclusion\n- Final boundary item';
}
function makeNote(id, minimumBytes) {
	let source = `---\ntitle: Boundary report ${id}\ntags: [qa, boundaries]\n---\n\n# Boundary report ${id}\n\nThese are synthetic local-only notes.\n`;
	let sequence = 0;
	const filler = () => {
		const n = sequence++;
		return `\n## Retained context ${n}\n\nA long supporting paragraph ${n} has **strong text**, *emphasis*, ==highlighting==, [a local heading](#boundary-report-${id}), and inline $x^2$. Its content wraps naturally and remains unchanged while neighboring objects are edited. Preserve every original byte across edits and Undo.\n\n- First observation ${n} retains context that spans a wrapped line for reviewing aligned continuation text.\n  - Nested observation\n- [ ] Follow up\n\n> [!note] Context ${n}\n> This contextual callout must not leak styling.\n\n| Reference | Status |\n| --- | --- |\n| ${n} | Local |\n\n\`\`\`json\n{"context": ${n}, "preserve": true}\n\`\`\`\n`;
	};
	while (Buffer.byteLength(source) < minimumBytes / 3) source += filler();
	for (const kind of kinds) source += `\n## Object ${kind}\n\nBEFORE_${kind}_${id}\n\n${object(kind, id)}\n\nAFTER_${kind}_${id}\n\nA stable following paragraph for ${kind}.\n`;
	while (Buffer.byteLength(source) < minimumBytes) source += filler();
	const marker = `EOF_ANCHOR_${id}`;
	if (id === 1) source += `\n## Final table\n\n| Final record | State |\n| --- | --- |\n| ${marker} | Retain |`;
	else if (id === 2 || id === 4) source += `\n## Final code\n\n\`\`\`text\n${marker}\n\`\`\``;
	else source += `\n## Final callout\n\n> [!note] Final review\n> ${marker}`;
	return source;
}
