import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mountEditor } from './harness';

function table(columns: number, rows: number, prefix = 'Table'): string {
	const row = (values: string[]) => `| ${values.join(' | ')} |`;
	return [row(Array.from({ length: columns }, (_, i) => `${prefix} heading ${i}`)),
		row(Array.from({ length: columns }, (_, i) => [':---', ':---:', '---:'][i % 3])),
		...Array.from({ length: rows }, (_, r) => row(Array.from({ length: columns }, (_, c) =>
			c % 3 === 0 ? `**Row ${r}**<br>Detail ${c}` : c % 3 === 1 ? `Value ${r} — café 日本語` : `[Link ${r}](https://example.com)`)))].join('\n');
}

for (const columns of [1, 3, 12, 30]) {
	for (const width of [400, 900]) {
		test(`${columns} columns at ${width}px preserve layout, formatting, and horizontal access`, async ({ page }) => {
			await page.setViewportSize({ width, height: 720 });
			await mountEditor(page, `Intro\n\n${table(columns, columns === 30 ? 100 : 5)}\n\nAfter`);
			await expect(page.locator('.mlp-table tbody tr')).toHaveCount(columns === 30 ? 100 : 5);
			await expect(page.locator('.mlp-table thead th')).toHaveCount(columns);
			await expect(page.locator('.mlp-table td').first().locator('br')).toHaveCount(1);
			await expect(page.locator('.mlp-table td').first().locator('strong')).toHaveText('Row 0');
			const viewport = page.locator('.mlp-table-viewport');
			await viewport.evaluate(el => { el.scrollLeft = el.scrollWidth; });
			await expect.poll(() => page.locator('.cm-scroller').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(2);
			const right = await viewport.evaluate(el => ({ edge: el.getBoundingClientRect().right, cell: el.querySelector('thead th:last-child')!.getBoundingClientRect().right }));
			expect(Math.abs(right.edge - right.cell)).toBeLessThanOrEqual(2);
		});
	}
}

for (const themed of [false, true]) {
	test(`multiple sticky tables remain independent through scrolling and resizing, theme=${themed}`, async ({ page }) => {
		await page.setViewportSize({ width: 650, height: 700 });
		const css = themed ? readFileSync(join(__dirname, '../../media/sample-styles/obsidian-dark.css'), 'utf8') : '';
		await mountEditor(page, `Intro\n\n${table(12, 35, 'First')}\n\nBetween\n\n${table(8, 30, 'Second')}\n\n${'After\n\n'.repeat(20)}`, { css });
		for (const index of [0, 1, 0]) {
			if (index === 0) await page.locator('.cm-scroller').evaluate(el => { el.scrollTop = 0; });
			else await page.locator('.mlp-table-wrap').first().evaluate(el => {
				const scroller = document.querySelector('.cm-scroller')!;
				scroller.scrollTop += el.getBoundingClientRect().bottom - scroller.getBoundingClientRect().top;
			});
			const wrap = page.locator('.mlp-table-wrap').filter({ hasText: index === 0 ? 'First heading 0' : 'Second heading 0' });
			await wrap.evaluate(el => {
				const scroller = document.querySelector('.cm-scroller')!;
				scroller.scrollTop += el.querySelector('.mlp-table')!.getBoundingClientRect().top - scroller.getBoundingClientRect().top + 120;
			});
			await expect(wrap.locator('.mlp-table-sticky-header')).not.toHaveAttribute('hidden');
			await wrap.locator('.mlp-table-viewport').evaluate(el => { el.scrollLeft = 450; });
			for (const width of [400, 1000]) {
				await page.setViewportSize({ width, height: 700 });
				await expect.poll(() => wrap.evaluate(el => {
					const cells = Array.from(el.querySelectorAll('.mlp-table th'));
					const headers = Array.from(el.querySelectorAll('.mlp-sticky-table th'));
					return Math.max(...cells.map((cell, i) => Math.abs(cell.getBoundingClientRect().left - headers[i].getBoundingClientRect().left)));
				})).toBeLessThanOrEqual(2);
			}
		}
	});
}

test('editing the far-right cell preserves horizontal position and commits only that cell', async ({ page }) => {
	await page.setViewportSize({ width: 500, height: 700 });
	await mountEditor(page, `Intro\n\n${table(12, 3)}\n\nAfter`);
	const viewport = page.locator('.mlp-table-viewport');
	await viewport.evaluate(el => { el.scrollLeft = el.scrollWidth; });
	const cell = page.locator('.mlp-table tbody tr').first().locator('td').last();
	await cell.focus();
	await page.keyboard.press('F2');
	await page.keyboard.type('Edited rightmost');
	expect(await viewport.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
	await page.keyboard.press('Enter');
	await expect(cell).toHaveText('Edited rightmost');
	await expect.poll(() => viewport.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
	await expect(page.locator('.mlp-table td').first()).toHaveText('Row 0Detail 0');
	await expect(page.locator('.mlp-table tbody tr')).toHaveCount(3);
});

test('editing multiline cell source can be canceled and keeps safe line breaks after commit', async ({ page }) => {
	await mountEditor(page, 'Intro\n\n| A | B |\n| --- | --- |\n| **First**<br>Second | `literal` |\n\nAfter');
	const cell = page.locator('.mlp-table td').first();
	await cell.focus();
	await page.keyboard.press('F2');
	await expect(cell).toHaveText('**First**<br>Second');
	await page.keyboard.type('Discard');
	await page.keyboard.press('Escape');
	await expect(cell.locator('br')).toHaveCount(1);
	await cell.focus();
	await page.keyboard.press('F2');
	await page.keyboard.type('**Changed**<br/>Next');
	await page.keyboard.press('Enter');
	await expect(cell.locator('strong')).toHaveText('Changed');
	await expect(cell.locator('br')).toHaveCount(1);
	await expect(page.locator('.mlp-table td').nth(1).locator('code')).toHaveText('literal');
});

for (const editingMode of ['editing', 'locked'] as const) {
	test(`every table has a source button that reveals only its own source in ${editingMode} mode`, async ({ page }) => {
		await mountEditor(page, 'Intro\n\n| First |\n| --- |\n| Alpha |\n\nMiddle\n\n| Second |\n| --- |\n| Bravo |\n\nAfter', { editingMode });
		const buttons = page.getByRole('button', { name: 'Show Markdown source', exact: true });
		await expect(buttons).toHaveCount(2);
		await expect(buttons.first()).toBeVisible();
		await expect(page.locator('.mlp-table-toolbar').first()).toBeHidden();
		await buttons.nth(1).click();
		await expect(page.locator('.cm-line', { hasText: '| Second |' })).toBeVisible();
		await expect(page.locator('.mlp-table')).toHaveCount(1);
		await expect(page.locator('.mlp-table')).toContainText('Alpha');
		await expect(page.locator('.cm-content')).toHaveAttribute('contenteditable', editingMode === 'editing' ? 'true' : 'false');
	});
}

test('Tab between wide-table headers edits the real destination cell', async ({ page }) => {
	await page.setViewportSize({ width: 500, height: 700 });
	await mountEditor(page, `Intro\n\n${table(12, 3)}\n\nAfter`);
	await page.locator('.mlp-table th').first().focus();
	await page.keyboard.press('F2');
	await page.keyboard.type('First edit');
	await page.keyboard.press('Tab');
	await expect(page.locator('.mlp-table th').nth(1)).toBeFocused();
	await page.keyboard.type('Second edit');
	await page.keyboard.press('Enter');
	await expect(page.locator('.mlp-table th').first()).toHaveText('First edit');
	await expect(page.locator('.mlp-table th').nth(1)).toHaveText('Second edit');
	await page.locator('.mlp-table th').first().focus();
	await page.keyboard.press('F2');
	await page.keyboard.press('Tab');
	await expect(page.locator('.mlp-table th').nth(1)).toBeFocused();
});

test('source button commits an unfinished cell edit before revealing source', async ({ page }) => {
	await mountEditor(page, 'Intro\n\n| Header |\n| --- |\n| Before |\n\nAfter');
	await page.locator('.mlp-table td').focus();
	await page.keyboard.press('F2');
	await page.keyboard.type('Saved edit');
	await page.getByRole('button', { name: 'Show Markdown source', exact: true }).click();
	await expect(page.locator('.cm-line', { hasText: '| Saved edit |' })).toBeVisible();
	await expect(page.locator('.mlp-table')).toHaveCount(0);
});
