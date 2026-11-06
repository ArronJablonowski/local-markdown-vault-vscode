import { expect, test } from '@playwright/test';
import { mountEditor } from './harness';

const contents = [
	['formatting', '**Owner review** with *detailed* ~~superseded~~ findings and [follow up](Notes.md) '.repeat(3)],
	['code', '`VeryLongIdentifierWithoutWhitespaceAndWithUnicode🙂RepeatThisIdentifierSeveralTimes`'],
	['breaks', 'A long first line of meeting notes<br>A long second line of meeting notes<br>A long third line of meeting notes'],
	['nested list', '<ul><li>First detailed review<ul><li>Second nested review<ul><li>Third detailed review</li></ul></li></ul></li></ul>'],
];
for (const editingMode of ['editing', 'locked'] as const) for (const callout of [false, true]) for (const themeKind of ['dark', 'light'] as const) for (const [name, value] of contents) {
	test(`${editingMode}: ${themeKind} ${callout ? 'callout' : 'plain'} ${name} grows and shrinks without clipping`, async ({ page }) => {
		const table = `| Notes | Status |\n| --- | --- |\n| ${value} | **Retained** |`;
		const original = 'Before\n\n' + (callout ? '> [!note] Meeting\n>\n> ' + table.split('\n').join('\n> ') : table) + '\n\nAfter';
		await mountEditor(page, original, { editingMode, themeKind });
		const handle = page.getByRole('separator', { name: 'Resize column 1', exact: true });
		await handle.focus();
		for (let step = 0; step < 55; step++) await page.keyboard.press('Shift+ArrowLeft');
		await expect(handle).toHaveAttribute('aria-valuenow', '64');
		const cell = page.locator('.mlp-table td').first();
		const narrow = await cell.evaluate(cell => ({ height: cell.getBoundingClientRect().height, overflow: cell.scrollWidth - cell.clientWidth }));
		expect(narrow.overflow).toBeLessThan(3);
		for (let step = 0; step < 10; step++) await page.keyboard.press('Shift+ArrowRight');
		await expect.poll(() => cell.evaluate(cell => cell.getBoundingClientRect().height)).toBeLessThan(narrow.height);
		await expect(page.locator('.mlp-table td').last()).toHaveText('Retained');
		expect(await page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString())).toBe(original);
		expect(await page.evaluate(() => (window as any).__posted.filter((m: any) => m.type === 'edit'))).toEqual([]);
	});
}

test('repeated column resizing does not progressively shrink neighboring columns', async ({ page }) => {
	await mountEditor(page, 'Before\n\n| Owner | Status |\n| --- | --- |\n| **Long description** | `Retained` |\n\nAfter');
	const headers = page.locator('.mlp-table th');
	const widths = () => headers.evaluateAll(cells => cells.map(cell => cell.getBoundingClientRect().width));
	const initial = await widths();
	await page.getByRole('separator', { name: 'Resize column 1', exact: true }).focus();
	for (let step = 0; step < 40; step++) await page.keyboard.press(step % 2 ? 'ArrowLeft' : 'ArrowRight');
	const final = await widths();
	expect(Math.abs(final[1] - initial[1])).toBeLessThan(2);
	expect(Math.abs(final[0] - initial[0])).toBeLessThan(2);
});

for (const editingMode of ['editing', 'locked'] as const) for (const themeKind of ['dark', 'light'] as const) for (const listHeader of [false, true]) {
	test(`${editingMode}: ${themeKind} resized sticky header matches wrapped ${listHeader ? 'list' : 'text'} height and width`, async ({ page }) => {
		const heading = listHeader ? '<ul><li>Detailed review<ul><li>Nested heading</li></ul></li></ul>' : '**Detailed meeting notes and follow-up actions**';
		const table = `| ${heading} | Status |\n| --- | --- |\n` + '| Body content | Retained |\n'.repeat(90);
		await mountEditor(page, 'Before\n\n' + table + '\nAfter\n\n' + 'Trailing paragraph\n\n'.repeat(20), { editingMode, themeKind, stickyTableHeaders: true });
		await page.getByRole('separator', { name: 'Resize column 1', exact: true }).focus();
		for (let step = 0; step < 55; step++) await page.keyboard.press('Shift+ArrowLeft');
		await page.getByRole('separator', { name: 'Resize column 2', exact: true }).focus();
		for (let step = 0; step < 55; step++) await page.keyboard.press('Shift+ArrowRight');
		await page.locator('.mlp-table-wrap').evaluate(wrap => {
			const scroll = document.querySelector('.cm-scroller')!;
			const table = wrap.querySelector('.mlp-table')!;
			scroll.scrollTop += table.getBoundingClientRect().top - scroll.getBoundingClientRect().top + table.querySelector('thead')!.getBoundingClientRect().height + 80;
			wrap.querySelector('.mlp-table-viewport')!.scrollLeft = 20;
		});
		await expect(page.locator('.mlp-table-sticky-header')).not.toHaveAttribute('hidden');
		await expect.poll(() => page.locator('.mlp-table-wrap').evaluate(wrap => {
			const real = wrap.querySelector('.mlp-table th')!.getBoundingClientRect();
			const sticky = wrap.querySelector('.mlp-sticky-table th')!.getBoundingClientRect();
			return Math.max(Math.abs(real.height - sticky.height), Math.abs(real.width - sticky.width), Math.abs(real.left - sticky.left));
		})).toBeLessThan(2);
	});
}

for (const callout of [false, true]) for (const [name, value] of contents) {
	test(`editing ${name} in a narrow ${callout ? 'callout' : 'plain'} table grows and restores row height`, async ({ page }) => {
		const table = '| Notes | Status |\n| --- | --- |\n| Seed | Retained |';
		const original = 'Before\n\n' + (callout ? '> [!note] Meeting\n>\n> ' + table.split('\n').join('\n> ') : table) + '\n\nAfter';
		await mountEditor(page, original);
		const handle = page.getByRole('separator', { name: 'Resize column 1', exact: true });
		await handle.focus();
		for (let step = 0; step < 55; step++) await page.keyboard.press('Shift+ArrowLeft');
		const cell = page.locator('.mlp-table td').first();
		const baseline = await cell.evaluate(cell => cell.getBoundingClientRect().height);
		for (const content of [value.trim(), 'Seed']) {
			await cell.click({ position: { x: 12, y: 15 } });
			await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
			await page.keyboard.type(content, { delay: 3 }); await page.keyboard.press('Enter');
			await expect.poll(() => page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString())).toBe(original.replace('Seed', content));
			await expect(handle).toHaveAttribute('aria-valuenow', '64');
			await expect(page.locator('.mlp-table td').last()).toHaveText('Retained');
			if (content === 'Seed') await expect.poll(() => cell.evaluate((cell, expected) => Math.abs(cell.getBoundingClientRect().height - expected), baseline)).toBeLessThan(2);
			else await expect.poll(() => cell.evaluate(cell => cell.getBoundingClientRect().height)).toBeGreaterThan(baseline);
		}
	});
}
