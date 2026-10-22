import { expect, test } from '@playwright/test';
import { mountEditor } from './harness';

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
async function paste(page: import('@playwright/test').Page, text: string) {
	await page.locator('.cm-content').evaluate((el, text) => {
		const data = new DataTransfer(); data.setData('text/plain', text);
		el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
	}, text);
}
async function selectTarget(page: import('@playwright/test').Page) {
	await page.locator('.cm-content').focus(); await page.keyboard.press(`${mod}+f`);
	await page.locator('.cm-search input[name="search"]').fill('TARGET'); await page.keyboard.press('Enter'); await page.keyboard.press('Escape');
}
const source = (page: import('@playwright/test').Page) => page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString());
for (const [name, before, after, prefix] of [
	['bullet', '> - ', '', '>   '],
	['task', '> - [ ] ', '', '>       '],
	['list-nested callout', '> - > [!warning]+ Inner\n>   > ', '', '>   > '],
	['fenced code', '> ```text\n> - ', '\n> ```', '> '],
] as const) test(`multiline paste preserves ${name} containers`, async ({ page }) => {
	const original = `Intro\n\n> [!note]+ Outer\n${before}TARGET${after}\n\nOutside sentinel`;
	await mountEditor(page, original); await selectTarget(page);
	const text = 'First Ω\r\n\r\n- Literal or new bullet\r\n\r\nFinal 🚀';
	await paste(page, text);
	await expect.poll(() => source(page)).toBe(original.replace('TARGET', text.replaceAll('\r\n', '\n' + prefix)));
	await page.keyboard.type(' saved');
	await expect.poll(() => source(page)).toContain('Final 🚀 saved');
});
test('whole-source replacement and code outside callouts keep literal clipboard text', async ({ page }) => {
	for (const original of ['Intro\n\n> [!note] A\n> Body', '```text\nTARGET\n```']) {
		await mountEditor(page, original);
		if (original.includes('TARGET')) await selectTarget(page);
		else { await page.locator('.cm-content').focus(); await page.keyboard.press(`${mod}+a`); }
		await paste(page, 'One\n\nTwo');
		await expect.poll(() => source(page)).toBe(original.includes('TARGET') ? original.replace('TARGET', 'One\n\nTwo') : 'One\n\nTwo');
	}
});
test('oversized quote-expanded paste is rejected without partial insertion', async ({ page }) => {
	const quote = '> '.repeat(20);
	const original = `Intro\n\n${quote}[!note] Meeting\n${quote}TARGET`;
	await mountEditor(page, original); await selectTarget(page);
	await paste(page, 'a\n'.repeat(600000));
	await expect.poll(async () => await source(page) === original).toBe(true);
	await expect(page.locator('#mlp-recovery-notice')).toBeVisible();
});
test('locked callout ignores multiline paste', async ({ page }) => {
	const original = 'Intro\n\n> [!note] Meeting\n> TARGET';
	await mountEditor(page, original, { editingMode: 'locked' }); await selectTarget(page);
	await paste(page, 'One\n\nTwo');
	await expect.poll(() => source(page)).toBe(original);
});
test('paste ending at a quoted line boundary does not double its untouched prefix', async ({ page }) => {
	const original = 'Intro\n\n> [!note] Meeting\n> TARGET\n> Keep neighbor';
	await mountEditor(page, original); await selectTarget(page);
	await page.keyboard.press('ArrowLeft'); await page.keyboard.press('Shift+End'); await page.keyboard.press('Shift+ArrowRight');
	await paste(page, 'First\n\nLast\n');
	await expect.poll(() => source(page)).toBe('Intro\n\n> [!note] Meeting\n> First\n> \n> Last\n> Keep neighbor');
});
test('pasted HTML stays inert inside its continuous callout', async ({ page }) => {
	const original = 'Intro\n\n> [!note] Meeting\n> TARGET\n\nOutside sentinel';
	await mountEditor(page, original); await selectTarget(page);
	await paste(page, 'First\n\n<img src=x onerror="window.injected=true">\n\n<script>window.injected=true</script>');
	await expect(page.locator('.cm-content img[src="x"], .cm-content [onerror], .cm-content script')).toHaveCount(0);
	expect(await page.evaluate(() => (window as any).injected)).toBeUndefined();
	await expect.poll(() => source(page)).toContain('\n> \n> <script>');
});
for (const quote of ['> ', '> > ']) for (const size of [100, 100000, 1000000, 2000000]) test(`multiline paragraph paste remains inside ${quote} callout, size ${size}`, async ({ page }) => {
	const original = `Intro\n\n${quote}[!note]+ Meeting\n${quote}TARGET\n\nOutside sentinel`;
	const text = 'First paragraph Ω 🚀.\n\n' + 'Meeting evidence and decisions. '.repeat(Math.ceil(size / 32)) + '\n\nFinal paragraph.';
	await mountEditor(page, original);
	await page.locator('.cm-content').focus(); await page.keyboard.press(`${mod}+f`);
	await page.locator('.cm-search input[name="search"]').fill('TARGET'); await page.keyboard.press('Enter'); await page.keyboard.press('Escape');
	await paste(page, text);
	const expected = original.replace('TARGET', text.replaceAll('\n', '\n' + quote));
	await expect.poll(() => page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString())).toBe(expected);
	await page.keyboard.press(`${mod}+Home`);
	await page.getByRole('button', { name: 'Meeting callout', exact: true }).click();
	await expect(page.locator('.cm-content')).not.toContainText('Final paragraph.');
	await expect(page.locator('.cm-content')).toContainText('Outside sentinel');
});
