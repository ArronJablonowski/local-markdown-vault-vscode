// Runs outside VS Code's extension-test host, which deliberately rejects modal
// dialogs. All filesystem mutations and settings belong to one temporary profile.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { downloadAndUnzipVSCode } from '@vscode/test-electron';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await mkdtemp(join(tmpdir(), 'mdlp-human-ui-'));
const workspace = join(temporary, 'QA Vault');
const profile = join(temporary, 'profile');
const settingsFile = join(profile, 'User/settings.json');
const artifacts = resolve(root, 'test-results/human-native-ui');
const checks = [];
let browser, child, page;
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
const port = await reservePort();
const check = label => { checks.push(label); console.log(`PASS ${label}`); };
try {
	await Promise.all([mkdir(join(profile, 'User'), { recursive: true }), mkdir(join(workspace, 'Trash folder'), { recursive: true }), mkdir(artifacts, { recursive: true })]);
	await writeFile(join(workspace, 'Trash file.md'), '# Disposable file\n');
	await writeFile(join(workspace, 'Trash folder/Child.md'), '# Disposable child\n');
	await writeFile(settingsFile, JSON.stringify({
		'workbench.startupEditor': 'none', 'update.mode': 'none', 'window.menuStyle': 'custom', 'window.dialogStyle': 'custom',
		'files.autoSave': 'off', 'git.openRepositoryInParentFolders': 'never', 'security.workspace.trust.enabled': false,
		'mdLivePreview.defaultEditor': 'livePreview', 'telemetry.telemetryLevel': 'off',
	}, null, 2));
	child = spawn(await downloadAndUnzipVSCode('stable'), [workspace, '--new-window', '--disable-updates', '--disable-telemetry', '--skip-welcome', '--skip-release-notes',
		`--extensionDevelopmentPath=${root}`, `--user-data-dir=${profile}`, `--extensions-dir=${join(temporary, 'extensions')}`, `--remote-debugging-port=${port}`],
	{ cwd: root, stdio: 'ignore', env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } });
	await wait(async () => { try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`); return true; } catch { return false; } }, 'debug browser', 30000);
	await wait(() => browser.contexts().flatMap(context => context.pages()).length > 0, 'workbench');
	page = browser.contexts().flatMap(context => context.pages())[0];
	page.setDefaultTimeout(8000);
	await page.bringToFront();
	// Reveal the extension container using its contributed Activity Bar button.
	await page.getByRole('tab', { name: /Local Markdown Vault/ }).waitFor({ state: 'visible' });
	await page.getByRole('tab', { name: /Local Markdown Vault/ }).click();
	await delay(500);
	await palette('Local Markdown Vault: Refresh Document Vault');
	const treeRow = text => page.getByRole('treeitem', { name: text, exact: true });
	const menu = async (text, action) => {
		await treeRow(text).click({ button: 'right' });
		await delay(250);
		await page.getByRole('menuitem').filter({ hasText: action }).click();
	};
	await page.locator('.pane-header').filter({ hasText: 'QA Vault' }).hover();
	await page.getByRole('button', { name: 'Expand All Vault Folders', exact: true }).click();
	await treeRow('File: Trash folder/Child.md').waitFor({ state: 'visible' });
	await palette('Local Markdown Vault: Collapse All Vault Folders');
	await treeRow('File: Trash folder/Child.md').waitFor({ state: 'hidden' });
	await page.locator('.pane-header').filter({ hasText: 'QA Vault' }).hover();
	await page.getByRole('button', { name: 'Refresh Document Vault', exact: true }).click();
	await page.getByRole('button', { name: 'Rebuild Vault Index', exact: true }).click();
	check('Vault expand, collapse, refresh, and rebuild controls work');
	await menu('File: Trash file.md', 'Move to Trash');
	const trash = page.getByRole('button', { name: /^Move to Trash/ });
	await trash.waitFor({ state: 'visible' });
	await page.screenshot({ path: join(artifacts, 'trash-confirmation.png') });
	await page.locator('.monaco-dialog-box').getByRole('button', { name: /^Cancel/ }).click();
	assert.ok(await exists(join(workspace, 'Trash file.md')));
	check('Cancel trash preserves the file');
	await menu('File: Trash file.md', 'Move to Trash');
	await trash.click();
	await wait(async () => !await exists(join(workspace, 'Trash file.md')), 'file trash');
	await treeRow('File: Trash file.md').waitFor({ state: 'hidden' });
	// Let the tree finish its asynchronous refresh before opening the next menu.
	await delay(500);
	check('Confirm trash removes the disposable file');
	await menu('Folder: Trash folder', 'Move to Trash');
	await trash.waitFor({ state: 'visible' });
	assert.match(await page.locator('.monaco-dialog-box').innerText(), /1 contained item/);
	await trash.click();
	await wait(async () => !await exists(join(workspace, 'Trash folder')), 'nonempty folder trash');
	check('Nonempty folder confirmation includes the child count and trashes its contents');

	for (const key of ['autoSave', 'stickyTableHeaders', 'vault.updateLinksOnMove', 'vault.openDefaultOnStartup', 'vault.autoReveal', 'diagnostics.enabled']) {
		const item = await setting(key);
		const checkbox = item.getByRole('checkbox');
		const original = await checkbox.isChecked();
		await checkbox.click();
		await wait(async () => (await settings())[ `mdLivePreview.${key}` ] === !original, `persist ${key}`);
		// Reopen the filtered row as a user returning to Settings would do.
		await setting('codeTheme');
		const refreshed = (await setting(key)).getByRole('checkbox');
		assert.equal(await refreshed.isChecked(), !original, `${key} display did not persist`);
		await refreshed.press('Space');
		// VS Code removes explicit overrides when restoring a manifest default.
		await wait(async () => ((await settings())[ `mdLivePreview.${key}` ] ?? original) === original, `restore ${key}`);
		check(`Settings checkbox ${key} changes and restores`);
	}
	for (const [key, values] of Object.entries({
		'vault.sortOrder': ['nameAsc', 'nameDesc', 'modifiedNewest', 'modifiedOldest', 'createdNewest', 'createdOldest'],
		diagramRendering: ['safe', 'off'], remoteMedia: ['block', 'https'],
	})) {
		const item = await setting(key);
		for (const value of [...values.slice(1), values[0]]) {
			const select = item.locator('select');
			if (await select.count()) await select.selectOption(value);
			else {
				const combo = item.getByRole('combobox');
				await combo.click();
				await page.getByRole('option', { name: value, exact: true }).click();
			}
			await wait(async () => ((await settings())[`mdLivePreview.${key}`] ?? values[0]) === value, `select ${key} ${value}`);
		}
		check(`Settings enum ${key}: all ${values.length} options persist`);
	}
	await page.getByRole('tab', { name: 'Workspace', exact: true }).click();
	const remote = await setting('remoteMedia');
	await remote.locator('select').selectOption('https');
	const workspaceSettings = async () => JSON.parse(await readFile(join(workspace, '.vscode/settings.json'), 'utf8'));
	await wait(async () => await exists(join(workspace, '.vscode/settings.json')) && (await workspaceSettings())['mdLivePreview.remoteMedia'] === 'https', 'workspace HTTPS opt-in');
	await remote.locator('select').selectOption('block');
	await wait(async () => ((await workspaceSettings())['mdLivePreview.remoteMedia'] ?? 'block') === 'block', 'revoke workspace HTTPS');
	check('Workspace remote-media opt-in and revocation persist');
	await page.getByRole('tab', { name: 'User', exact: true }).click();
	const excluded = await setting('vault.exclude');
	const defaultExclusions = ['.git', 'node_modules', '.DS_Store', 'Thumbs.db'];
	const exclusions = async () => (await settings())['mdLivePreview.vault.exclude'] ?? defaultExclusions;
	await excluded.getByRole('button', { name: /Add Item/ }).click();
	await excluded.getByPlaceholder('Item...').fill('qa-canceled/**');
	await excluded.getByRole('button', { name: 'Cancel', exact: true }).click();
	assert.deepEqual(await exclusions(), defaultExclusions);
	await excluded.getByRole('button', { name: /Add Item/ }).click();
	await excluded.getByPlaceholder('Item...').fill('qa-hidden/**');
	await excluded.getByRole('button', { name: 'OK', exact: true }).click();
	await wait(async () => (await exclusions()).includes('qa-hidden/**'), 'add exclusion');
	const exclusionRow = value => excluded.getByRole('listitem', { name: `List item \`${value}\``, exact: true });
	await exclusionRow('qa-hidden/**').hover();
	await exclusionRow('qa-hidden/**').getByRole('button', { name: 'Edit Item', exact: true }).click();
	await excluded.getByPlaceholder('Item...').fill('qa-edited/**');
	await excluded.getByRole('button', { name: 'OK', exact: true }).click();
	await wait(async () => (await exclusions()).includes('qa-edited/**') && !(await exclusions()).includes('qa-hidden/**'), 'edit exclusion');
	await exclusionRow('qa-edited/**').hover();
	await exclusionRow('qa-edited/**').getByRole('button', { name: 'Remove Item', exact: true }).click();
	await wait(async () => JSON.stringify(await exclusions()) === JSON.stringify(defaultExclusions), 'restore exclusions');
	check('Exclusion list supports cancel, add, edit, and removal with saved values');
	const attachment = await setting('vault.attachmentFolder');
	await attachment.getByRole('textbox').fill('QA Attachments');
	await attachment.getByRole('textbox').press('Tab');
	await wait(async () => (await settings())['mdLivePreview.vault.attachmentFolder'] === 'QA Attachments', 'attachment folder');
	await attachment.getByRole('textbox').fill('assets');
	await attachment.getByRole('textbox').press('Tab');
	await wait(async () => ((await settings())['mdLivePreview.vault.attachmentFolder'] ?? 'assets') === 'assets', 'restore attachment folder');
	check('Attachment folder text setting changes and restores');
	await writeFile(join(artifacts, 'report.json'), JSON.stringify({ checks, platform: process.platform, completed: true }, null, 2));
} catch (error) {
	if (page) {
		await page.screenshot({ path: join(artifacts, 'failure.png') }).catch(() => {});
		await writeFile(join(artifacts, 'failure-dom.txt'), await page.locator('body').innerHTML()).catch(() => {});
	}
	await writeFile(join(artifacts, 'report.json'), JSON.stringify({ checks, platform: process.platform, completed: false, error: String(error) }, null, 2));
	throw error;
} finally {
	await browser?.close().catch(() => {});
	if (child && child.exitCode === null) {
		child.kill();
		await Promise.race([new Promise(resolveExit => child.once('exit', resolveExit)), delay(5000)]);
	}
	await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}

