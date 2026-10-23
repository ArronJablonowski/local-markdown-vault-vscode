import { expect, test, type Page } from '@playwright/test';
import { mountEditor } from './harness';

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
async function find(page: Page, text: string) {
	await page.locator('.cm-content').focus(); await page.keyboard.press(`${mod}+f`);
	await page.locator('.cm-search input[name="search"]').fill(text);
	await page.keyboard.press('Enter'); await page.keyboard.press('Escape');
}
async function paste(page: Page, text: string) {
	await page.locator('.cm-content').evaluate((content, value) => {
		const data = new DataTransfer(); data.setData('text/plain', value);
		content.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
	}, text);
}
const source = (page: Page) => page.locator('.cm-content').evaluate((content: any) => content.cmTile.root.view.state.doc.toString());

for (const quote of ['> ', '> > ']) for (const indent of ['    ', '\t\t']) test(`paragraph paste retains literal indented code inside ${JSON.stringify(quote + indent)}`, async ({ page }, info) => {
	const prefix = quote + indent;
	const original = `# Meeting\n\n${quote}[!note]+ Evidence\n${quote.trimEnd()}\n${prefix}TARGET\n\nOutside sentinel`;
	await mountEditor(page, original); await find(page, 'TARGET');
	await paste(page, 'first();\n\n- literal_not_a_bullet();\nlast();');
	const expected = original.replace('TARGET', `first();\n${prefix}\n${prefix}- literal_not_a_bullet();\n${prefix}last();`);
	await expect.poll(() => source(page)).toBe(expected);
	await page.keyboard.type(' // edited');
	await expect.poll(() => source(page)).toBe(expected.replace('last();', 'last(); // edited'));
	await find(page, 'Outside sentinel'); await page.keyboard.press('ArrowRight');
	await expect(page.locator('.cm-line', { hasText: '- literal_not_a_bullet();' })).toHaveClass(/mlp-line-code/);
	await expect(page.locator('.cm-line', { hasText: 'last();' })).toHaveClass(/mlp-line-code/);
	await page.screenshot({ path: info.outputPath('callout-code-paste.png') });
});

for (const indent of ['    ', '\t\t']) test(`Shift+Enter and end-of-code paste retain ${JSON.stringify(indent)} inside a callout`, async ({ page }) => {
	const prefix = '> ' + indent;
	const original = `# Meeting\n\n> [!note] Evidence\n>\n${prefix}- TARGET\n\nOutside sentinel`;
	await mountEditor(page, original); await find(page, 'TARGET'); await page.keyboard.press('ArrowRight');
	await page.keyboard.press('Shift+Enter'); await page.keyboard.type('next();');
	await expect.poll(() => source(page)).toBe(original.replace('TARGET', `TARGET\n${prefix}next();`));
	await paste(page, '\n- literal();\nlast();');
	await expect.poll(() => source(page)).toBe(original.replace('TARGET', `TARGET\n${prefix}next();\n${prefix}- literal();\n${prefix}last();`));
});

test('Shift+Enter in quoted fenced code does not turn a literal dash into a list continuation', async ({ page }) => {
	const original = '# Meeting\n\n> [!note] Evidence\n> ```text\n> - TARGET\n> ```\n\nOutside sentinel';
	await mountEditor(page, original); await find(page, 'TARGET'); await page.keyboard.press('ArrowRight');
	await page.keyboard.press('Shift+Enter'); await page.keyboard.type('literal();');
	await expect.poll(() => source(page)).toBe(original.replace('TARGET', 'TARGET\n> literal();'));
});

test('Shift+Enter from a list-nested fence opening retains its list and quote containers', async ({ page }) => {
	const original = '# Meeting\n\n> [!note] Evidence\n> - ```text\n>   first();\n>   ```\n\nOutside sentinel';
	await mountEditor(page, original); await find(page, '```text'); await page.keyboard.press('ArrowRight');
	await page.keyboard.press('Shift+Enter'); await page.keyboard.type('inserted();');
	await expect.poll(() => source(page)).toBe(original.replace('```text', '```text\n>   inserted();'));
});

test('callout-looking text and HTML remain literal while pasting and continuing indented code', async ({ page }) => {
	const original = '# Meeting\n\n> [!note]+ Evidence\n>\n>     TARGET\n\nOutside sentinel';
	await mountEditor(page, original); await find(page, 'TARGET');
	await paste(page, '[!warning]\n<script>window.unwanted=true</script>');
	await expect.poll(() => source(page)).toBe(original.replace('TARGET', '[!warning]\n>     <script>window.unwanted=true</script>'));
	await find(page, '[!warning]'); await page.keyboard.press('ArrowRight');
	await page.keyboard.press('Shift+Enter'); await page.keyboard.type('retained();');
	await expect.poll(() => source(page)).toContain('>     [!warning]\n>     retained();\n>     <script>');
	await find(page, 'Outside sentinel'); await page.keyboard.press('ArrowRight');
	await expect(page.locator('.mlp-callout-header')).toHaveCount(1);
	await expect(page.locator('.cm-content script')).toHaveCount(0);
	expect(await page.evaluate(() => (window as any).unwanted)).toBeUndefined();
});
