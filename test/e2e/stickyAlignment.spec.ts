import { test, expect } from '@playwright/test';
import { mountEditor } from './harness';

for (const css of ['', 'th, td { padding: 18px 25px; box-sizing: content-box; } table { width: 100%; table-layout: auto !important; }']) {
	for (const editingMode of ['locked', 'editing'] as const) {
	test(`unequal wide columns stay aligned vertically and horizontally: theme=${!!css}, mode=${editingMode}`, async ({ page }, info) => {
		await page.setViewportSize({ width: 850, height: 650 });
		const headings = ['Reconnaissance', 'Resource Development', 'Initial Access', 'Execution', 'Persistence', 'Privilege Escalation'];
		const rows = Array.from({ length: 25 }, (_, i) => `| ${headings.map((_, c) => `${'Long content '.repeat(c % 3 + 1)}${i}<br>Another line`).join(' | ')} |`);
		await mountEditor(page, `Intro\n\n| ${headings.join(' | ')} |\n| ${headings.map(() => '---').join(' | ')} |\n${rows.join('\n')}\n\nAfter`, { css, editingMode, stickyTableHeaders: true });
		const wrap = page.locator('.mlp-table-wrap');
		const viewport = wrap.locator('.mlp-table-viewport');
		await expect(viewport).toHaveClass(/mlp-table-scrollable/);
		await viewport.evaluate(el => { el.scrollLeft = 350; });
		for (const top of [200, 600, 1000, 200]) {
			await page.locator('.cm-scroller').evaluate((el, top) => { el.scrollTop = top; }, top);
			await expect(wrap.locator('.mlp-table-sticky-header')).not.toHaveAttribute('hidden');
			for (const left of [350, 0, 400, 10000, 0]) {
				await viewport.evaluate((el, left) => { el.scrollLeft = left; }, left);
				await expect.poll(() => wrap.evaluate(el => {
					const cells = Array.from(el.querySelectorAll('.mlp-table tbody tr:first-child td'));
					const headers = Array.from(el.querySelectorAll('.mlp-sticky-table th'));
					return Math.max(...cells.flatMap((cell, i) => {
						const a = cell.getBoundingClientRect(), b = headers[i].getBoundingClientRect();
						return [Math.abs(a.left - b.left), Math.abs(a.width - b.width)];
					}));
				})).toBeLessThanOrEqual(2);
			}
			const clip = wrap.locator('.mlp-table-sticky-clip');
			await clip.hover();
			await page.mouse.wheel(220, 0);
			await expect.poll(() => viewport.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
			await expect.poll(async () => Math.abs(await viewport.evaluate(el => el.scrollLeft) - await clip.evaluate(el => el.scrollLeft))).toBeLessThanOrEqual(1);
		}
		await page.screenshot({ path: info.outputPath('sticky-alignment.png') });
	});
	}
}
