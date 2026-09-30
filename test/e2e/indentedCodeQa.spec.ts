import { test, expect, type Locator, type Page } from '@playwright/test';
import { mountEditor, postToWebview } from './harness';

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
test.use({ screenshot: 'only-on-failure' });

async function source(page: Page, original: string): Promise<string> {
	return page.evaluate(initial => {
		for (const message of (window as any).__posted) if (message.type === 'edit') {
			for (const change of [...message.changes].reverse()) initial = initial.slice(0, change.from) + change.insert + initial.slice(change.to);
		}
		return initial;
	}, original);
}

async function copy(page: Page, button: Locator = page.getByRole('button', { name: 'Copy code block', exact: true })): Promise<string> {
	await button.click();
	const message = await page.evaluate(() => (window as any).__posted.filter((m: any) => m.type === 'copyCode').at(-1));
	expect(message).toMatchObject({ type: 'copyCode', requestId: expect.any(Number), text: expect.any(String) });
	await postToWebview(page, { type: 'copyCodeResult', requestId: message.requestId, ok: true });
	await expect(button).toHaveText('✓');
	return message.text;
}

async function find(page: Page, text: string): Promise<void> {
	await page.locator('.cm-content').focus();
	await page.keyboard.press(`${mod}+f`);
	await page.locator('.cm-search input[name="search"]').click();
	await page.keyboard.press(`${mod}+a`);
	await page.keyboard.type(text, { delay: 2 });
	await page.keyboard.press('Enter');
	await page.keyboard.press('Escape');
}

for (const prefix of ['    ', '\t']) for (const mode of ['editing', 'locked'] as const) {
	test(`single-line ${JSON.stringify(prefix)} code has styling and exact copy in ${mode} mode`, async ({ page }, info) => {
		const original = `Before\n\n${prefix}single_value();\n\nAfter`;
		await mountEditor(page, original, { editingMode: mode });
		await expect(page.locator('.mlp-line-code')).toHaveCount(1);
		await expect(page.locator('.mlp-line-code')).toHaveClass(/mlp-line-code-first.*mlp-line-code-last/);
		await expect(page.locator('.mlp-code-language')).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'Collapse code block', exact: true })).toHaveCount(0);
		expect(await copy(page)).toBe('single_value();');
		expect(await source(page, original)).toBe(original);
		await expect(page.locator('.cm-line', { hasText: 'Before' })).not.toHaveClass(/mlp-line-code/);
		await expect(page.locator('.cm-line', { hasText: 'After' })).not.toHaveClass(/mlp-line-code/);
		await page.screenshot({ path: info.outputPath('single-line-code.png') });
	});
}

for (const prefix of ['    ', '\t']) for (const length of [7, 8, 12]) {
	test(`${length}-line ${JSON.stringify(prefix)} code folds at the threshold without changing source`, async ({ page }, info) => {
		const code = Array.from({ length }, (_, i) => `retained_${i}();`).join('\n');
		const original = 'Before\n\n' + code.split('\n').map(line => prefix + line).join('\n');
		await mountEditor(page, original, { editingMode: length === 8 ? 'locked' : 'editing' });
		expect(await copy(page)).toBe(code);
		await expect(page.getByRole('button', { name: 'Collapse code block', exact: true })).toHaveCount(length >= 8 ? 1 : 0);
		if (length >= 8) {
			for (let repeat = 0; repeat < 3; repeat++) {
				await page.getByRole('button', { name: 'Collapse code block', exact: true }).click();
				await expect(page.getByRole('button', { name: 'Expand code block', exact: true })).toHaveAttribute('aria-expanded', 'false');
				await expect(page.locator('.cm-content')).not.toContainText(`retained_${length - 1}();`);
				expect(await copy(page)).toBe(code);
				await page.getByRole('button', { name: 'Expand code block', exact: true }).click();
				await expect(page.locator('.cm-content')).toContainText(`retained_${length - 1}();`);
			}
			await page.getByRole('button', { name: 'Collapse code block', exact: true }).click();
			await page.getByRole('button', { name: 'Switch to code mode', exact: true }).click();
			await expect(page.getByRole('button', { name: 'Collapse code block', exact: true })).toBeVisible();
			await expect(page.locator('.cm-content')).toContainText(`retained_${length - 1}();`);
		}
		expect(await source(page, original)).toBe(original);
		await page.screenshot({ path: info.outputPath('expanded-code.png') });
	});
}

