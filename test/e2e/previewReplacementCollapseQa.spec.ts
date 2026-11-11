import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mountEditor, postToWebview } from './harness';

for (const collapsed of [true, false]) for (const count of [6, 7, 8, 30]) {
	test(`preview code replacement retains collapse=${collapsed}, new lines=${count}, and copies current source`, async ({ page }) => {
		await page.setContent('<pre><code class="language-js"></code></pre>');
		await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (value: string) => { (window as any).__copied = value; } } }); });
		await page.locator('code').evaluate(code => { code.textContent = Array.from({ length: 12 }, (_, n) => `old${n}`).join('\n'); });
		await page.addStyleTag({ content: readFileSync(join(process.cwd(), 'media/markdown-preview-copy.css'), 'utf8') });
		await page.addScriptTag({ content: readFileSync(join(process.cwd(), 'media/markdown-preview-copy.js'), 'utf8') });
		await expect(page.getByRole('button', { name: 'Collapse code block', exact: true })).toBeVisible();
		if (collapsed) await page.getByRole('button', { name: 'Collapse code block', exact: true }).click();
		const source = Array.from({ length: count }, (_, n) => `new${n}`).join('\n');
		await page.locator('code').evaluate((code, source) => { const next = document.createElement('code'); next.className = 'language-python'; next.textContent = source; code.replaceWith(next); }, source);
		await expect(page.locator('.lmv-code-language')).toHaveText('python');
		const shouldCollapse = collapsed && count > 6;
		if (count >= 8 || shouldCollapse) await expect(page.getByRole('button', { name: shouldCollapse ? 'Expand code block' : 'Collapse code block', exact: true })).toHaveCount(1);
		else await expect(page.locator('.lmv-code-collapse-button')).toHaveCount(0);
		await expect(page.locator('pre')).toHaveClass(shouldCollapse ? /lmv-code-collapsed/ : /^(?!.*lmv-code-collapsed).*$/);
		await page.getByRole('button', { name: 'Copy code block', exact: true }).click();
		await expect.poll(() => page.evaluate(() => (window as any).__copied)).toBe(source);
		await expect(page.locator('.lmv-code-copy-button')).toHaveCount(1);
	});
}

for (const kind of ['table', 'code']) for (const quoted of [true, false]) {
	test(`${kind} collapse does not consume undo or redo after keyboard editing, quoted=${quoted}`, async ({ page }) => {
		const block = kind === 'table' ? '| Name | Value |\n| --- | --- |\n' + Array.from({ length: 9 }, (_, n) => `| Item${n} | Data${n} |`).join('\n') : '```text\n' + Array.from({ length: 12 }, (_, n) => `line${n}`).join('\n') + '\n```';
		const source = 'Before\n\n' + (quoted ? '> [!note] Meeting\n>\n> ' + block.split('\n').join('\n> ') : block) + '\n\nAfter';
		await mountEditor(page, source);
		const first = page.locator('.cm-line', { hasText: /^Before$/ });
		await first.click(); await page.keyboard.press('End'); await page.keyboard.type(' edited', { delay: 25 });
		await page.getByRole('button', { name: kind === 'table' ? 'Collapse table' : 'Collapse code block', exact: true }).click();
		await page.locator('.cm-line', { hasText: /^Before edited$/ }).click(); await page.keyboard.press('End');
		const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
		await page.keyboard.press(`${mod}+z`);
		const current = () => page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString());
		const history = () => page.evaluate(() => (window as any).__posted.filter((message: any) => ['undo', 'redo'].includes(message.type)).map((message: any) => message.type));
		await expect.poll(history).toEqual(['undo']);
		// Native VS Code owns history; model its response rather than local CM undo.
		await postToWebview(page, { type: 'externalUpdate', version: 100, changes: [{ from: 6, to: 13, insert: '' }] });
		await expect.poll(current).toBe(source);
		await page.keyboard.press(`${mod}+Shift+z`);
		await expect.poll(history).toEqual(['undo', 'redo']);
		await postToWebview(page, { type: 'externalUpdate', version: 101, changes: [{ from: 6, to: 6, insert: ' edited' }] });
		await expect.poll(current).toBe(source.replace('Before', 'Before edited'));
		await expect(page.getByRole('button', { name: kind === 'table' ? 'Expand table' : 'Expand code block', exact: true })).toBeVisible();
	});
}
