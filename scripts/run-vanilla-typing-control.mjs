// Independent headless diagnostic: installed CodeMirror versus a native textarea.
// No app bundle, preview widgets, host bridge, native app, or OS clipboard is used.
// Synthetic rapid typing can expose the CodeMirror/browser/automation interaction;
// this does not establish behavior at human typing speed or blame Playwright alone.
// Both controls use identical text and keystrokes. Textarea positions are selected
// directly, so that control does not include CodeMirror's Find-panel handoff.
// A clean run is not proof of absence. Every mismatch gets a 500ms settled recheck.
//
// Usage: node scripts/run-vanilla-typing-control.mjs [--rounds 200] [--delay 0]
//        [--markdown] [--view-package /absolute/path/to/extracted/package]
// Environment defaults: MDLP_CONTROL_ROUNDS=200, MDLP_CONTROL_DELAY_MS=0.
// Optional --view-package loads that package only in this in-memory test bundle;
// it never installs packages or updates project dependencies. Reports and exact
// input/expected/observed text are saved under ignored .vscode-test/typing-control.
// Exit status is 1 when persistent mismatches, page errors, or runner errors occur.
// Prior isolated testing on 2026-10-02 found that view 6.43.13 still reproduced
// transposition and missing-first-character symptoms; no upgrade fix is claimed.

import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({ options: {
	rounds: { type: 'string', default: process.env.MDLP_CONTROL_ROUNDS ?? '200' },
	delay: { type: 'string', default: process.env.MDLP_CONTROL_DELAY_MS ?? '0' },
	markdown: { type: 'boolean', default: false },
	'view-package': { type: 'string' },
} });
const rounds = boundedInteger(values.rounds, 'rounds', 1, 5000);
const typingDelay = boundedInteger(values.delay, 'delay', 0, 1000);
const viewDirectory = values['view-package'] ? resolve(values['view-package']) : join(root, 'node_modules/@codemirror/view');
const viewPackage = JSON.parse(await readFile(join(viewDirectory, 'package.json'), 'utf8'));
if (viewPackage.name !== '@codemirror/view') throw new Error('--view-package must identify an extracted @codemirror/view package.');
const reportDirectory = join(root, '.vscode-test/typing-control', `${new Date().toISOString().replaceAll(':', '-')}-${randomUUID().slice(0, 8)}`);
await mkdir(reportDirectory, { recursive: true });
const prelude = Array.from({ length: 100 }, (_, index) => `## Earlier section ${index}\n\nA paragraph with **bold**, *emphasis*, a [local link](Other.md), and enough prose to wrap on a narrow screen.\n\n- Earlier entry ${index}\n  - Nested entry\n\n`).join('');
const initial = `${prelude}BEFORE_ANCHOR\n\n> [!warning]- Closed outer\n> Retained paragraph\n>\n> > [!tip]- Closed inner\n> > INNER_NEEDLE\n> > - [ ] Keep task\n>\n> Kept outer tail\n\nEND_ANCHOR`;
await writeFile(join(reportDirectory, 'input.md'), initial);
const report = {
	startedAt: new Date().toISOString(), completed: false, passed: false,
	viewVersion: viewPackage.version, viewPackageDirectory: viewDirectory,
	playwrightVersion: JSON.parse(await readFile(join(root, 'node_modules/playwright/package.json'), 'utf8')).version,
	nodeVersion: process.version, platform: process.platform, browserVersion: '',
	rounds, typingDelay, markdown: values.markdown, settleTimeoutMs: 500,
	input: { file: 'input.md', bytes: Buffer.byteLength(initial), sha256: createHash('sha256').update(initial).digest('hex') },
	limitations: [
		'Headless synthetic typing is not a human or native VS Code reproduction.',
		'Textarea selection is direct; its control omits the CodeMirror Find-panel handoff.',
		'A clean run does not prove absence; rates from small runs are not causal comparisons.',
		'Prior isolated view 6.43.13 testing reproduced both transposition and missing-first-character symptoms; this is not an established upgrade fix.',
	],
	controls: [], errors: [],
};
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
let browser;
try {
	const bundle = await build({
		stdin: { contents: browserSource(), loader: 'js', resolveDir: root },
		bundle: true, write: false, platform: 'browser', format: 'iife', logLevel: 'silent', metafile: true,
		alias: { '@codemirror/view': join(viewDirectory, 'dist/index.js') },
		nodePaths: [join(root, 'node_modules')],
	});
	report.viewModuleInputs = Object.keys(bundle.metafile.inputs).filter(path => /(?:view|package)\/dist\/index\.js$/.test(path));
	browser = await chromium.launch({ headless: true });
	report.browserVersion = browser.version();
	for (const kind of ['codemirror', 'textarea']) {
		const control = { kind, completedRounds: 0, comparisons: 0, transientMismatches: [], failures: [], pageErrors: [] };
		report.controls.push(control);
		const page = await browser.newPage({ viewport: { width: 620, height: 740 } });
		page.setDefaultTimeout(5000);
		page.on('pageerror', error => control.pageErrors.push(error.message));
		try {
			await page.setContent('<!doctype html><meta charset="utf-8"><div id="editor"></div><textarea style="width:600px;height:710px" hidden></textarea>');
			if (kind === 'codemirror') await page.addScriptTag({ content: bundle.outputFiles[0].text });
			else await page.locator('textarea').evaluate(node => { node.hidden = false; });
			const source = () => kind === 'codemirror'
				? page.evaluate(() => window.controlView.state.doc.toString())
				: page.locator('textarea').inputValue();
			const find = async text => {
				if (kind === 'textarea') {
					await page.locator('textarea').evaluate((node, term) => {
						const from = node.value.indexOf(term);
						if (from < 0) throw new Error('Synthetic textarea marker was not found.');
						node.focus(); node.setSelectionRange(from, from + term.length);
					}, text);
					return;
				}
				await page.locator('.cm-content').focus();
				await page.keyboard.press(`${mod}+f`);
				const input = page.locator('.cm-search input[name="search"]');
				await input.fill(text);
				// Vanilla CodeMirror commits on change/keyup, not on the input event.
				await input.dispatchEvent('change');
				await page.keyboard.press('Enter');
				await page.keyboard.press('Escape');
				await expect.poll(() => page.evaluate(() => {
					const state = window.controlView.state;
					return state.sliceDoc(state.selection.main.from, state.selection.main.to);
				})).toBe(text);
			};
			for (let round = 1; round <= rounds; round++) {
				if (kind === 'codemirror') await page.evaluate(text => window.mountControl(text), initial);
				else await page.locator('textarea').evaluate((node, text) => { node.value = text; }, initial);
				await find('END_ANCHOR');
				await find('INNER_NEEDLE');
				await page.keyboard.type('Revised value', { delay: typingDelay });
				const revised = initial.replace('INNER_NEEDLE', 'Revised value');
				control.completedRounds = round;
				if (!await compareSettled(source, revised, control, round, 'body')) continue;
				await find('END_ANCHOR');
				await page.keyboard.press('ArrowRight');
				// Keep this immediate: no state reads or tracing between motion and input.
				await page.keyboard.type(' retained', { delay: typingDelay });
				await compareSettled(source, revised.replace('END_ANCHOR', 'END_ANCHOR retained'), control, round, 'footer');
				await find('Revised value');
				await page.keyboard.press('Backspace');
				await page.keyboard.type('INNER_NEEDLE', { delay: typingDelay });
				if (round % 25 === 0) console.log(JSON.stringify({ kind, round, failures: control.failures.length }));
			}
		} catch (error) {
			report.errors.push({ kind, error: String(error), stack: error.stack });
		} finally { await page.close(); }
	}
	report.completed = report.controls.length === 2 && !report.errors.length && report.controls.every(control => control.completedRounds === rounds);
} catch (error) {
	report.errors.push({ error: String(error), stack: error.stack });
} finally {
	await browser?.close();
	report.finishedAt = new Date().toISOString();
	report.passed = report.completed && !report.errors.length && report.controls.every(control => !control.failures.length && !control.pageErrors.length);
	await writeFile(join(reportDirectory, 'report.json'), JSON.stringify(report, null, 2));
	console.log(JSON.stringify({ completed: report.completed, passed: report.passed, viewVersion: report.viewVersion, report: join(reportDirectory, 'report.json'), controls: report.controls.map(control => ({ kind: control.kind, rounds: control.completedRounds, failures: control.failures.length, transientMismatches: control.transientMismatches.length })) }));
	if (!report.passed) process.exitCode = 1;
}