for (const [name, opening, prefix, closing] of [
	['blockquote', '', '>     ', ''],
	['nested blockquote', '', '> >     ', ''],
	['list', '- Evidence\n\n', '      ', '\n\n- Next item'],
	['callout', '> [!note] Retained code\n>\n', '>     ', '\n>\n> After callout code'],
] as const) for (const mode of ['editing', 'locked'] as const) {
	test(`${name} indented code retains its container and copies only code in ${mode}`, async ({ page }, info) => {
		const code = Array.from({ length: 8 }, (_, i) => (i === 2 ? '    nested();' : `line_${i}();`)).join('\n');
		const original = 'Before\n\n' + opening + code.split('\n').map(line => prefix + line).join('\n') + closing + '\n\nAfter';
		await mountEditor(page, original, { editingMode: mode });
		await expect(page.locator('.mlp-line-code')).toHaveCount(8);
		expect(await copy(page)).toBe(code);
		await page.getByRole('button', { name: 'Collapse code block', exact: true }).click();
		expect(await copy(page)).toBe(code);
		await expect(page.locator('.cm-content')).not.toContainText('line_7();');
		await page.getByRole('button', { name: 'Expand code block', exact: true }).click();
		await expect(page.locator('.mlp-line-code')).toHaveCount(8);
		await expect(page.locator('.cm-line', { hasText: 'After' }).last()).not.toHaveClass(/mlp-line-code/);
		expect(await source(page, original)).toBe(original);
		await page.screenshot({ path: info.outputPath('nested-code.png') });
	});
}

for (const mode of ['editing', 'locked'] as const) test(`indented HTML stays literal, network-inert and copied exactly in ${mode}`, async ({ page }) => {
	const code = '<script>window.__indentedExecution=true</script>\n<img src="https://indented-code.invalid/pixel" onerror="window.__indentedExecution=true">\n**literal** [link](command:workbench.action.closeWindow)';
	const original = 'Before\n\n' + code.split('\n').map(line => '    ' + line).join('\n') + '\n\nAfter';
	const requested: string[] = [];
	page.on('request', request => { if (request.url().includes('indented-code.invalid')) requested.push(request.url()); });
	await mountEditor(page, original, { editingMode: mode });
	expect(await copy(page)).toBe(code);
	await expect(page.locator('.mlp-line-code script, .mlp-line-code img[src], .mlp-line-code [onerror], .mlp-line-code a, .mlp-line-code strong')).toHaveCount(0);
	expect(await page.evaluate(() => (window as any).__indentedExecution)).toBeUndefined();
	expect(requested).toEqual([]);
	expect(await source(page, original)).toBe(original);
});

for (const prefix of ['    ', '\t']) test(`source reveal and per-key edits preserve ${JSON.stringify(prefix)} code indentation`, async ({ page }) => {
	const original = `Before\n\n${prefix}original_value();\n${prefix}retained_value();\n\nAfter`;
	await mountEditor(page, original);
	await page.getByRole('button', { name: 'Switch to code mode', exact: true }).click();
	await page.keyboard.press('End');
	await page.keyboard.type(' // reviewed', { delay: 12 });
	await expect.poll(() => source(page, original)).toBe(original.replace('original_value();', 'original_value(); // reviewed'));
	expect(await copy(page)).toBe('original_value(); // reviewed\nretained_value();');
	await find(page, ' // reviewed');
	await page.keyboard.press('Backspace');
	await expect.poll(() => source(page, original)).toBe(original);
	await find(page, 'original_value');
	await page.keyboard.type('replacement_value', { delay: 12 });
	await expect.poll(() => source(page, original)).toBe(original.replace('original_value', 'replacement_value'));
	expect(await copy(page)).toBe('replacement_value();\nretained_value();');
	await expect(page.locator('.mlp-copy-code-host')).toHaveCount(1);
});

test('locked source reveal never permits indented-code mutation', async ({ page }) => {
	const original = 'Before\n\n    retained_value();\n\nAfter';
	await mountEditor(page, original, { editingMode: 'locked' });
	await page.getByRole('button', { name: 'Switch to code mode', exact: true }).click();
	await page.keyboard.type('discarded');
	for (const key of ['Backspace', 'Delete', 'Enter']) await page.keyboard.press(key);
	expect(await source(page, original)).toBe(original);
	expect(await copy(page)).toBe('retained_value();');
});
