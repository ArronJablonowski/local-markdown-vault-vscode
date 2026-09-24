import { test, expect } from '@playwright/test';
import { mountEditor, postToWebview } from './harness';
import { largeMixedDocument } from '../fixtures/largeMixedDocument';

for (const sections of [80, 240, 600]) {
	test(`large mixed note with ${sections} sections survives navigation and editing`, async ({ page }, info) => {
		test.setTimeout(120000);
		const errors: string[] = [];
		page.on('pageerror', error => errors.push(error.message));
		const source = largeMixedDocument(sections);
		await mountEditor(page, source);
		await expect(page.locator('.mlp-frontmatter')).toBeVisible();
		await page.locator('.cm-content').click();
		for (const checkpoint of [sections - 1, Math.floor(sections / 2), 0]) {
			await page.keyboard.press(process.platform === 'darwin' ? 'Meta+f' : 'Control+f');
			const search = page.locator('.cm-search input[name="search"]');
			// Input without keyup reproduces mouse-pasted search terms.
			await search.fill(`Checkpoint ${String(checkpoint).padStart(4, '0')}`);
			await page.keyboard.press('Enter');
			await page.keyboard.press('Escape');
			await expect(page.locator('.cm-content')).toContainText(`Paragraph ${String(checkpoint).padStart(4, '0')}`);
			await page.mouse.wheel(0, 500);
			await page.mouse.wheel(0, -500);
		}
		await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End');
		await page.keyboard.type(' Saved at end.', { delay: 10 });
		await expect(page.locator('.cm-content')).toContainText('Saved at end.');
		await expect(page.locator('.mlp-math-error, .mlp-mermaid-error')).toHaveCount(0);
		expect(errors).toEqual([]);
		await page.screenshot({ path: info.outputPath(`large-${sections}-end.png`) });
	});
}

test('closing Find keeps the selected match visible after a large preview scroll shift', async ({ page }) => {
	await mountEditor(page, largeMixedDocument(240));
	await page.locator('.cm-content').click();
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+f' : 'Control+f');
	await page.locator('.cm-search input[name="search"]').fill('Checkpoint 0120');
	await page.keyboard.press('Enter');
	await expect(page.locator('.cm-content')).toContainText('Paragraph 0120');
	// Simulate the viewport displacement caused by late preview-height measures
	// while preserving the selected search result and the panel's input focus.
	await page.locator('.cm-scroller').evaluate(element => { element.scrollTop += 50_000; });
	await expect(page.locator('.cm-content')).not.toContainText('Paragraph 0120');
	await page.keyboard.press('Escape');
	await expect(page.locator('.cm-content')).toContainText('Paragraph 0120');
});

test('large note mixed widgets survive repeated scrolling, folding, editing, and mouse selection', async ({ page }, info) => {
	test.setTimeout(180000);
	const errors: string[] = [];
	page.on('pageerror', error => errors.push(error.message));
	await mountEditor(page, largeMixedDocument(240));
	const seen = new Set<string>();
	for (let pass = 0; pass < 3; pass++) {
		await page.locator('.cm-content').click();
		await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Home' : 'Control+Home');
		await page.locator('.cm-scroller').evaluate(el => el.scrollTop = 0);
		for (let step = 0; step < 35; step++) {
			for (const kind of ['table', 'callout', 'mermaid', 'drawio']) {
				const selector = kind === 'callout' ? '.mlp-callout-header' : kind === 'table' ? '.mlp-table' : `.mlp-${kind}-wrap`;
				const widget = page.locator(selector).first();
				if (await widget.count()) {
					seen.add(kind);
					if (kind === 'mermaid' || kind === 'drawio') await expect(widget.locator('svg')).toBeAttached();
				}
			}
			await page.mouse.move(850, 400);
			await page.mouse.wheel(0, 450);
			await page.waitForTimeout(70);
		}
	}
	expect([...seen].sort()).toEqual(['callout', 'drawio', 'mermaid', 'table']);
	await page.locator('.cm-scroller').evaluate(el => el.scrollTop = 0);
	const callout = page.locator('.mlp-callout-header').filter({ hasText: 'Review 0000' }).first();
	await callout.click();
	await callout.click();
	const table = page.locator('.mlp-table').filter({ hasText: 'Cell 0000' }).first();
	await table.locator('td').first().focus();
	await page.keyboard.press('F2');
	await page.keyboard.type('Changed large note cell');
	await page.keyboard.press('Enter');
	await expect(page.locator('.mlp-table').filter({ hasText: 'Changed large note cell' })).toBeVisible();
	await page.getByRole('button', { name: 'Collapse code block', exact: true }).first().click();
	await page.getByRole('button', { name: 'Expand code block', exact: true }).first().click();
	await page.getByRole('button', { name: 'Copy code block', exact: true }).first().click();
	const copied = await page.evaluate(() => (window as any).__posted.filter((m: any) => m.type === 'copyCode').at(-1));
	expect(copied.text).toContain('Code 0000, line 39');
	await postToWebview(page, { type: 'copyCodeResult', requestId: copied.requestId, ok: true });
	await page.locator('.cm-content').click();
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+f' : 'Control+f');
	await page.locator('.cm-search input[name="search"]').fill('Final editable paragraph.');
	await page.keyboard.press('Enter');
	await page.keyboard.press('Escape');
	const line = page.locator('.cm-line', { hasText: 'Final editable paragraph.' });
	const box = (await line.boundingBox())!;
	await page.mouse.move(box.x + 1, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width - 1, box.y + box.height / 2, { steps: 20 });
	await page.mouse.up();
	expect(await page.evaluate(() => window.getSelection()?.toString())).toContain('Final editable paragraph.');
	await page.keyboard.press('Backspace');
	await expect(line).toHaveCount(0);
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
	// The browser harness has no host undo stack; native coverage checks disk restoration.
	await expect.poll(() => page.evaluate(() => (window as any).__posted.some((m: any) => m.type === 'undo'))).toBe(true);
	expect(errors).toEqual([]);
	await page.screenshot({ path: info.outputPath('large-mixed-interactions.png') });
});
