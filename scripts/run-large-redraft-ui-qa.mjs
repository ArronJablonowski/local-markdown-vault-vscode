// Drives a disposable VS Code window with real keyboard and pointer events.
// Seed files are deliberately large; edits never use editor or document APIs.
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
const temporary = await mkdtemp(join(tmpdir(), 'mdlp-large-redraft-'));
const workspace = join(temporary, 'Redraft QA Vault');
const profile = join(temporary, 'profile');
const artifacts = join(root, '.vscode-test/large-redraft-ui');
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
const vscodeTarget = process.env.MDLP_QA_VSCODE_VERSION ?? 'stable';
const report = { completed: false, passed: false, platform: process.platform, vscodeTarget, files: [], checks: [], failures: [], pageErrors: [], consoleErrors: [], samples: [], typedCharacters: 0, keyboardPresses: 0, pointerActions: 0 };
let browser, child, page, frame, currentPath, expected, previousClipboard;

try {
	await Promise.all([mkdir(workspace, { recursive: true }), mkdir(join(profile, 'User'), { recursive: true }), mkdir(artifacts, { recursive: true })]);
	await writeFile(join(profile, 'User/settings.json'), JSON.stringify({
		'workbench.startupEditor': 'none', 'update.mode': 'none', 'telemetry.telemetryLevel': 'off',
		'window.dialogStyle': 'custom', 'files.autoSave': 'off', 'git.openRepositoryInParentFolders': 'never',
		'security.workspace.trust.enabled': false, 'mdLivePreview.defaultEditor': 'livePreview',
		'mdLivePreview.defaultEditingMode': 'editing', 'mdLivePreview.vault.openBehavior': 'newTab',
		'mdLivePreview.showWhitespace': 'off', 'mdLivePreview.stickyTableHeaders': false,
	}, null, 2));
	for (const [id, size] of [['Field report', 110000], ['Research review', 260000], ['Operations handbook', 470000]]) {
		const source = makeNote(id, size);
		await writeFile(join(workspace, `${id}.md`), source);
		report.files.push({ name: `${id}.md`, initialBytes: Buffer.byteLength(source), initialLines: source.split('\n').length });
	}
	await writeFile(join(workspace, 'Selection stress.md'), 'Original synthetic selection probe.\n\nSecond untouched paragraph.');
	if (process.platform === 'darwin') {
		previousClipboard = await commandOutput('pbpaste');
		// A failed copy must never paste personal clipboard contents into artifacts.
		await commandOutput('pbcopy', 'Local Markdown Vault synthetic QA clipboard seed');
	}
	const port = await reservePort();
	child = spawn(await downloadAndUnzipVSCode(vscodeTarget), [workspace, '--new-window', '--disable-updates', '--disable-telemetry', '--skip-welcome', '--skip-release-notes',
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
	await page.getByRole('treeitem', { name: 'File: Field report.md', exact: true }).waitFor({ state: 'visible', timeout: 30000 });
	for (const [index, file] of report.files.entries()) {
		if ((process.env.MDLP_REDRAFT_SEARCH_ONLY === '1' || process.env.MDLP_REDRAFT_FIRST_ONLY === '1') && index > 0) break;
		try {
			file.tested = true;
			currentPath = join(workspace, file.name);
			expected = await readFile(currentPath, 'utf8');
			await page.getByRole('treeitem', { name: `File: ${file.name}`, exact: true }).dblclick();
			frame = await editorFrame(file.name.replace(/\.md$/, ''));
			await frame.locator('.cm-line').first().click();
			await check(`Open ${file.initialBytes}-byte mixed Markdown note`, async () => {
				assert.ok(await frame.locator('.cm-content').evaluate(el => el.isContentEditable));
				assert.equal(await disk(), expected);
			});
			await journey(file.name, index);
			if (index === 0 && process.env.MDLP_REDRAFT_SEARCH_ONLY !== '1') await themeProbe();
			file.finalBytes = Buffer.byteLength(await disk());
			await writeFile(join(artifacts, `edited-${index + 1}.md`), await disk());
		} catch (error) {
			report.failures.push({ file: file.name, error: String(error), stack: error.stack });
			await page.screenshot({ path: join(artifacts, `failure-${index + 1}.png`) }).catch(() => {});
			if (frame && !frame.isDetached()) await writeFile(join(artifacts, `failure-${index + 1}-dom.txt`), await frame.locator('body').innerHTML()).catch(() => {});
			await writeFile(join(artifacts, `failure-${index + 1}-actual.md`), await disk()).catch(() => {});
			await writeFile(join(artifacts, `failure-${index + 1}-expected.md`), expected).catch(() => {});
			console.error(`FAIL ${file.name}: ${error}`);
			await press('Escape');
		}
	}
	currentPath = join(workspace, 'Selection stress.md');
	expected = await disk();
	await page.getByRole('treeitem', { name: 'File: Selection stress.md', exact: true }).dblclick();
	frame = await editorFrame('Original synthetic selection probe.');
	await check('Source Select All immediately followed by typing replaces the complete note once', async () => {
		await frame.locator('.cm-line').first().click();
		await press(`${mod}+a`);
		await type('Replacement source note. Every character must survive.');
		expected = 'Replacement source note. Every character must survive.';
		await saved('source Select All immediate replacement');
	});
	report.completed = true;
	report.passed = report.failures.length === 0 && report.pageErrors.length === 0;
} catch (error) {
	report.failures.push({ error: String(error), stack: error.stack });
	console.error(error);
} finally {
	await writeFile(join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
	await browser?.close().catch(() => {});
	if (child && child.exitCode === null) {
		child.kill();
		await Promise.race([new Promise(resolveExit => child.once('exit', resolveExit)), delay(5000)]);
	}
	if (previousClipboard !== undefined) await commandOutput('pbcopy', previousClipboard).catch(() => {});
	await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
	if (!report.passed) process.exitCode = 1;
	console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, failures: report.failures.length, typedCharacters: report.typedCharacters, samples: report.samples.length }));
}

