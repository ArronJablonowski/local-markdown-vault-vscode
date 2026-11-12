import { expect, test, type Page } from '@playwright/test';
import { mountEditor } from './harness';

const contexts = [
	['plain', '## Meeting', ''],
	['callout', '> [!warning]+ Meeting', '> '],
	['nested', '> [!note]+ Outer\n>\n> > [!abstract]+ Meeting', '> > '],
	['list callout', '- > [!tip]+ Meeting', '  > '],
];
const values = [
	['formatting', '**Decision** and *follow-up* with ==highlight==, ~~old~~, and `literal code`. '.repeat(5)],
	['HTML list', '<ul><li>First lengthy review<ul><li>Nested review with <strong>important</strong> details</li></ul></li><li>Another action</li></ul>'],
	['line breaks', 'First lengthy paragraph for the meeting<br>Second paragraph with a [local link](Notes.md)<br>Final action'],
	['Unicode', '\u{1F9ED} Caf\u00e9 review \u65e5\u672c\u8a9e and \u05e2\u05d1\u05e8\u05d9\u05ea '.repeat(6)],
	['references', '[local](Notes.md), [[Other]], $x^2$, #meeting, :smile:, and a footnote[^review]. '.repeat(4)],
];
const yaml = 'meeting:\n  owner: Team\n  enabled: true\nactions:\n  - Review\n  - Compare\ndescription: |\n  Literal > [!warning]\n  Literal | table |';
const table = '| Notes | State |\n| --- | --- |\n| Seed | Retained |';
function fixture(header: string, prefix: string, value = 'Seed', rows = 1): string {
	const rowsText = Array.from({ length: rows }, () => `| ${value} | Retained |`).join('\n');
	const content = '- [ ] Review\n    - Compare\n        - Detail\n\n```yaml\n' + yaml + '\n```\n\n| Notes | State |\n| --- | --- |\n' + rowsText;
	return '---\ntitle: Mixed resize QA\npriority: 1\n---\n\n# Mixed resize QA\n\n' + header + '\n' + content.split('\n').map(line => prefix + line).join('\n') + '\n\nOutside\n\n' + table + '\n\nEnd';
}
async function documentText(page: Page): Promise<string> {
	return page.locator('.cm-content').evaluate((element: any) => element.cmTile.root.view.state.doc.toString());
}
for (const [context, header, prefix] of contexts) for (const [format, value] of values) for (const editingMode of ['editing', 'locked'] as const) {
	test(`${context}: ${format}, ${editingMode}, default YAML folds preserve independent table widths and row heights`, async ({ page }) => {
		const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
		await page.setViewportSize({ width: 620, height: 900 });
		const source = fixture(header, prefix, value);
		await mountEditor(page, source, { editingMode, stickyTableHeaders: true });
		await expect(page.getByRole('button', { name: 'Expand YAML properties', exact: true })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Expand code block', exact: true })).toBeVisible();
		const tables = page.locator('.mlp-table');
		await expect(tables).toHaveCount(2);
		if (format === 'HTML list') {
			await expect(tables.first().locator('.mlp-cell-list strong')).toHaveText('important');
			await expect(tables.first()).not.toContainText('<strong>');
		}
		const otherWidths = await tables.nth(1).locator('th').evaluateAll(cells => cells.map(cell => cell.getBoundingClientRect().width));
		const handle = page.getByRole('separator', { name: 'Resize column 1', exact: true }).first();
		await handle.focus();
		const steps = Math.ceil((Number(await handle.getAttribute('aria-valuenow')) - 64) / 40) + 1;
		for (let n = 0; n < steps; n++) await page.keyboard.press('Shift+ArrowLeft');
		await expect(handle).toHaveAttribute('aria-valuenow', '64');
		const cell = tables.first().locator('td').first();
		const narrow = await cell.evaluate(cell => cell.getBoundingClientRect().height);
		for (let n = 0; n < 10; n++) await page.keyboard.press('Shift+ArrowRight');
		await expect.poll(() => cell.evaluate(cell => cell.getBoundingClientRect().height)).toBeLessThan(narrow);
		const resized = Number(await handle.getAttribute('aria-valuenow'));
		await page.getByRole('button', { name: 'Expand code block', exact: true }).click();
		await page.getByRole('button', { name: 'Copy code block', exact: true }).click();
		await expect.poll(() => page.evaluate(() => (window as any).__posted.findLast((m: any) => m.type === 'copyCode')?.text)).toBe(yaml);
		await page.getByRole('button', { name: 'Collapse code block', exact: true }).click();
		if (prefix) {
			const callout = page.getByRole('button', { name: 'Meeting callout', exact: true });
			await callout.click(); await expect(tables).toHaveCount(1); await callout.click();
		}
		await expect(handle).toHaveAttribute('aria-valuenow', String(resized));
		const after = await tables.nth(1).locator('th').evaluateAll(cells => cells.map(cell => cell.getBoundingClientRect().width));
		for (let n = 0; n < after.length; n++) expect(Math.abs(after[n] - otherWidths[n])).toBeLessThan(2);
		if (context === 'nested' && format === 'HTML list' && editingMode === 'editing') {
			await page.screenshot({ path: test.info().outputPath('nested-yaml-table-resized.png') });
		}
		await handle.dblclick();
		await expect(tables.first()).not.toHaveClass(/mlp-table-resized/);
		expect(await documentText(page)).toBe(source);
		expect(await page.evaluate(() => (window as any).__posted.filter((m: any) => m.type === 'edit'))).toEqual([]);
		expect(errors).toEqual([]);
	});
}
for (const [context, header, prefix] of contexts) for (const [format, value] of values) {
	test(`${context}: type and delete ${format} inside a narrow table beside folded YAML and task lists`, async ({ page }) => {
		const source = fixture(header, prefix);
		await mountEditor(page, source);
		const first = page.locator('.mlp-table').first();
		const handle = page.getByRole('separator', { name: 'Resize column 1', exact: true }).first();
		await handle.focus(); for (let n = 0; n < 55; n++) await page.keyboard.press('Shift+ArrowLeft');
		const cell = first.locator('td').first();
		const baseline = await cell.evaluate(cell => cell.getBoundingClientRect().height);
		await cell.dblclick();
		await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
		await page.keyboard.type(value, { delay: 1 });
		await page.keyboard.press('Enter');
		await expect.poll(() => cell.evaluate(cell => cell.getBoundingClientRect().height)).toBeGreaterThan(baseline);
		// Long narrow cells scroll earlier blocks outside CodeMirror's rendered viewport.
		await page.locator('.cm-scroller').evaluate(element => { element.scrollTop = 0; });
		await expect(page.getByRole('button', { name: 'Expand code block', exact: true })).toBeVisible();
		await cell.dblclick();
		await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
		await page.keyboard.press('Backspace'); await page.keyboard.type('Seed'); await page.keyboard.press('Enter');
		await expect.poll(() => cell.evaluate(cell => cell.getBoundingClientRect().height)).toBeLessThanOrEqual(baseline + 2);
		expect(await documentText(page)).toBe(source);
		await expect(page.locator('.mlp-checkbox')).toHaveCount(1);
	});
}
