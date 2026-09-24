import { expect, test } from '@playwright/test';
import { mountEditor } from './harness';

for (const editingMode of ['editing', 'locked'] as const) {
	test(`three large table sets retain sticky alignment in ${editingMode} mode`, async ({ page }, info) => {
		test.setTimeout(180000);
		const errors: string[] = [];
		page.on('pageerror', error => errors.push(error.message));
		const sizes = [[12, 500], [30, 200], [8, 1000]];
		const source = sizes.map(([columns, rows], index) => {
			const headers = Array.from({ length: columns }, (_, c) => `Set ${index} column ${c}`);
			return `## Table set ${index}\n\n| ${headers.join(' | ')} |\n| ${headers.map(() => '---').join(' | ')} |\n` +
				Array.from({ length: rows }, (_, row) => '| ' + headers.map((_, c) => `${row}-${c} ${'wide data '.repeat(c % 4 + 1)}<br>**Detail**`).join(' | ') + ' |').join('\n');
		}).join('\n\n') + '\n\nAfter tables\n' + '\nTrailing paragraph\n'.repeat(40);
		await mountEditor(page, source, { editingMode, css: 'th, td { padding: 12px 18px; } table { table-layout: auto !important; }' });
		for (const index of [0, 1, 2, 0]) {
			// Search brings distant widgets into CodeMirror's rendered viewport.
			await page.locator('.cm-content').click({ position: { x: 5, y: 5 } });
			await page.keyboard.press('ControlOrMeta+f');
			await page.locator('.cm-search input[name="search"]').fill(`Table set ${index}`);
			await page.keyboard.press('Enter');
			await page.keyboard.press('Escape');
			const wrap = page.locator('.mlp-table-wrap').filter({ hasText: `Set ${index} column 0` });
			await expect(wrap).toBeAttached();
			await expect(wrap.locator('.mlp-table tbody tr')).toHaveCount(sizes[index][1]);
			for (const fraction of [0.1, 0.5, 0.9]) {
				await expect.poll(() => wrap.evaluate(async (el, fraction) => {
					const scroller = document.querySelector('.cm-scroller')!;
					const table = el.querySelector('.mlp-table')!;
					const rect = table.getBoundingClientRect();
					scroller.scrollTop += rect.top - scroller.getBoundingClientRect().top + rect.height * fraction;
					await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
					return Math.abs(table.getBoundingClientRect().top - scroller.getBoundingClientRect().top + table.getBoundingClientRect().height * fraction);
				}, fraction)).toBeLessThanOrEqual(2);
				await expect(wrap.locator('.mlp-table-sticky-header')).not.toHaveAttribute('hidden');
				for (const width of [450, 1200]) {
					await page.setViewportSize({ width, height: 700 });
					for (const left of [0, 800, 100000, 0]) {
						await wrap.locator('.mlp-table-viewport').evaluate((el, left) => { el.scrollLeft = left; }, left);
						await expect.poll(() => wrap.evaluate(el => {
							const cells = Array.from(el.querySelectorAll('.mlp-table tbody tr:first-child td'));
							const headers = Array.from(el.querySelectorAll('.mlp-sticky-table th'));
							return Math.max(...cells.flatMap((cell, i) => {
								const a = cell.getBoundingClientRect(), b = headers[i].getBoundingClientRect();
								return [Math.abs(a.left - b.left), Math.abs(a.width - b.width)];
							}));
						})).toBeLessThanOrEqual(2);
					}
				}
			}
		}
		expect(errors).toEqual([]);
		await page.screenshot({ path: info.outputPath('large-table-alignment.png') });
	});
}