async function journey(name, index) {
	await check(`${name}: property editing and exact autosave`, async () => {
		await find(`# ${name.replace(/\.md$/, '')}`);
		await frame.getByRole('button', { name: 'Edit priority', exact: true }).dblclick();
		const input = frame.getByRole('textbox', { name: 'Edit priority', exact: true });
		await input.click(); await press(`${mod}+a`); await type(String(index + 5)); await press('Enter');
		expected = expected.replace('priority: 2', `priority: ${index + 5}`).replace('tags: [qa, local, redraft]', 'tags: [ qa, local, redraft ]');
		await saved('property change');
		await frame.getByRole('button', { name: 'Edit title', exact: true }).dblclick();
		const titleInput = frame.getByRole('textbox', { name: 'Edit title', exact: true });
		await titleInput.click(); await press(`${mod}+a`);
		await type(`Revised ${name.replace(/\.md$/, '')}`); await press('Enter');
		expected = expected.replace(`title: ${name.replace(/\.md$/, '')}`, `title: Revised ${name.replace(/\.md$/, '')}`);
		await saved('multi-character title property replacement');
	});
	await check(`${name}: repeated redrafts preserve Unicode and inline formatting`, async () => {
		for (const [from, to] of [
			['DRAFT_SUMMARY', 'Validated **local evidence**, *review notes*, and ==next steps==.'],
			['review notes', 'peer-reviewed notes'], ['next steps', 'follow-up actions'],
			['Follow-up owner: TBD', 'Follow-up owner: Engineering'],
			['Budget $40-$65', 'Budget $45-$70'],
		]) await replaceThroughFind(from, to);
		await find('Validated');
		assert.ok(!(await frame.locator('.cm-content').innerText()).includes('Invalid math'));
		await page.screenshot({ path: join(artifacts, `redraft-${index + 1}.png`) });
	});
	if (process.env.MDLP_REDRAFT_SEARCH_ONLY === '1') return;
	await check(`${name}: mouse highlighting, copy, paste, deletion, Undo and Redo`, async () => {
		await find('Mouse selection target');
		const line = frame.locator('.cm-line').filter({ hasText: /^Mouse selection target: / }).first();
		await line.scrollIntoViewIfNeeded();
		const bounds = await line.boundingBox();
		assert.ok(bounds);
		await page.mouse.move(bounds.x + 3, bounds.y + bounds.height / 2); await page.mouse.down();
		await page.mouse.move(bounds.x + 170, bounds.y + bounds.height / 2, { steps: 25 }); await page.mouse.up(); report.pointerActions += 4;
		const selection = await frame.evaluate(() => window.getSelection()?.toString() || '');
		assert.ok(selection.length >= 5 && !selection.includes('\n'), `Unexpected mouse selection: ${JSON.stringify(selection)}`);
		const original = expected;
		await press(`${mod}+c`);
		await press('Backspace');
		expected = expected.replace(selection, ''); await saved('mouse-selected deletion');
		await press(`${mod}+z`); expected = original; await saved('Undo mouse deletion');
		await press(`${mod}+Shift+z`); expected = original.replace(selection, ''); await saved('Redo mouse deletion');
		await press(`${mod}+z`); expected = original; await saved('restore mouse deletion');
		await find('PASTE_TARGET'); await press(`${mod}+v`);
		expected = expected.replace('PASTE_TARGET', selection); await saved('paste copied selection');
	});
	await check(`${name}: nested task clicking and callout fold/unfold`, async () => {
		await find('## Risk review');
		const callout = frame.getByRole('button', { name: 'Review warning callout', exact: true });
		await callout.click(); report.pointerActions++;
		assert.equal(await callout.getAttribute('aria-expanded'), 'false');
		await callout.press('Enter');
		assert.equal(await callout.getAttribute('aria-expanded'), 'true');
		await frame.locator('.mlp-checkbox').first().click(); report.pointerActions++;
		expected = expected.replace('- [ ] Confirm local backup', '- [x] Confirm local backup');
		await saved('task toggle');
		await replaceThroughFind('Review the secondary evidence', 'Review the secondary evidence and retain the source');
		await replaceThroughFind('Temporary finding to remove', '');
	});
	await check(`${name}: inline table edit, pipe escaping and source button`, async () => {
		await find('## Review matrix');
		const table = frame.locator('.mlp-table').first();
		const cell = table.locator('tbody tr').first().locator('td').first();
		await cell.click(); report.pointerActions++;
		await press(`${mod}+a`); await type('Evidence **accepted**<br>Local | verified'); await press('Enter');
		expected = expected.replace('| Artifact draft |', '| Evidence **accepted**<br>Local \\| verified |');
		await saved('table cell');
		assert.equal(await cell.locator('br').count(), 1);
		assert.equal(await table.locator('tbody tr').first().locator('td').count(), 3);
		await frame.getByRole('button', { name: 'Show Markdown source', exact: true }).first().click(); report.pointerActions++;
		await frame.locator('.cm-line').filter({ hasText: 'Evidence accepted' }).first().waitFor({ state: 'visible' });
		assert.ok(await frame.locator('.mlp-table-raw').count() > 0, 'Source button did not reveal the table rows');
		await replaceThroughFind('Pending review', 'Review complete');
	});
	await check(`${name}: Mermaid ER, class, flow and draw.io rendering with source edits`, async () => {
		for (const [heading, expectedText, selector] of [
			['## Entity table diagram', 'RECORD', '.mlp-mermaid-wrap:not(.mlp-drawio-wrap) svg'],
			['## Class table diagram', 'Evidence', '.mlp-mermaid-wrap:not(.mlp-drawio-wrap) svg'],
			['## Flow diagram', 'Inspect', '.mlp-mermaid-wrap:not(.mlp-drawio-wrap) svg'],
			['## Drawio architecture', 'Local archive', '.mlp-drawio-wrap svg'],
		]) {
			await find(heading);
			await wait(async () => (await frame.locator(selector).allTextContents()).some(text => text.includes(expectedText)), `${heading} rendered`, 20000);
			await page.screenshot({ path: join(artifacts, `${index + 1}-${heading.slice(3).replaceAll(' ', '-')}.png`) });
		}
		await replaceThroughFind('A[Inspect] --> B[Preserve]', 'A[Inspect] --> B[Preserve revised evidence]');
		await find('## Flow diagram');
		await wait(async () => (await frame.locator('.mlp-mermaid-wrap svg').allTextContents()).some(text => text.includes('Preserve revised evidence')), 'edited Mermaid rendered', 20000);
	});
	await check(`${name}: long code collapse, source editing and copy`, async () => {
		await find('## Validation code');
		await frame.getByRole('button', { name: 'Collapse code block', exact: true }).first().click(); report.pointerActions++;
		await frame.getByRole('button', { name: 'Expand code block', exact: true }).first().press('Enter');
		await replaceThroughFind('const retries = 3;', 'const retries = 5;');
		await find('## Validation code');
		await frame.getByRole('button', { name: 'Copy code block', exact: true }).first().click(); report.pointerActions++;
		await find('CODE_COPY_TARGET'); await press(`${mod}+v`);
		const code = /```typescript\n([\s\S]*?)\n```/.exec(expected)[1];
		expected = expected.replace('CODE_COPY_TARGET', code); await saved('code copy paste');
	});
	await check(`${name}: wide table scroll remains horizontal with sticky headers off`, async () => {
		await find('## Wide evidence register');
		const viewport = frame.locator('.mlp-table-viewport').first();
		await viewport.waitFor({ state: 'visible' });
		assert.ok(await viewport.evaluate(el => el.scrollWidth > el.clientWidth + 100), 'Wide table was squeezed');
		await viewport.hover(); await page.mouse.wheel(540, 0); report.pointerActions += 2;
		await wait(async () => await viewport.evaluate(el => el.scrollLeft) > 100, 'table horizontal gesture');
		await sample('wide-table-horizontal');
		await page.mouse.wheel(0, 390); report.pointerActions++;
		await page.screenshot({ path: join(artifacts, `wide-table-${index + 1}.png`) });
		await saved('table scroll does not edit');
	});
	await check(`${name}: human typing at EOF creates headings, nested lists, tasks, math, and a fenced diagram`, async () => {
		await find('END_OF_SEEDED_CONTENT'); await press('ArrowRight');
		await press('Enter'); await press('Enter');
		await type('## Final redraft'); await press('Enter');
		await type('Evidence stays **local**. Formula $x^2 + 1$.'); await press('Enter'); await press('Enter');
		await type('- Review the complete record'); await press('Enter'); await press('Tab');
		await type('Check the nested evidence'); await press('Enter'); await press('Shift+Tab');
		await type('Record the final decision'); await press('Enter'); await press('Enter');
		await type('- [ ] Request peer review'); await press('Enter'); await press('Enter');
		await type('```mermaid'); await press('Enter');
		await type('flowchart LR'); await press('Enter');
		await type('Draft --> Reviewed'); await press('Enter'); await press('Enter');
		await type('Final saved decision.');
		const suffix = '\n\n## Final redraft\nEvidence stays **local**. Formula $x^2 + 1$.\n\n- Review the complete record\n  - Check the nested evidence\n- Record the final decision\n\n- [ ] Request peer review\n\n```mermaid\nflowchart LR\nDraft --> Reviewed\n\n\n```\nFinal saved decision.';
		expected += suffix;
		await saved('manual end-of-document note taking');
		await page.screenshot({ path: join(artifacts, `typed-eof-${index + 1}.png`) });
	});
}

