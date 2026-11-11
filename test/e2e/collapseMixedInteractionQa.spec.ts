import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mountEditor, postToWebview } from './harness';

const table = '| Name | Notes |\n| --- | --- |\n' + Array.from({ length: 40 }, (_, n) => `| Row ${n + 1} | **Detail ${n + 1}** |`).join('\n');
for (const editingMode of ['editing', 'locked'] as const) for (const collapsed of ['first', 'second', 'both']) {
	test(`${editingMode}: deleting an identical neighbor preserves the surviving ${collapsed} collapse choice`, async ({ page }) => {
		// Keep both widgets mounted; long offscreen tables are intentionally virtualized.
		const duplicate = table.split('\n').slice(0, 11).join('\n');
		const original = 'Before\n\n' + duplicate + '\n\n' + duplicate + '\n\nAfter';
		await mountEditor(page, original, { editingMode });
		if (collapsed !== 'second') await page.locator('.mlp-table-wrap').nth(0).getByRole('button', { name: 'Collapse table', exact: true }).click();
		if (collapsed !== 'first') await page.locator('.mlp-table-wrap').nth(1).getByRole('button', { name: 'Collapse table', exact: true }).click();
		const from = 'Before\n\n'.length, to = from + duplicate.length + 2;
		await postToWebview(page, { type: 'externalUpdate', version: 1, changes: [{ from, to, insert: '' }] });
		await expect(page.locator('.mlp-table')).toHaveCount(1);
		await expect(page.locator('.mlp-table tbody tr:visible')).toHaveCount(collapsed === 'first' ? 9 : 5);
		expect(await page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString())).toBe(original.slice(0, from) + original.slice(to));
	});
}

for (const editingMode of ['editing', 'locked'] as const) for (const themeKind of ['dark', 'light'] as const) {
	test(`${editingMode}: ${themeKind} collapsed resized table keeps sticky tracks aligned`, async ({ page }) => {
		await mountEditor(page, 'Before\n\n' + table + '\n\n' + 'After\n\n'.repeat(40), { editingMode, themeKind, stickyTableHeaders: true });
		await page.getByRole('separator', { name: 'Resize column 2', exact: true }).focus();
		for (let n = 0; n < 45; n++) await page.keyboard.press('Shift+ArrowRight');
		const width = await page.locator('.mlp-table').evaluate(table => table.getBoundingClientRect().width);
		await page.getByRole('button', { name: 'Collapse table', exact: true }).click();
		await expect(page.locator('.mlp-table tbody tr:visible')).toHaveCount(5);
		await page.locator('.mlp-table-wrap').evaluate(wrap => {
			const scroll = document.querySelector('.cm-scroller')!;
			scroll.scrollTop += wrap.querySelector('.mlp-table')!.getBoundingClientRect().top - scroll.getBoundingClientRect().top + 45;
			wrap.querySelector('.mlp-table-viewport')!.scrollLeft = 150;
		});
		await expect(page.locator('.mlp-table-sticky-header')).not.toHaveAttribute('hidden');
		await expect.poll(() => page.locator('.mlp-table-wrap').evaluate(wrap => {
			const real = wrap.querySelector('.mlp-table th')!.getBoundingClientRect(), sticky = wrap.querySelector('.mlp-sticky-table th')!.getBoundingClientRect();
			return Math.max(Math.abs(real.left - sticky.left), Math.abs(real.width - sticky.width), Math.abs(real.height - sticky.height));
		})).toBeLessThan(2);
		await page.getByRole('button', { name: 'Expand table', exact: true }).click();
		await expect(page.locator('.mlp-table tbody tr:visible')).toHaveCount(40);
		expect(Math.abs(await page.locator('.mlp-table').evaluate(table => table.getBoundingClientRect().width) - width)).toBeLessThan(2);
	});
}

test('nested code and table previews survive mixed global folding and individual reopening', async ({ page }) => {
	const code = '```text\n' + Array.from({ length: 12 }, (_, n) => `snippet_${n + 1}`).join('\n') + '\n```';
	const body = table + '\n\n- [ ] Review\n\n' + code;
	const original = 'Before\n\n> [!warning] Meeting\n>\n> ' + body.split('\n').join('\n> ') + '\n\nAfter';
	await mountEditor(page, original);
	for (let n = 0; n < 3; n++) {
		await page.getByRole('button', { name: 'Collapse all collapsible objects' }).click();
		await page.getByRole('button', { name: 'Meeting callout', exact: true }).click();
		await expect(page.locator('.mlp-table tbody tr:visible')).toHaveCount(5);
		await expect(page.locator('.cm-content')).toContainText('snippet_6');
		await expect(page.locator('.cm-content')).not.toContainText('snippet_7');
		await page.getByRole('button', { name: 'Expand table', exact: true }).click();
		await page.getByRole('button', { name: 'Expand code block', exact: true }).click();
		await expect(page.locator('.mlp-table tbody tr:visible')).toHaveCount(40);
		await expect(page.locator('.cm-content')).toContainText('snippet_12');
	}
	expect(await page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString())).toBe(original);
	expect(await page.evaluate(() => (window as any).__posted.filter((m: any) => m.type === 'edit'))).toEqual([]);
});

test('Markdown Preview handles repeated table and code updates without duplicate controls or lost content', async ({ page }) => {
	await page.setContent('<style>pre { overflow: auto; width: 350px; line-height: 20px; }</style><pre><code></code></pre><table><thead><tr><th>Name</th></tr></thead><tbody></tbody></table>');
	await page.addStyleTag({ content: readFileSync(join(process.cwd(), 'media/markdown-preview-copy.css'), 'utf8') });
	await page.locator('code').evaluate(code => { code.textContent = Array.from({ length: 12 }, (_, n) => `line${n} ` + 'x'.repeat(200)).join('\n'); });
	await page.locator('tbody').evaluate(body => { for (let n = 0; n < 10; n++) { const row = document.createElement('tr'); row.appendChild(document.createElement('td')).textContent = `Row ${n}`; body.appendChild(row); } });
	await page.addScriptTag({ content: readFileSync(join(process.cwd(), 'media/markdown-preview-copy.js'), 'utf8') });
	await page.getByRole('button', { name: 'Collapse table', exact: true }).click();
	await page.getByRole('button', { name: 'Collapse code block', exact: true }).click();
	for (let n = 0; n < 5; n++) {
		await page.locator('code').evaluate((code, n) => { code.textContent += `\nAdded ${n}`; }, n);
		await page.locator('tbody').evaluate((body, n) => { const row = document.createElement('tr'); row.appendChild(document.createElement('td')).textContent = `New ${n}`; body.appendChild(row); }, n);
		await expect(page.locator('tbody tr:visible')).toHaveCount(5);
		await expect(page.getByRole('button', { name: 'Expand table', exact: true })).toHaveCount(1);
		await expect(page.getByRole('button', { name: 'Expand code block', exact: true })).toHaveCount(1);
	}
	expect(await page.locator('code').evaluate(code => Math.abs(code.getBoundingClientRect().height - 6 * parseFloat(getComputedStyle(code).lineHeight)))).toBeLessThan(2);
	expect(await page.locator('pre').evaluate(pre => pre.scrollWidth > pre.clientWidth)).toBe(true);
	await page.getByRole('button', { name: 'Expand code block', exact: true }).click();
	await page.getByRole('button', { name: 'Expand table', exact: true }).click();
	await expect(page.locator('code')).toContainText('Added 4');
	await expect(page.locator('tbody tr:visible')).toHaveCount(15);
});