async function palette(command) {
	await page.keyboard.press(`${mod}+Shift+p`);
	const input = page.locator('.quick-input-widget:visible .quick-input-box input');
	await input.fill(`>${command}`);
	await page.locator('.quick-input-widget:visible .monaco-list-row').filter({ hasText: command }).filter({ hasNotText: '(JSON)' }).first().click();
	await page.locator('.quick-input-widget').waitFor({ state: 'hidden' });
}

async function setting(key) {
	if (!await page.locator('.settings-editor:visible').count()) await palette('Preferences: Open User Settings');
	// Native Settings saves and re-renders after text fields lose focus.
	await delay(500);
	const search = page.locator('.settings-editor .suggest-input-container .monaco-editor');
	await search.click();
	await page.keyboard.press(`${mod}+a`);
	await page.keyboard.type(`@id:mdLivePreview.${key}`, { delay: 15 });
	const item = page.locator(`.setting-item-contents[data-key="mdLivePreview.${key}"]`);
	await item.waitFor({ state: 'visible' });
	return item;
}
async function settings() { return JSON.parse(await readFile(settingsFile, 'utf8')); }
async function exists(path) { try { await stat(path); return true; } catch { return false; } }
async function wait(checkCondition, label, timeout = 10000) {
	const end = Date.now() + timeout;
	while (Date.now() < end) { if (await checkCondition()) return; await delay(100); }
	throw new Error(`Timed out: ${label}`);
}
async function reservePort() {
	const server = createServer();
	await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolveListen); });
	const address = server.address();
	await new Promise(resolveClose => server.close(resolveClose));
	return address.port;
}