async function replaceThroughFind(from, to) {
	assert.equal(expected.split(from).length, 2, `Replacement target is not unique: ${from}`);
	await find(from);
	if (to) await type(to); else await press('Backspace');
	expected = expected.replace(from, to);
	await saved(`replace ${from.slice(0, 30)}`);
}
async function themeProbe() {
	report.themeSnapshots = [];
	for (const [heading, selector] of [
		['## Flow diagram', '.mlp-mermaid-wrap:not(.mlp-drawio-wrap) svg'],
		['## Drawio architecture', '.mlp-drawio-wrap svg'],
	]) {
		await find(heading);
		await frame.locator(selector).first().waitFor({ state: 'visible' });
		await frame.locator(selector).first().hover(); report.pointerActions++;
		for (const theme of ['Dark Modern', 'Light Modern', 'Dark Modern']) {
			await press(`${mod}+Shift+p`);
			await page.locator('.quick-input-widget:visible .quick-input-box input').fill('>Preferences: Color Theme');
			await page.locator('.quick-input-widget:visible .monaco-list-row').filter({ hasText: 'Preferences: Color Theme' }).first().click();
			const picker = page.locator('.quick-input-widget:visible');
			await picker.locator('input').fill(theme);
			await picker.locator('.monaco-list-row').filter({ hasText: theme }).first().click();
			await page.locator('.quick-input-widget').waitFor({ state: 'hidden' });
			await delay(700);
			await frame.locator(selector).first().hover(); report.pointerActions++;
			const snapshot = await frame.locator(selector).first().evaluate(svg => ({
				bodyClass: document.body.className,
				bodyColor: getComputedStyle(document.body).color,
				bodyBackground: getComputedStyle(document.body).backgroundColor,
				colors: Array.from(svg.querySelectorAll('rect, path, text, tspan, polygon')).slice(0, 80).map(el => ({ tag: el.tagName, fill: getComputedStyle(el).fill, stroke: getComputedStyle(el).stroke, color: getComputedStyle(el).color })),
			}));
			assert.ok(snapshot.bodyClass.includes(theme.startsWith('Light') ? 'vscode-light' : 'vscode-dark'), `Theme did not reach webview: ${theme}`);
			report.themeSnapshots.push({ heading, theme, ...snapshot });
			await page.screenshot({ path: join(artifacts, `theme-${heading.slice(3).replaceAll(' ', '-')}-${theme.replaceAll(' ', '-')}.png`) });
		}
		const palettes = report.themeSnapshots.filter(snapshot => snapshot.heading === heading).map(snapshot => JSON.stringify(snapshot.colors));
		assert.notEqual(palettes[0], palettes[1], `${heading} kept stale dark colors after switching to light`);
		assert.equal(palettes[0], palettes[2], `${heading} did not restore its dark palette`);
	}
	await saved('theme controls do not edit document');
	report.checks.push('Native light/dark theme switches update and restore Mermaid and draw.io palettes');
}
async function find(text) {
	await frame.locator('.cm-line').first().click();
	await press(`${mod}+f`);
	const input = frame.locator('.cm-search input[name="search"]');
	await input.click(); await press(`${mod}+a`); await type(text, false);
	report.samples.push({ label: 'find-query-before-enter', requested: text, actual: await input.inputValue() });
	assert.equal(await input.inputValue(), text, 'Find dropped typed query characters');
	await sample('find-before-enter');
	await press('Enter'); await sample('find-before-escape'); await press('Escape');
	await sample(`find-complete-${text.slice(0, 40)}`);
	assert.equal(report.samples.at(-1).selection?.text, text, 'Closing Find changed the selected source range');
}
async function type(text, observe = true) {
	for (const [index, character] of Array.from(text).entries()) {
		await page.keyboard.type(character, { delay: 3 });
		report.typedCharacters++;
		if (observe && (index < 4 || index % 12 === 0)) await sample(`typing-${text.slice(0, 24)}-${index}`);
	}
}
async function press(key) { report.keyboardPresses++; await page.keyboard.press(key); }
async function sample(label) {
	if (!frame || frame.isDetached()) return;
	const geometry = await frame.evaluate(() => {
		const content = document.querySelector('.cm-content'), scroller = document.querySelector('.cm-scroller');
		const active = document.activeElement;
		const rect = active?.getBoundingClientRect();
		// Read CodeMirror's existing state only; every edit still uses user input.
		const state = content?.cmTile?.root?.view?.state;
		const selection = state?.selection.main;
		return { focused: document.hasFocus(), active: active?.className, x: rect?.x, y: rect?.y,
			width: rect?.width, viewportWidth: scroller?.clientWidth, scrollLeft: scroller?.scrollLeft,
			scrollTop: scroller?.scrollTop, contentWidth: content?.getBoundingClientRect().width,
			selection: selection && { from: selection.from, to: selection.to, text: state.sliceDoc(selection.from, selection.to).slice(0, 120), line: state.doc.lineAt(selection.head).number },
			visibleDiagrams: document.querySelectorAll('.mlp-mermaid-wrap svg').length };
	});
	report.samples.push({ label, ...geometry });
}
async function disk() { return readFile(currentPath, 'utf8'); }
async function saved(label) { await wait(async () => await disk() === expected, `exact disk: ${label}`, 12000); }
async function check(label, operation) {
	try { await operation(); report.checks.push(label); console.log(`PASS ${label}`); }
	catch (error) {
		const id = `checkpoint-${report.failures.length + 1}`;
		report.failures.push({ label, error: String(error), stack: error.stack });
		await page.screenshot({ path: join(artifacts, `${id}.png`) }).catch(() => {});
		await writeFile(join(artifacts, `${id}-expected.md`), expected);
		const actual = await disk();
		await writeFile(join(artifacts, `${id}-actual.md`), actual);
		console.error(`FAIL ${label}: ${error}`);
		// Continue exploring the synthetic note without concealing the failure.
		expected = actual;
		await press('Escape');
	}
}
async function editorFrame(expectedTitle) {
	let found;
	await wait(async () => {
		for (const candidate of page.frames()) {
			if (candidate.isDetached() || !await candidate.locator('.cm-content').count()) continue;
			if (!await candidate.evaluate(() => document.visibilityState === 'visible')) continue;
			if (expectedTitle && !(await candidate.locator('.cm-content').innerText()).includes(expectedTitle)) continue;
			let visible = true;
			for (let current = candidate; current?.parentFrame(); current = current.parentFrame()) {
				const owner = await current.frameElement();
				try { if (!await owner.isVisible()) visible = false; } finally { await owner.dispose(); }
			}
			if (visible) { found = candidate; return true; }
		}
		return false;
	}, 'active editor frame', 20000);
	return found;
}
async function wait(condition, label, timeout = 10000) {
	const end = Date.now() + timeout;
	while (Date.now() < end) { if (await condition()) return; await delay(100); }
	throw new Error(`Timed out: ${label}`);
}
async function reservePort() {
	const server = createServer();
	await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
	const address = server.address();
	await new Promise(done => server.close(done));
	return address.port;
}
async function commandOutput(command, input) {
	const process = spawn(command, [], { stdio: ['pipe', 'pipe', 'pipe'] });
	const chunks = [];
	process.stdout.on('data', chunk => chunks.push(chunk));
	process.stdin.end(input);
	await new Promise((done, reject) => { process.once('error', reject); process.once('exit', code => code === 0 ? done() : reject(new Error(`${command} exited ${code}`))); });
	return Buffer.concat(chunks);
}

