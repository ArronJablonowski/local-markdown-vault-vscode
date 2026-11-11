import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

for (const collapsed of [false, true]) for (const mutation of ['remove-button', 'move-table', 'detach-table']) {
	test(`table preview restores its control after ${mutation}, collapsed=${collapsed}`, async ({ page }) => {
		await page.setContent('<main><table><thead><tr><th>Name</th></tr></thead><tbody>' + Array.from({ length: 20 }, (_, n) => `<tr><td>Row ${n}</td></tr>`).join('') + '</tbody></table></main><aside></aside>');
		await page.addScriptTag({ content: readFileSync(join(process.cwd(), 'media/markdown-preview-copy.js'), 'utf8') });
		await expect(page.getByRole('button', { name: 'Collapse table', exact: true })).toBeVisible();
		if (collapsed) await page.getByRole('button', { name: 'Collapse table', exact: true }).click();
		await page.locator('table').evaluate((table, mutation) => {
			if (mutation === 'remove-button') table.previousElementSibling?.remove();
			else if (mutation === 'move-table') document.querySelector('aside')!.append(table);
			else { table.remove(); setTimeout(() => document.querySelector('aside')!.append(table), 50); }
		}, mutation);
		await expect(page.locator('.lmv-table-collapse-button')).toHaveCount(1);
		await expect.poll(() => page.locator('table').evaluate(table => table.previousElementSibling?.classList.contains('lmv-table-collapse-button'))).toBe(true);
		await expect(page.locator('tbody tr:visible')).toHaveCount(collapsed ? 5 : 20);
		await page.getByRole('button', { name: collapsed ? 'Expand table' : 'Collapse table', exact: true }).press('Enter');
		await expect(page.locator('tbody tr:visible')).toHaveCount(collapsed ? 20 : 5);
	});
}

for (const collapsed of [false, true]) for (const replacement of ['empty', 'prose', 'new-code']) {
	test(`code preview cleans obsolete controls after ${replacement}, collapsed=${collapsed}`, async ({ page }) => {
		await page.setContent('<pre><code class="language-js">' + Array.from({ length: 12 }, (_, n) => `old${n}`).join('\n') + '</code></pre>');
		await page.addScriptTag({ content: readFileSync(join(process.cwd(), 'media/markdown-preview-copy.js'), 'utf8') });
		await expect(page.getByRole('button', { name: 'Collapse code block', exact: true })).toBeVisible();
		if (collapsed) await page.getByRole('button', { name: 'Collapse code block', exact: true }).click();
		await page.locator('code').evaluate((code, replacement) => {
			code.remove();
			if (replacement === 'prose') document.querySelector('pre')!.append('Retained plain text');
		}, replacement);
		await expect(page.locator('pre button, .lmv-code-language')).toHaveCount(0);
		await expect(page.locator('pre')).not.toHaveClass(/lmv-code-collapsed|lmv-code-copy-host/);
		if (replacement === 'new-code') {
			await page.locator('pre').evaluate(pre => { const code = document.createElement('code'); code.textContent = 'New source'; pre.append(code); });
			await expect(page.getByRole('button', { name: 'Copy code block', exact: true })).toHaveCount(1);
			await expect(page.locator('.lmv-code-collapse-button, .lmv-code-language')).toHaveCount(0);
		}
	});
}