function boundedInteger(value, label, minimum, maximum) {
	if (!/^\d+$/.test(value)) throw new Error(`${label} must be an integer between ${minimum} and ${maximum}.`);
	const result = Number(value);
	if (!Number.isSafeInteger(result) || result < minimum || result > maximum) throw new Error(`${label} must be between ${minimum} and ${maximum}.`);
	return result;
}

async function compareSettled(source, expected, control, round, stage) {
	control.comparisons++;
	const firstActual = await source();
	if (firstActual === expected) return true;
	try { await expect.poll(source, { timeout: 500, intervals: [10, 25, 50, 100] }).toBe(expected); }
	catch { /* Save the final settled state as well as the first observation. */ }
	const settledActual = await source();
	const prefix = `${control.kind}-${String(round).padStart(4, '0')}-${stage}`;
	await Promise.all([
		writeFile(join(reportDirectory, `${prefix}-expected.md`), expected),
		writeFile(join(reportDirectory, `${prefix}-first-actual.md`), firstActual),
		writeFile(join(reportDirectory, `${prefix}-settled-actual.md`), settledActual),
	]);
	const mismatch = {
		round, stage, expected: `${prefix}-expected.md`, firstActual: `${prefix}-first-actual.md`, settledActual: `${prefix}-settled-actual.md`,
		lengthDifference: settledActual.length - expected.length, expectedTail: expected.slice(-230), actualTail: settledActual.slice(-230),
	};
	const settled = settledActual === expected;
	(settled ? control.transientMismatches : control.failures).push(mismatch);
	console.log(JSON.stringify({ kind: control.kind, round, stage, settled, lengthDifference: mismatch.lengthDifference }));
	return settled;
}

function browserSource() {
	return `
		import { EditorState } from '@codemirror/state';
		import { EditorView, keymap } from '@codemirror/view';
		${values.markdown ? "import { markdown } from '@codemirror/lang-markdown';" : ''}
		import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
		import { search, searchKeymap, openSearchPanel } from '@codemirror/search';
		window.mountControl = doc => {
			window.controlView?.destroy();
			window.controlView = new EditorView({ parent: document.querySelector('#editor'), state: EditorState.create({ doc,
				extensions: [${values.markdown ? 'markdown(),' : ''} history(), search(), EditorView.lineWrapping,
					EditorView.theme({ '&': { height: '720px' }, '.cm-scroller': { overflow: 'auto' } }),
					keymap.of([{ key: 'Mod-f', run: openSearchPanel }, ...searchKeymap, ...defaultKeymap, ...historyKeymap])]
			}) });
		};
	`;
}