function makeNote(title, minimumBytes) {
	const code = ['const status = "ready";', 'const retries = 3;', 'const records = [1, 2, 3];', 'let inspected = 0;', 'for (const record of records) {', '  inspected += record;', '}', 'console.log(status);', 'console.log(inspected);', 'export { inspected };'].join('\n');
	let source = `---\ntitle: ${title}\npriority: 2\napproved: false\ntags: [qa, local, redraft]\n---\n\n# ${title}\n\nDRAFT_SUMMARY\n\nFollow-up owner: TBD\n\nBudget $40-$65 and a valid formula $a^2+b^2=c^2$. Unicode: caf\u00e9, na\u00efve, \u6771\u4eac, \ud83d\ude80.\n\nMouse selection target: preserve copied evidence precisely.\n\nPASTE_TARGET\n\n## Risk review\n\n> [!warning]+ Review warning\n> - [ ] Confirm local backup\n>   - Review the secondary evidence\n> - Temporary finding to remove\n>\n> **Risk:** repeated redrafts must not lose source.\n\n## Review matrix\n\n| Evidence | Status | Owner |\n| --- | --- | --- |\n| Artifact draft | Pending review | Team |\n| Backup record | Local only | Analyst |\n\n## Entity table diagram\n\n\`\`\`mermaid\nerDiagram\n    RECORD ||--o{ REVIEW : receives\n    RECORD {\n      string id PK\n      string title\n    }\n    REVIEW {\n      string reviewer\n      boolean approved\n    }\n\`\`\`\n\n## Class table diagram\n\n\`\`\`mermaid\nclassDiagram\n    class Evidence {\n      +String name\n      +Boolean approved\n      +validate()\n    }\n    class Review {\n      +String owner\n    }\n    Evidence --> Review\n\`\`\`\n\n## Flow diagram\n\n\`\`\`mermaid\nflowchart LR\nA[Inspect] --> B[Preserve]\nB --> C[Review]\n\`\`\`\n\n## Drawio architecture\n\n\`\`\`drawio\n<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" value="Local archive" vertex="1" parent="1"><mxGeometry x="0" y="0" width="160" height="60" as="geometry"/></mxCell></root></mxGraphModel>\n\`\`\`\n\n## Validation code\n\n\`\`\`typescript\n${code}\n\`\`\`\n\nCODE_COPY_TARGET\n\n## Wide evidence register\n\n| Equipment description | Source location | Responsible reviewer | Current validation state | Follow-up documentation | Reference identifier |\n| --- | --- | --- | --- | --- | --- |\n`;
	for (let row = 0; row < 140; row++) source += `| Evidence record ${row} | Locked cabinet and offline archive ${row} | Assigned review coordinator ${row} | Passed source integrity examination | Keep original evidence and the recorded results ${row} | LOCAL-RECORD-${row} |\n`;
	let section = 0;
	while (Buffer.byteLength(source) < minimumBytes) {
		source += `\n## Supporting analysis ${section}\n\nThis detailed supporting section ${section} preserves **bold**, *emphasis*, ~~superseded text~~, ==highlighting==, \\*literal symbols\\*, and [a local reference](#risk-review). Do not abbreviate the retained source while performing a redraft. This intentionally long paragraph wraps across several display lines so mouse and keyboard navigation can expose transient layout shifts in a large document.\n\n- Primary observation ${section}: this line also wraps and should align with the first character of the item, not the bullet marker. Add context about local storage, offline operation, secure defaults, and recovery from interrupted sessions.\n  - Secondary observation ${section}\n    - Detailed observation ${section}\n- [ ] Follow-up action ${section}\n\n> [!note] Supporting detail ${section}\n> Read the source before changing its interpretation.\n>\n> | Question | Answer |\n> | --- | --- |\n> | Storage | Local only |\n\n\`\`\`json\n{"section": ${section}, "local": true, "labels": ["qa", "redraft"]}\n\`\`\`\n\nA reference[^support-${section}] and inline expression $n_{${section}}^2$.\n\n[^support-${section}]: Retain the accompanying evidence.\n`;
		section++;
	}
	return source + '\nEND_OF_SEEDED_CONTENT';
}
