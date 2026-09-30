import { test, expect, type Page } from '@playwright/test';
import { mountEditor } from './harness';
import { largeMixedDocument } from '../fixtures/largeMixedDocument';

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

async function find(page: Page, text: string): Promise<void> {
	await page.locator('.cm-content').focus();
	await page.keyboard.press(`${mod}+f`);
	await page.keyboard.press(`${mod}+a`);
	await page.keyboard.type(text, { delay: 2 });
	await page.keyboard.press('Enter');
	await page.keyboard.press('Escape');
}

async function source(page: Page): Promise<string> {
	return page.locator('.cm-content').evaluate(element => (element as any).cmTile.root.view.state.doc.toString());
}

test('restoring table source length after redrafting does not reopen source during cell editing', async ({ page }, info) => {
	const original = largeMixedDocument(50) + '\n\nBoundaryBefore\n\n| Item | State |\n| --- | --- |\n| BoundaryCell | Keep |\n\nBoundaryAfter';
	const errors: string[] = [];
	page.on('pageerror', error => errors.push(error.message));
	await mountEditor(page, original);
	await find(page, 'BoundaryAfter');
	const table = page.locator('.mlp-table-wrap').filter({ hasText: 'BoundaryCell' });
	await table.getByRole('button', { name: 'Show Markdown source', exact: true }).click();
	await find(page, 'BoundaryCell');
	await page.keyboard.press('ArrowRight');
	for (const character of 'XYZ') await page.keyboard.type(character);
	await page.locator('.cm-line', { hasText: 'BoundaryAfter' }).click();
	const cell = page.locator('.mlp-table tbody td').filter({ hasText: 'BoundaryCellXYZ' });
	await cell.click();
	await page.keyboard.press('End');
	for (let count = 0; count < 3; count++) await page.keyboard.press('Backspace');
	await page.keyboard.press('Enter');
	await expect.poll(() => source(page)).toBe(original);
	await expect(page.locator('.mlp-table tbody td').filter({ hasText: 'BoundaryCell' })).toBeVisible();
	await page.screenshot({ path: info.outputPath('source-length-roundtrip.png') });
	expect(errors).toEqual([]);
});

for (const [name, object, selector] of [
	['setext heading one', 'Boundary title\n==============', '.mlp-line-h1'],
	['setext heading two', 'Boundary title\n--------------', '.mlp-line-h2'],
	['indented code', '    retained_code();\n    another_call();', '.mlp-line-code'],
] as const) test(`joins and restores the paragraphs around ${name} without stale line styles`, async ({ page }, info) => {
	const prefix = Array.from({ length: 700 }, (_, n) => `Archived paragraph ${n}: ${'Retain the evidence without altering it. '.repeat(8)}\n\n`).join('');
	const before = 'Above boundary marker';
	const after = 'Below boundary marker';
	const original = prefix + before + '\n\n' + object + '\n\n' + after;
	await mountEditor(page, original);
	for (let cycle = 0; cycle < 3; cycle++) {
		await find(page, before);
		await page.keyboard.press('ArrowRight');
		await page.keyboard.press('Delete');
		await page.keyboard.press('Delete');
		await expect.poll(() => source(page)).toBe(original.replace(before + '\n\n', before));
		await page.keyboard.press('Enter');
		await page.keyboard.press('Enter');
		// Splitting prose before indentation trims that whitespace; restore the
		// intentional code indentation explicitly, as a user retyping it would.
		if (name === 'indented code') await page.keyboard.type('    ');
		await expect.poll(() => source(page)).toBe(original);
		await find(page, after);
		await page.keyboard.press('ArrowRight');
		await page.keyboard.type(' corrections');
		for (const _character of ' corrections') await page.keyboard.press('Backspace');
		await expect.poll(() => source(page)).toBe(original);
		await expect(page.locator(selector)).toHaveCount(name === 'indented code' ? 2 : 1);
		for (const text of [before, after]) {
			await expect(page.locator('.cm-line', { hasText: text })).not.toHaveClass(/mlp-line-h[1-6]|mlp-line-code|mlp-line-callout|mlp-line-list/);
		}
	}
	await page.screenshot({ path: info.outputPath('boundary-structure.png') });
});
