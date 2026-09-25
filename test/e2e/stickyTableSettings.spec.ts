import { expect, test, type Locator, type Page } from '@playwright/test';
import { mountEditor, postToWebview } from './harness';

function table(columns: number, rows: number, name = 'Table'): string {
	const headings = Array.from({ length: columns }, (_, column) => `${name} column ${column}`);
	return `| ${headings.join(' | ')} |\n| ${headings.map(() => '---').join(' | ')} |\n`
		+ Array.from({ length: rows }, (_, row) => '| ' + headings.map((_, column) => `${name} row ${row} value ${column}`).join(' | ') + ' |').join('\n');
}

async function scrollIntoTable(wrap: Locator): Promise<void> {
	await expect.poll(() => wrap.evaluate(async element => {
		const scroller = document.querySelector('.cm-scroller')!;
		const table = element.querySelector('.mlp-table')!;
		scroller.scrollTop += table.getBoundingClientRect().top - scroller.getBoundingClientRect().top + 120;
		await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
		return Math.abs(table.getBoundingClientRect().top - scroller.getBoundingClientRect().top + 120);
	})).toBeLessThanOrEqual(2);
}

async function assertNoEdits(page: Page): Promise<void> {
	expect(await page.evaluate(() => (window as unknown as { __posted: Array<{ type: string }> }).__posted.filter(message => message.type === 'edit'))).toEqual([]);
}

async function assertAligned(wrap: Locator, wide: boolean): Promise<void> {
	await expect.poll(() => wrap.evaluate((element, wide) => {
		const scrollerTop = document.querySelector('.cm-scroller')!.getBoundingClientRect().top;
		const headers = Array.from(element.querySelectorAll(wide ? '.mlp-sticky-table th' : '.mlp-table thead th'));
		const cells = Array.from(element.querySelectorAll('.mlp-table tbody tr:first-child td'));
		if (headers.length !== cells.length || headers.length === 0) return Number.POSITIVE_INFINITY;
		return Math.max(Math.abs(headers[0].getBoundingClientRect().top - scrollerTop), ...cells.flatMap((cell, index) => {
			const body = cell.getBoundingClientRect(), header = headers[index].getBoundingClientRect();
			return [Math.abs(body.left - header.left), Math.abs(body.width - header.width)];
		}));
	}, wide)).toBeLessThanOrEqual(2);
}

