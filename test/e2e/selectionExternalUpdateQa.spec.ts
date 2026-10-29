import { expect, test, type Page } from '@playwright/test';
import { mountEditor, openSearch, postToWebview } from './harness';
import { largeMixedDocument } from '../fixtures/largeMixedDocument';

const source = (page: Page) => page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString());
const originalTarget = 'Final editable paragraph.';
const replacementTarget = 'Updated paragraph with café 🚀.';

for (const operation of ['insert-before', 'replace-target', 'truncate', 'reinitialize']) for (const editingMode of ['editing', 'locked'] as const) for (const held of [false, true]) test(`${operation} during ${held ? 'held mouse' : 'hover'} preserves selection safety in ${editingMode}`, async ({ page }) => {
	const errors: string[] = [];
	page.on('pageerror', error => errors.push(error.message));
	await page.setViewportSize({ width: held ? 520 : 1000, height: 700 });
	const original = largeMixedDocument(100);
	await mountEditor(page, original, { editingMode });
	await openSearch(page);
	await page.locator('input[name="search"]').fill(originalTarget);
	await page.locator('input[name="search"]').press('Enter');
	await page.locator('input[name="search"]').press('Escape');
	await page.locator('.cm-line').filter({ hasText: /^Final editable paragraph\.$/ }).hover();
	if (held) await page.mouse.down();
	const start = original.indexOf(originalTarget);
	const prefix = '# External update\n\n';
	const target = operation === 'insert-before' ? originalTarget : replacementTarget;
	const updated = operation === 'insert-before' ? prefix + original : operation === 'replace-target'
		? original.slice(0, start) + replacementTarget : '# Replacement note\n\n' + replacementTarget;
	if (operation === 'reinitialize') {
		await postToWebview(page, { type: 'init', protocolVersion: 1, text: updated, version: 1, css: '', codeTheme: 'dark-plus',
			remoteMedia: 'block', workspaceTrusted: true, diagramRenderingAllowed: true, editingMode, vaultNotes: [], currentVaultPath: 'Replacement.md' });
	} else {
		const changes = operation === 'insert-before' ? [{ from: 0, to: 0, insert: prefix }]
			: operation === 'replace-target' ? [{ from: start, to: original.length, insert: replacementTarget }]
				: [{ from: 0, to: original.length, insert: updated }];
		await postToWebview(page, { type: 'externalUpdate', changes, version: 1 });
	}
	if (held) await page.mouse.up();
	await expect.poll(() => source(page)).toBe(updated);
	await openSearch(page);
	await page.locator('input[name="search"]').fill(target);
	await page.locator('input[name="search"]').press('Enter');
	await page.locator('input[name="search"]').press('Escape');
	const line = page.locator('.cm-line').filter({ hasText: target }).last();
	await line.scrollIntoViewIfNeeded(); await line.hover();
	const box = await line.evaluate((el: any, target) => {
		const view = el.closest('.cm-content').cmTile.root.view;
		const from = view.state.doc.toString().lastIndexOf(target);
		const start = view.domAtPos(from), end = view.domAtPos(from + target.length);
		const range = document.createRange(); range.setStart(start.node, start.offset); range.setEnd(end.node, end.offset);
		return range.getBoundingClientRect().toJSON();
	}, target);
	await page.mouse.move(box.x + 1, box.y + box.height / 2); await page.mouse.down();
	const pressed = await line.boundingBox();
	await page.mouse.move(box.x + box.width - 1, box.y + box.height / 2, { steps: 15 }); await page.mouse.up();
	const diagnostic = await line.evaluate((el: any, before) => ({ before, after: el.getBoundingClientRect().toJSON(), html: el.outerHTML }), { box, pressed });
	await expect.poll(() => page.locator('.cm-content').evaluate((el: any) => { const state = el.cmTile.root.view.state; return state.sliceDoc(state.selection.main.from, state.selection.main.to); }), { message: JSON.stringify(diagnostic) }).toBe(target);
	await page.keyboard.press('Backspace');
	await expect.poll(() => source(page)).toBe(editingMode === 'locked' ? updated : updated.replace(target, ''));
	expect(errors).toEqual([]);
});
