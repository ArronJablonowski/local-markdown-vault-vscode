// Actual workbench mouse/keyboard gestures in the caller's disposable vault.
// Setup/readback uses fixture files; extension commands are invoked only by UI.
import assert from 'node:assert/strict';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export async function runVaultGestureQa({ page, workspace, modifier, onCheck, onKnownIssue }) {
	const checks = [];
	const knownIssues = [];
	const base = 'Gesture QA';
	const path = relative => join(workspace, base, relative);
	const row = (type, relative) => page.getByRole('treeitem', { name: `${type}: ${base}${relative ? `/${relative}` : ''}`, exact: true });
	const prompt = () => page.locator('.quick-input-widget:visible .quick-input-box input');
	const report = label => { checks.push(label); onCheck?.(label); console.log(`PASS ${label}`); };
	const fixture = async (relative, text) => {
		const parts = relative.split('/'); parts.pop();
		await mkdir(path(parts.join('/')), { recursive: true });
		await writeFile(path(relative), text, { flag: 'wx' });
	};
	const exact = async (relative, expected) => assert.equal(await readFile(path(relative), 'utf8'), expected, `${relative} changed unexpectedly`);
	const palette = async command => {
		await page.keyboard.press(`${modifier}+Shift+p`);
		await prompt().fill(`>${command}`);
		const matches = page.locator('.quick-input-widget:visible .monaco-list-row').filter({ hasText: command }).filter({ hasNotText: '(JSON)' });
		// Undo has many similarly named neighbors (Undo Cursor, Undo Last Commit).
		// Its command label must be exact before clicking a destructive history action.
		if (command === 'Undo') await matches.filter({ has: page.locator('.label-name', { hasText: /^Undo$/ }) }).first().click();
		else await matches.first().click();
		await page.locator('.quick-input-widget').waitFor({ state: 'hidden' });
	};
	const focusVault = () => palette('Local Markdown Vault: Focus on Document Vault View');
	const expand = async relative => {
		const folder = row('Folder', relative);
		await folder.waitFor({ state: 'visible' });
		await folder.scrollIntoViewIfNeeded();
		if (await folder.getAttribute('aria-expanded') !== 'true') {
			await folder.click();
			await page.keyboard.press('ArrowRight');
			await wait(async () => await folder.getAttribute('aria-expanded') === 'true', `expand ${relative}`);
		}
	};
	const revealFixture = async relative => {
		await focusVault();
		await palette('Local Markdown Vault: Collapse All Vault Folders');
		await expand('');
		let prefix = '';
		for (const part of relative.split('/')) {
			prefix = prefix ? `${prefix}/${part}` : part;
			await expand(prefix);
		}
		await delay(300); // Let watcher-driven tree replacement settle before gestures.
	};
	const menu = async (type, relative, action) => {
		await row(type, relative).click({ button: 'right' });
		await delay(200);
		await page.getByRole('menuitem').filter({ hasText: action }).click();
	};
	const answer = async value => {
		await prompt().fill(value);
		await prompt().press('Enter');
		await page.locator('.quick-input-widget').waitFor({ state: 'hidden' });
	};
	const selectPair = async (first, second) => {
		await row('File', first).click();
		await row('File', second).click({ modifiers: [modifier] });
		await wait(async () => await row('File', first).getAttribute('aria-selected') === 'true'
			&& await row('File', second).getAttribute('aria-selected') === 'true', 'two native rows selected');
	};
	const drag = async (from, destination, cancel = false) => {
		const start = await row('File', from).locator('.monaco-icon-label').boundingBox();
		const end = await row('Folder', destination).locator('.monaco-icon-label').boundingBox();
		assert.ok(start && end, 'both native drag endpoints must be visible');
		await page.mouse.move(start.x + Math.min(30, start.width / 2), start.y + start.height / 2);
		await page.mouse.down();
		try {
			await page.mouse.move(start.x + Math.min(50, start.width / 2 + 20), start.y + start.height / 2, { steps: 8 });
			await delay(250);
			await page.mouse.move(end.x + Math.min(30, end.width / 2), end.y + end.height / 2, { steps: 20 });
			await delay(300);
			if (cancel) await page.keyboard.press('Escape');
		} finally { await page.mouse.up(); }
	};
	const warning = async expression => {
		await wait(async () => expression.test(await page.locator('.notifications-toasts').innerText()), 'visible rejection notification');
	};
	// Give the native file tree room before drag tests. Otherwise its sticky
	// ancestor rows can obscure a destination even when its DOM still has a box.
	await focusVault();
	for (const title of ['Backlinks', 'Broken Links', 'Tags', 'Outline', 'CSS Themes']) {
		const header = page.getByRole('button', { name: `${title} Section`, exact: true });
		if (await header.isVisible() && await header.getAttribute('aria-expanded') === 'true') await header.click();
	}

	// 1. Exercise multi-selection moves and a fresh inverse move, then record
	// native Undo's known missing-model limitation without hiding that failure.
	const alpha = '# Alpha\nExact alpha 🧭 bytes.\n';
	const beta = '# Beta\n- [x] Exact beta task\n';
	const links = '[Alpha](Alpha.md) and [Beta](Beta.md)\n';
	await fixture('01 Multi/Alpha.md', alpha);
	await fixture('01 Multi/Beta.md', beta);
	await fixture('01 Multi/Index.md', links);
	await mkdir(path('01 Multi/Destination'));
	await revealFixture('01 Multi');
	await selectPair('01 Multi/Alpha.md', '01 Multi/Beta.md');
	await drag('01 Multi/Alpha.md', '01 Multi/Destination');
	await wait(async () => await exists(path('01 Multi/Destination/Alpha.md')) && await exists(path('01 Multi/Destination/Beta.md')), 'both selected notes moved');
	assert.equal(await exists(path('01 Multi/Alpha.md')), false);
	assert.equal(await exists(path('01 Multi/Beta.md')), false);
	await exact('01 Multi/Destination/Alpha.md', alpha);
	await exact('01 Multi/Destination/Beta.md', beta);
	await wait(async () => await readFile(path('01 Multi/Index.md'), 'utf8') === '[Alpha](Destination/Alpha.md) and [Beta](Destination/Beta.md)\n', 'both incoming links saved');
	// Unlike native Undo, dedicated history must restore the saved, never-shown
	// incoming-link note too. Exercise both palette and actual context menus.
	await delay(1100);
	await palette('Local Markdown Vault: Undo Vault Move or Rename');
	await wait(async () => await exists(path('01 Multi/Alpha.md')) && await exists(path('01 Multi/Beta.md'))
		&& await readFile(path('01 Multi/Index.md'), 'utf8') === links, 'dedicated Undo restores paths and unopened links');
	await exact('01 Multi/Alpha.md', alpha); await exact('01 Multi/Beta.md', beta);
	await revealFixture('01 Multi');
	await menu('File', '01 Multi/Alpha.md', 'Redo Vault Move or Rename');
	await wait(async () => await exists(path('01 Multi/Destination/Alpha.md')) && await exists(path('01 Multi/Destination/Beta.md'))
		&& await readFile(path('01 Multi/Index.md'), 'utf8') === '[Alpha](Destination/Alpha.md) and [Beta](Destination/Beta.md)\n', 'dedicated Redo restores move and unopened links');
	await exact('01 Multi/Destination/Alpha.md', alpha); await exact('01 Multi/Destination/Beta.md', beta);
	report('Dedicated Vault Undo via Command Palette and Redo via context menu restore unopened links and exact file bytes');
	// A fresh move back is the safe workaround for the native Undo limitation
	// below: prove it through the same tree gestures and exact disk assertions.
	await revealFixture('01 Multi/Destination');
	await selectPair('01 Multi/Destination/Alpha.md', '01 Multi/Destination/Beta.md');
	await drag('01 Multi/Destination/Alpha.md', '01 Multi');
	await wait(async () => await exists(path('01 Multi/Alpha.md')) && await exists(path('01 Multi/Beta.md'))
		&& await readFile(path('01 Multi/Index.md'), 'utf8') === links, 'fresh move back restores paths and links');
	await exact('01 Multi/Alpha.md', alpha); await exact('01 Multi/Beta.md', beta);
	await revealFixture('01 Multi');
	await selectPair('01 Multi/Alpha.md', '01 Multi/Beta.md');
	await drag('01 Multi/Alpha.md', '01 Multi/Destination');
	await wait(async () => await exists(path('01 Multi/Destination/Alpha.md')) && await exists(path('01 Multi/Destination/Beta.md'))
		&& await readFile(path('01 Multi/Index.md'), 'utf8') === '[Alpha](Destination/Alpha.md) and [Beta](Destination/Beta.md)\n', 'second forward move');
	await palette('Undo');
	await wait(async () => await exists(path('01 Multi/Alpha.md')) && await exists(path('01 Multi/Beta.md'))
		&& !await exists(path('01 Multi/Destination/Alpha.md')) && !await exists(path('01 Multi/Destination/Beta.md')), 'one native Undo restores both notes');
	const linksRestored = await wait(async () => await readFile(path('01 Multi/Index.md'), 'utf8') === links,
		'Undo restores incoming links', 2000).then(() => true, () => false);
	if (!linksRestored) {
		// Deliberately report the known failure separately instead of disguising
		// it as a pass or blocking the four unrelated native interaction checks.
		await exact('01 Multi/Index.md', '[Alpha](Destination/Alpha.md) and [Beta](Destination/Beta.md)\n');
		const issue = 'Native Undo restores moved files but omits link rollback when the only incoming-link document was never displayed and its saved model was disposed.';
		knownIssues.push(issue);
		onKnownIssue?.(issue);
		console.log(`KNOWN ISSUE ${issue}`);
	}
	await exact('01 Multi/Alpha.md', alpha); await exact('01 Multi/Beta.md', beta);
	report('Native multi-selection drag and fresh move back save exact paths, links, and bytes; file bytes survive filesystem Undo');
	await revealFixture('01 Multi');
	await row('File', '01 Multi/Alpha.md').click({ button: 'right' });
	for (const action of ['Undo Vault Move or Rename', 'Redo Vault Move or Rename']) {
		const item = page.getByRole('menuitem').filter({ hasText: action });
		await wait(async () => await item.getAttribute('aria-disabled') === 'true', `${action} disabled after native history divergence`);
	}
	await page.keyboard.press('Escape');

	// 2. Escape during a real drag must cancel it without poisoning the next drag.
	const canceled = '# Canceled drag\nThis exact source must survive Escape.\n';
	await fixture('02 Cancel/Cancel.md', canceled);
	await mkdir(path('02 Cancel/Destination'));
	await revealFixture('02 Cancel');
	await row('File', '02 Cancel/Cancel.md').click();
	await drag('02 Cancel/Cancel.md', '02 Cancel/Destination', true);
	await delay(600);
	await exact('02 Cancel/Cancel.md', canceled);
	assert.equal(await exists(path('02 Cancel/Destination/Cancel.md')), false, 'Escape must cancel the drag');
	await drag('02 Cancel/Cancel.md', '02 Cancel/Destination');
	await wait(() => exists(path('02 Cancel/Destination/Cancel.md')), 'next drag succeeds after cancellation');
	assert.equal(await exists(path('02 Cancel/Cancel.md')), false);
	await exact('02 Cancel/Destination/Cancel.md', canceled);
	report('Escape cancels an active mouse drag and the next drag still works');

	// 3. One collision must reject the entire native multi-selection operation.
	const existing = '# Existing destination\nNever overwrite this file.\n';
	await fixture('03 Collision/Alpha.md', alpha);
	await fixture('03 Collision/Beta.md', beta);
	await fixture('03 Collision/Index.md', links);
	await fixture('03 Collision/Destination/Beta.md', existing);
	await revealFixture('03 Collision');
	await palette('Notifications: Clear All Notifications');
	await selectPair('03 Collision/Alpha.md', '03 Collision/Beta.md');
	await drag('03 Collision/Alpha.md', '03 Collision/Destination');
	await warning(/already exists|Could not move the vault item/i);
	await exact('03 Collision/Alpha.md', alpha); await exact('03 Collision/Beta.md', beta);
	await exact('03 Collision/Index.md', links); await exact('03 Collision/Destination/Beta.md', existing);
	assert.equal(await exists(path('03 Collision/Destination/Alpha.md')), false, 'collision must not partially move the noncolliding note');
	report('A native multi-file drop collision reports failure without partial moves or overwritten bytes');

	// 4. Invalid/canceled prompt edits cannot mutate files, then Unicode succeeds.
	await fixture('04 Prompts/Original.md', alpha);
	await fixture('04 Prompts/Taken.md', existing);
	await mkdir(path('04 Prompts/Existing folder'));
	await revealFixture('04 Prompts');
	await menu('File', '04 Prompts/Original.md', 'Rename Vault Item');
	await prompt().fill('../Escaped.md');
	await wait(async () => /path separators/i.test(await page.locator('.quick-input-widget:visible').innerText()), 'rename validation message');
	await prompt().press('Enter');
	assert.equal(await prompt().isVisible(), true, 'invalid path must keep the prompt open');
	await prompt().press('Escape');
	await exact('04 Prompts/Original.md', alpha);
	assert.equal(await exists(path('Escaped.md')), false);
	await menu('File', '04 Prompts/Original.md', 'Rename Vault Item');
	await prompt().fill('Canceled rename.md');
	await prompt().press('Escape');
	await exact('04 Prompts/Original.md', alpha);
	assert.equal(await exists(path('04 Prompts/Canceled rename.md')), false);
	await palette('Notifications: Clear All Notifications');
	await menu('File', '04 Prompts/Original.md', 'Rename Vault Item');
	await answer('Taken.md');
	await warning(/already exists|Could not rename the vault item/i);
	await exact('04 Prompts/Original.md', alpha); await exact('04 Prompts/Taken.md', existing);
	await menu('Folder', '04 Prompts', 'New Folder');
	await prompt().fill('../Escape folder');
	await wait(async () => /path separators/i.test(await page.locator('.quick-input-widget:visible').innerText()), 'folder validation message');
	await prompt().press('Escape');
	assert.equal(await exists(path('Escape folder')), false);
	await palette('Notifications: Clear All Notifications');
	await menu('Folder', '04 Prompts', 'New Folder');
	await answer('Existing folder');
	await warning(/already exists|Could not create the folder/i);
	await menu('Folder', '04 Prompts', 'New Folder');
	await answer('Review Ω 🧭');
	await wait(() => exists(path('04 Prompts/Review Ω 🧭')), 'Unicode folder creation');
	await menu('File', '04 Prompts/Original.md', 'Rename Vault Item');
	await answer('Reviewed Ω 🧭.md');
	await wait(() => exists(path('04 Prompts/Reviewed Ω 🧭.md')), 'Unicode file rename');
	await exact('04 Prompts/Reviewed Ω 🧭.md', alpha);
	assert.equal(await exists(path('04 Prompts/Original.md')), false);
	report('Native Rename/New Folder prompts reject traversal and collisions, honor Escape, and accept Unicode names');

	// 5. A canceled Move picker and sidebar reopening must remain content-neutral.
	const note = '# Keep location\nMove-picker cancellation must not alter this note.\n';
	await fixture('05 Picker/Nested/Keep.md', note);
	await mkdir(path('05 Picker/Destination'));
	await revealFixture('05 Picker/Nested');
	await row('File', '05 Picker/Nested/Keep.md').click();
	await menu('File', '05 Picker/Nested/Keep.md', 'Move Vault Item');
	await prompt().fill('05 Picker/Destination');
	await page.locator('.quick-input-widget:visible .monaco-list-row').filter({ hasText: '05 Picker/Destination' }).waitFor({ state: 'visible' });
	await prompt().press('Escape');
	await page.locator('.quick-input-widget').waitFor({ state: 'hidden' });
	await exact('05 Picker/Nested/Keep.md', note);
	assert.equal(await exists(path('05 Picker/Destination/Keep.md')), false);
	await row('File', '05 Picker/Nested/Keep.md').click();
	await row('File', '05 Picker/Nested/Keep.md').locator('xpath=ancestor::*[@role="tree"][1]').focus();
	await page.keyboard.press(`${modifier}+b`);
	await page.locator('.part.sidebar').waitFor({ state: 'hidden' });
	await delay(300);
	await page.getByRole('tab', { name: /Local Markdown Vault/ }).click();
	await page.locator('.part.sidebar').waitFor({ state: 'visible' });
	await row('File', '05 Picker/Nested/Keep.md').waitFor({ state: 'visible' });
	await wait(async () => await row('File', '05 Picker/Nested/Keep.md').getAttribute('aria-selected') === 'true', 'active note remains selected after reopening Vault');
	assert.equal(await row('Folder', '05 Picker/Nested').getAttribute('aria-expanded'), 'true');
	await exact('05 Picker/Nested/Keep.md', note);
	report('Move picker Escape and closing/reopening the Vault preserve location, selection, expanded ancestors, and source bytes');
	return { checks, knownIssues };
}

async function exists(path) { try { await stat(path); return true; } catch { return false; } }
async function wait(condition, label, timeout = 15_000) {
	const end = Date.now() + timeout;
	while (Date.now() < end) { if (await condition()) return; await delay(100); }
	throw new Error(`Timed out: ${label}`);
}