for (const editingMode of ['editing', 'locked'] as const) {
	for (const wide of [false, true]) {
		test(`sticky headers default off and toggle live without moving the table: wide=${wide}, mode=${editingMode}`, async ({ page }) => {
			await page.setViewportSize({ width: wide ? 500 : 1200, height: 650 });
			await mountEditor(page, `Intro\n\n${table(wide ? 12 : 2, 36)}\n\n${'After\n\n'.repeat(15)}`, { editingMode });
			const wrap = page.locator('.mlp-table-wrap');
			const viewport = wrap.locator('.mlp-table-viewport');
			const originalTable = await wrap.locator('.mlp-table').elementHandle();
			await expect(wrap.locator('.mlp-table th').first()).not.toHaveCSS('position', 'sticky');
			await scrollIntoTable(wrap);
			await expect(page.locator('.mlp-table-sticky-header:not([hidden])')).toHaveCount(0);
			expect(await wrap.locator('.mlp-table th').first().evaluate(element => element.getBoundingClientRect().top
				- document.querySelector('.cm-scroller')!.getBoundingClientRect().top)).toBeLessThan(-80);
			if (wide) {
				await viewport.evaluate(element => { element.scrollLeft = 450; });
				await expect.poll(() => viewport.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
			}
			const position = await viewport.evaluate(element => ({ left: element.scrollLeft, top: document.querySelector('.cm-scroller')!.scrollTop }));
			for (const enabled of [true, false, true, false]) {
				await postToWebview(page, { type: 'setStickyTableHeaders', enabled });
				if (enabled) {
					await assertAligned(wrap, wide);
					if (wide) {
						await expect(wrap.locator('.mlp-table-sticky-header')).not.toHaveAttribute('hidden');
						await expect(wrap.locator('.mlp-table-sticky-clip')).toBeVisible();
					}
				} else {
					await expect(wrap.locator('.mlp-table th').first()).not.toHaveCSS('position', 'sticky');
					await expect(page.locator('.mlp-table-sticky-header:not([hidden])')).toHaveCount(0);
				}
				expect(await originalTable!.evaluate(element => element.isConnected)).toBe(true);
				await expect.poll(() => viewport.evaluate((element, original) => Math.max(Math.abs(element.scrollLeft - original.left),
					Math.abs(document.querySelector('.cm-scroller')!.scrollTop - original.top)), position)).toBeLessThanOrEqual(2);
			}
			await assertNoEdits(page);
		});
	}
}

test('a live sticky preference applies independently to several tables', async ({ page }) => {
	await page.setViewportSize({ width: 650, height: 650 });
	await mountEditor(page, `Intro\n\n${table(8, 18, 'First')}\n\nBetween\n\n${table(10, 18, 'Second')}\n\n${'After\n\n'.repeat(15)}`);
	const first = page.locator('.mlp-table-wrap').filter({ hasText: 'First column 0' });
	await scrollIntoTable(first);
	await postToWebview(page, { type: 'setStickyTableHeaders', enabled: true });
	await assertAligned(first, true);
	await first.evaluate(element => {
		const scroller = document.querySelector('.cm-scroller')!;
		scroller.scrollTop += element.getBoundingClientRect().bottom - scroller.getBoundingClientRect().top;
	});
	const second = page.locator('.mlp-table-wrap').filter({ hasText: 'Second column 0' });
	await scrollIntoTable(second);
	await expect(page.locator('.mlp-table-sticky-header:not([hidden])')).toHaveCount(1);
	await expect(second.locator('.mlp-table-sticky-clip')).toBeVisible();
	await assertAligned(second, true);
	await second.locator('.mlp-table-viewport').evaluate(element => { element.scrollLeft = 600; });
	await assertAligned(second, true);
	await postToWebview(page, { type: 'setStickyTableHeaders', enabled: false });
	await expect(page.locator('.mlp-table-sticky-header:not([hidden])')).toHaveCount(0);
	await assertNoEdits(page);
});

test('changing sticky headers preserves the focused unfinished cell, selection, and exact later edit', async ({ page }) => {
	await page.setViewportSize({ width: 500, height: 650 });
	const original = `Intro\n\n${table(12, 3)}\n\nAfter`;
	await mountEditor(page, original);
	const viewport = page.locator('.mlp-table-viewport');
	await viewport.evaluate(element => { element.scrollLeft = element.scrollWidth; });
	const cell = page.locator('.mlp-table tbody tr').first().locator('td').last();
	await cell.focus();
	await page.keyboard.press('F2');
	await page.keyboard.type('Unfinished | draft');
	const originalCell = await cell.elementHandle();
	const originalLeft = await viewport.evaluate(element => element.scrollLeft);
	for (const enabled of [true, false, true, false]) {
		await postToWebview(page, { type: 'setStickyTableHeaders', enabled });
		expect(await originalCell!.evaluate(element => element.isConnected && document.activeElement === element)).toBe(true);
		await expect(cell).toHaveText('Unfinished | draft');
		await expect(cell).toHaveAttribute('contenteditable', 'true');
		expect(await viewport.evaluate(element => element.scrollLeft)).toBe(originalLeft);
	}
	await assertNoEdits(page);
	await page.keyboard.press('Enter');
	await expect(cell).toHaveText('Unfinished | draft');
	await expect.poll(() => page.evaluate(original => {
		let text = original;
		for (const message of (window as unknown as { __posted: Array<{ type: string; changes: Array<{ from: number; to: number; insert: string }> }> }).__posted) {
			if (message.type === 'edit') for (const change of [...message.changes].reverse()) {
				text = text.slice(0, change.from) + change.insert + text.slice(change.to);
			}
		}
		return text;
	}, original)).toBe(original.replace('Table row 0 value 11', 'Unfinished \\| draft'));
});
