// Real installed-app QA, without extension-test mode (which rejects modal dialogs).
// All notes, settings, extensions, and mutations are confined to a disposable profile.
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { downloadAndUnzipVSCode, resolveCliPathFromVSCodeExecutablePath } from '@vscode/test-electron';

const root = resolve(import.meta.dirname, '..');
const profile = await mkdtemp(join(tmpdir(), 'mdlp-ui-qa-'));
const workspace = join(profile, 'vault');
const userData = join(profile, 'user');
const extensions = join(profile, 'extensions');
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
let app, browser;
let diagnostics = '';
const waitFor = async (check, label) => {
	const end = Date.now() + 15000;
	while (Date.now() < end) {
		if (await check()) return;
		await new Promise(resolve => setTimeout(resolve, 100));
	}
	throw new Error(label);
};
const exists = async path => { try { await stat(path); return true; } catch { return false; } };

try {
	await Promise.all([mkdir(workspace), mkdir(join(userData, 'User'), { recursive: true }), mkdir(extensions)]);
	await writeFile(join(userData, 'User', 'settings.json'), JSON.stringify({
		'security.workspace.trust.enabled': false,
		'workbench.startupEditor': 'none',
		'window.dialogStyle': 'custom',
		'update.mode': 'none',
		'telemetry.telemetryLevel': 'off',
		'mdLivePreview.defaultEditor': 'livePreview',
	}));
	await writeFile(join(userData, 'User', 'keybindings.json'), JSON.stringify([
		{ key: 'ctrl+alt+m', command: 'mdLivePreview.vault.move', when: 'focusedView == mdLivePreview.vault' },
	]));
	const executable = await downloadAndUnzipVSCode('stable');
	const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
	const cli = spawn(resolveCliPathFromVSCodeExecutablePath(executable), [
		'--install-extension', join(root, `${manifest.name}-${manifest.version}.vsix`), '--force',
		`--user-data-dir=${userData}`, `--extensions-dir=${extensions}`,
	], { shell: process.platform === 'win32', stdio: 'inherit' });
	assert.equal((await once(cli, 'exit'))[0], 0);
	const server = createServer();
	server.listen(0, '127.0.0.1');
	await once(server, 'listening');
	const port = server.address().port;
	await new Promise(resolve => server.close(resolve));
	app = spawn(executable, [workspace, `--user-data-dir=${userData}`, `--extensions-dir=${extensions}`,
		`--remote-debugging-port=${port}`, '--skip-welcome', '--skip-release-notes', '--disable-telemetry', '--disable-updates']);
	app.stdout.on('data', data => { diagnostics = (diagnostics + data).slice(-20000); });
	app.stderr.on('data', data => { diagnostics = (diagnostics + data).slice(-20000); });
	await waitFor(async () => {
		try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 1000 }); return true; } catch { return false; }
	}, 'isolated VS Code did not start');
	await waitFor(() => browser.contexts().some(context => context.pages().length > 0), 'workbench page did not open');
	const page = browser.contexts().flatMap(context => context.pages())[0];
	page.setDefaultTimeout(15000);
	await page.bringToFront();
	await page.locator('.monaco-workbench').waitFor();
	const input = page.locator('.quick-input-widget:visible .quick-input-box input');
	const typeInput = async value => {
		await input.waitFor({ state: 'visible' });
		await input.evaluate(element => { element.focus(); element.select(); });
		await page.keyboard.press(`${mod}+a`);
		await page.keyboard.type(value, { delay: 15 });
		assert.equal(await input.inputValue(), value);
	};
	const command = async label => {
		// Move focus out of an out-of-process editor frame before driving the
		// workbench palette over CDP. This does not alter the tree selection.
		const tree = page.locator('[role="tree"]:visible').first();
		if (await tree.count()) await tree.focus();
		await page.keyboard.press('F1');
		await typeInput(`>Local Markdown Vault: ${label}`);
		await page.locator('.quick-input-list .monaco-list-row').filter({ hasText: `Local Markdown Vault: ${label}` }).first().waitFor({ state: 'visible' });
		await page.keyboard.press('Enter');
	};
	const answer = async value => {
		await typeInput(value);
		await page.keyboard.press('Enter');
		await input.waitFor({ state: 'hidden' });
	};
	await command('Focus on Document Vault View');
	await page.locator('.quick-input-widget:visible').waitFor({ state: 'hidden' });
	await command('New Folder');
	await answer('QA Folder');
	await waitFor(() => exists(join(workspace, 'QA Folder')), 'folder creation failed');
	await command('New Note');
	await answer('QA Note');
	const note = join(workspace, 'QA Note.md');
	await waitFor(() => exists(note), 'note creation failed');
	console.log('PASS: created a folder and a note through workbench prompts.');
	let editor;
	await waitFor(async () => {
		for (const frame of page.frames()) if (await frame.locator('.cm-content').count()) { editor = frame; return true; }
		return false;
	}, 'new note did not open in Live Preview');
	let markdown = '# QA Note\n\n- [ ] Task\n\n| Name | Value |\n| --- | --- |\n| Alpha | **Bold** |\n\n```js\nconsole.log(1);\n```\n\n> [!NOTE] Local QA\n> Safe content\n';
	await editor.locator('.cm-content').click();
	await page.keyboard.insertText(markdown);
	await waitFor(async () => (await readFile(note, 'utf8')) === markdown, 'Markdown typing did not autosave');
	console.log('PASS: typed advanced Markdown and verified autosaved file bytes.');
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End');
	await page.keyboard.press('ArrowDown');
	await page.keyboard.press('End');
	await page.keyboard.type('BoldWord');
	await page.keyboard.press('Shift+Home');
	assert.equal(await editor.evaluate(() => window.getSelection()?.toString()), 'BoldWord');
	await page.keyboard.press(`${mod}+b`);
	markdown += '**BoldWord**';
	await waitFor(async () => (await readFile(note, 'utf8')) === markdown, 'bold shortcut did not format the selected text')
		.catch(async error => { throw new Error(`${error.message}; actual=${JSON.stringify(await readFile(note, 'utf8'))}; expected=${JSON.stringify(markdown)}`); });
	assert.equal(await page.locator('.part.sidebar').isVisible(), true, 'bold shortcut also toggled the workbench sidebar');
	console.log('PASS: keyboard bold formatting stays inside the editor.');
	// Use actual row clicks and the contributed F2/Trash shortcuts. The isolated
	// profile binds Move as well, avoiding OS-native context-menu automation.
	const row = name => page.getByRole('treeitem', { name, exact: true });
	const selectRow = async name => {
		const target = row(name);
		await target.click();
		await target.locator('xpath=ancestor::*[@role="tree"][1]').focus();
	};
	await selectRow('File: QA Note.md');
	await page.keyboard.press('F2');
	await answer('QA Renamed.md');
	const renamed = join(workspace, 'QA Renamed.md');
	await waitFor(() => exists(renamed), 'rename failed');
	console.log('PASS: renamed the note.');
	await selectRow('File: QA Renamed.md');
	await page.keyboard.press('Control+Alt+m');
	await answer('QA Folder');
	const moved = join(workspace, 'QA Folder', 'QA Renamed.md');
	await waitFor(() => exists(moved), 'move failed');
	assert.equal(await readFile(moved, 'utf8'), markdown);
	console.log('PASS: moved the note without changing its content.');
	await selectRow('Folder: QA Folder');
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Backspace' : 'Delete');
	await page.getByRole('button', { name: 'Cancel', exact: true }).click();
	assert.equal(await exists(moved), true, 'Cancel must preserve folder contents');
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Backspace' : 'Delete');
	await page.getByRole('button', { name: 'Move to Trash', exact: true }).click();
	await waitFor(async () => !(await exists(join(workspace, 'QA Folder'))), 'confirmed folder trash failed');
	console.log('PASS: installed-app folder/note creation, advanced Markdown typing/autosave, rename, move, trash cancel, and confirmed nonempty-folder trash.');
} catch (error) {
	for (const page of browser?.contexts().flatMap(context => context.pages()) ?? []) {
		console.error(await page.locator('.quick-input-box input').evaluateAll(inputs => inputs.map(input => input.value)));
		console.error((await page.locator('body').innerText()).slice(-8000));
	}
	console.error(diagnostics);
	throw error;
} finally {
	await browser?.close();
	if (app && app.exitCode === null) {
		const exited = once(app, 'exit');
		app.kill('SIGTERM');
		await exited;
	}
	await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
}
