import { test, expect, type Page } from '@playwright/test';
import { mountEditor, postToWebview } from './harness';

async function copied(page: Page) {
	await page.getByRole('button', { name: 'Copy code block', exact: true }).click();
	const message = await page.evaluate(() => (window as unknown as { __posted: Array<{ type: string; text?: string; requestId: number }> }).__posted.filter(m => m.type === 'copyCode').at(-1));
	await postToWebview(page, { type: 'copyCodeResult', requestId: message!.requestId, ok: true });
	return message?.text;
}

for (const language of ['python', 'javascript', 'typescript', 'json', 'html', 'css', 'sql', 'bash', 'powershell', 'rust', 'cpp', 'unknown-language']) {
	test(`${language}: replace, add, delete, and copy code without losing fences`, async ({ page }) => {
		await mountEditor(page, `Before\n\n\`\`\`${language}\noriginal_value\nkeep_this_line\n\`\`\`\n\nAfter`);
		await page.locator('.cm-line', { hasText: 'original_value' }).click();
		await page.keyboard.press('Home');
		await page.keyboard.press('Shift+End');
		await page.keyboard.insertText('updated_value 👩🏽‍💻');
		expect(await copied(page)).toBe('updated_value 👩🏽‍💻\nkeep_this_line');
		await page.locator('.cm-line', { hasText: 'updated_value' }).click();
		await page.keyboard.press('End');
		await page.keyboard.press('Enter');
		await page.keyboard.type('temporary_value');
		expect(await copied(page)).toBe('updated_value 👩🏽‍💻\ntemporary_value\nkeep_this_line');
		await page.locator('.cm-line', { hasText: 'temporary_value' }).click();
		await page.keyboard.press('Home');
		await page.keyboard.press('Shift+End');
		await page.keyboard.press('Backspace');
		await page.keyboard.press('Delete');
		expect(await copied(page)).toBe('updated_value 👩🏽‍💻\nkeep_this_line');
		await expect(page.locator('.mlp-code-language')).toHaveText(language);
	});
}

for (const length of [0, 1, 7, 8, 9, 100]) {
	test(`copy and fold ${length}-line code blocks`, async ({ page }) => {
		const code = Array.from({ length }, (_, i) => `line_${i + 1}`).join('\n');
		await mountEditor(page, `Before\n\n~~~text\n${code}${length ? '\n' : ''}~~~\n\nAfter`);
		expect(await copied(page)).toBe(code);
		await expect(page.getByRole('button', { name: 'Collapse code block', exact: true })).toHaveCount(length >= 8 ? 1 : 0);
		if (length >= 8) {
			await page.getByRole('button', { name: 'Collapse code block', exact: true }).click();
			expect(await copied(page)).toBe(code);
			await page.getByRole('button', { name: 'Expand code block', exact: true }).click();
			expect(await copied(page)).toBe(code);
		}
	});
}

test('preview updates of an existing code node preserve collapse consistency', async ({ page }) => {
	const { readFileSync } = await import('node:fs');
	const { join } = await import('node:path');
	await page.setContent('<pre><code class="language-python"></code></pre>');
	await page.locator('code').evaluate(code => code.textContent = Array.from({ length: 8 }, (_, i) => `line ${i}`).join('\n'));
	await page.addScriptTag({ content: readFileSync(join(__dirname, '../../media/markdown-preview-copy.js'), 'utf8') });
	await page.getByRole('button', { name: 'Collapse code block', exact: true }).click();
	await page.locator('code').evaluate(code => code.textContent = 'short');
	await expect(page.locator('code')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Expand code block', exact: true })).toHaveCount(0);
	await page.locator('code').evaluate(code => code.textContent = Array.from({ length: 10 }, (_, i) => `new ${i}`).join('\n'));
	await page.getByRole('button', { name: 'Collapse code block', exact: true }).click();
	await page.locator('code').evaluate(code => code.textContent += '\nnew 10');
	await expect(page.getByRole('button', { name: 'Expand code block', exact: true })).toHaveAttribute('title', /11 lines/);
});

test('mouse-selected code can be removed without changing adjacent prose', async ({ page }) => {
	await mountEditor(page, 'Before\n\n```python\nfirst_value\nsecond_value\n```\n\nAfter');
	const first = await page.locator('.cm-line', { hasText: 'first_value' }).boundingBox();
	const last = await page.locator('.cm-line', { hasText: 'second_value' }).boundingBox();
	await page.mouse.move(first!.x + 18, first!.y + first!.height - 8);
	await page.mouse.down();
	await page.mouse.move(last!.x + last!.width - 8, last!.y + last!.height / 2, { steps: 12 });
	await page.mouse.up();
	expect(await page.evaluate(() => window.getSelection()?.toString())).toContain('first_value');
	expect(await page.evaluate(() => window.getSelection()?.toString())).toContain('second_value');
	await page.keyboard.press('Backspace');
	await expect(page.locator('.mlp-copy-code-host')).toHaveCount(0);
	await expect(page.locator('.cm-content')).toContainText('Before');
	await expect(page.locator('.cm-content')).toContainText('After');
});

test('long code lines and hostile HTML remain inert and copy exactly', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 650 });
	const code = '<img src="https://example.invalid/track" onerror="alert(1)">\n' + 'long_value '.repeat(200);
	const requests: string[] = [];
	page.on('request', request => { if (request.url().includes('example.invalid')) requests.push(request.url()); });
	await mountEditor(page, `Before\n\n\`\`\`html\n${code}\n\`\`\`\n\nAfter`);
	expect(await copied(page)).toBe(code);
	await expect(page.locator('.cm-content img[src*="example.invalid"], .cm-content [onerror]')).toHaveCount(0);
	expect(requests).toEqual([]);
	const controls = await page.locator('.mlp-copy-code-host').boundingBox();
	expect(controls!.x).toBeGreaterThanOrEqual(0);
	expect(controls!.x + controls!.width).toBeLessThanOrEqual(390);
});
