import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mountEditor, mountStyleSidebar, postToWebview } from './harness';

const styles = [
	{ id: 'first', name: 'First QA', enabled: true, css: '' },
	{ id: 'second', name: 'Second QA', enabled: false, css: '' },
];
const settings = { defaultEditor: 'livePreview', defaultEditingMode: 'editing', codeTheme: 'auto', vaultOpenBehavior: 'reuseTab', showWhitespace: 'off', stickyTableHeaders: false };

test('settings keep keyboard focus after the host confirms a change', async ({ page }) => {
	await mountStyleSidebar(page, styles);
	const control = page.getByLabel('Code palette');
	await control.focus();
	await control.selectOption('github-dark');
	await postToWebview(page, { type: 'init', styles, settings: { ...settings, codeTheme: 'github-dark' }, themeKind: 'vscode-dark', workspaceTrusted: true });
	await expect(control).toBeFocused();
});

test('theme selection keeps keyboard focus when its confirmation rebuilds the sidebar', async ({ page }) => {
	await mountStyleSidebar(page, styles);
	await page.getByRole('radio', { name: 'Apply CSS theme Second QA' }).focus();
	await page.keyboard.press('Space');
	await postToWebview(page, { type: 'init', styles: styles.map(s => ({ ...s, enabled: s.id === 'second' })), settings, themeKind: 'vscode-dark', workspaceTrusted: true });
	await expect(page.getByRole('radio', { name: 'Apply CSS theme Second QA' })).toBeFocused();
});

test('every settings option emits the correct bounded host request', async ({ page }) => {
	await mountStyleSidebar(page, styles);
	for (const [key, label] of [
		['showWhitespace', 'Show spaces and line breaks (Live Preview)'], ['stickyTableHeaders', 'Sticky table headers'],
		['defaultEditor', 'Default viewing mode'], ['vaultOpenBehavior', 'Vault file tabs'],
		['defaultEditingMode', 'Default Live Preview mode'], ['codeTheme', 'Code palette'],
	]) {
		const select = page.getByLabel(label);
		for (const value of await select.locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value))) {
			await select.selectOption(value);
			expect(await page.evaluate(() => (window as unknown as { __posted: unknown[] }).__posted.at(-1))).toEqual({ type: 'setSetting', key, value: key === 'stickyTableHeaders' ? value === 'on' : value });
		}
	}
});

for (const editingMode of ['editing', 'locked'] as const) {
	test(`underlined and multiline Markdown headings render consistently in ${editingMode} mode`, async ({ page }) => {
		await mountEditor(page, 'Before\n\nUnderlined title\n================\n\nMultiline\nsubtitle\n--------\n\nAfter', { editingMode });
		await expect(page.locator('.cm-line.mlp-line-h1')).toContainText('Underlined title');
		await expect(page.locator('.cm-line.mlp-line-h2')).toHaveCount(2);
		await expect(page.locator('.cm-line.mlp-line-h2').first()).toContainText('Multiline');
		await expect(page.locator('.cm-line.mlp-line-h2').last()).toContainText('subtitle');
	});
}

test('all theme action buttons address the intended theme without applying it', async ({ page }) => {
	await mountStyleSidebar(page, styles);
	for (const [name, type] of [['Edit CSS', 'openStyle'], ['Duplicate', 'duplicateStyle'], ['Rename', 'renameStyle'], ['Delete', 'deleteStyle']]) {
		await page.locator('.mlp-card').nth(1).getByRole('button', { name, exact: true }).click();
		expect(await page.evaluate(() => (window as unknown as { __posted: unknown[] }).__posted.at(-1))).toEqual({ type, id: 'second' });
		await expect(page.getByRole('radio', { name: 'Apply CSS theme First QA' })).toBeChecked();
	}
	await page.getByRole('button', { name: '+ New style', exact: true }).click();
	expect(await page.evaluate(() => (window as unknown as { __posted: unknown[] }).__posted.at(-1))).toEqual({ type: 'newStyle' });
});

test('sidebar updates neither steal external focus nor expose restricted theme actions', async ({ page }) => {
	await mountStyleSidebar(page, styles);
	await page.evaluate(() => { const input = document.createElement('input'); input.id = 'external-control'; document.body.append(input); input.focus(); });
	await postToWebview(page, { type: 'init', styles, settings, themeKind: 'vscode-dark', workspaceTrusted: false });
	await expect(page.locator('#external-control')).toBeFocused();
	await expect(page.locator('.mlp-card, .mlp-new-style')).toHaveCount(0);
	await expect(page.locator('select')).toHaveCount(6);
});

for (const editingMode of ['editing', 'locked'] as const) {
	test(`new release-review fixture unfolds nested objects in ${editingMode} mode`, async ({ page }) => {
		const source = readFileSync(join(__dirname, '../fixtures/ui-qa/release-review.md'), 'utf8')
			.replace('[RTL SAMPLE]', '\u05e2\u05d1\u05e8\u05d9\u05ea')
			.replace('[CJK SAMPLE]', '\u65e5\u672c\u8a9e');
		await mountEditor(page, source, { editingMode });
		await expect(page.locator('.mlp-line-h1')).toContainText('Release review');
		await expect(page.getByRole('link', { name: 'the second note', exact: true })).toBeVisible();
		const header = page.getByRole('button', { name: 'Pending decisions callout', exact: true });
		await expect(header).toHaveAttribute('aria-expanded', 'false');
		await header.focus();
		await page.keyboard.press('Enter');
		await expect(header).toHaveAttribute('aria-expanded', 'true');
		await expect(page.locator('.mlp-table tbody tr')).toHaveCount(2);
		await expect(page.locator('.mlp-table td').last()).toContainText('x|y');
		await expect(page.getByRole('button', { name: 'Go to footnote review', exact: true })).toBeVisible();
		await header.click();
		await expect(page.locator('.mlp-table')).toHaveCount(0);
	});
}

test('escaped punctuation renders literally while code keeps its backslash', async ({ page }) => {
	await mountEditor(page, 'Before\n\nLiteral \\*asterisks\\* and \\[brackets\\].\n\n`\\*code\\*`\n\nAfter');
	await expect(page.locator('.cm-content')).toContainText('Literal *asterisks* and [brackets].');
	await expect(page.locator('.cm-content')).toContainText('\\*code\\*');
});

test('reference links and images keep existing network and execution boundaries', async ({ page }) => {
	const remoteRequests: string[] = [];
	page.on('request', request => { if (request.url().includes('example.invalid')) remoteRequests.push(request.url()); });
	await mountEditor(page, 'Before\n\n[unsafe][bad] ![tracker][image]\n\n[bad]: javascript:alert(1)\n[image]: https://example.invalid/pixel.png\n\nAfter');
	const link = page.getByRole('link', { name: 'unsafe', exact: true });
	await expect(link).toBeVisible();
	await expect(link).not.toHaveAttribute('href');
	await expect(page.locator('img[src*="example.invalid"]')).toHaveCount(0);
	expect(remoteRequests).toEqual([]);
});
