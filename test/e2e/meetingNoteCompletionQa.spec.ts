import { expect, test, type Page } from '@playwright/test';
import { mountEditor } from './harness';

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
const errors = new Map<Page, string[]>();
test.beforeEach(({ page }) => {
	const found: string[] = [];
	errors.set(page, found);
	page.on('pageerror', error => found.push(error.message));
});
test.afterEach(({ page }) => { expect(errors.get(page)).toEqual([]); errors.delete(page); });

async function source(page: Page): Promise<string> {
	return page.locator('.cm-content').evaluate(element => (element as any).cmTile.root.view.state.doc.toString());
}

async function assertSourceAndHost(page: Page, initial: string, expected: string): Promise<void> {
	await expect.poll(() => source(page)).toBe(expected);
	await expect.poll(() => page.evaluate(initial => {
		let text = initial;
		for (const message of (window as any).__posted) {
			if (message.type !== 'edit') continue;
			for (const change of [...message.changes].reverse()) text = text.slice(0, change.from) + change.insert + text.slice(change.to);
		}
		return text;
	}, initial)).toBe(expected);
}

async function focusEnd(page: Page): Promise<void> {
	await page.locator('.cm-content').focus();
	await page.keyboard.press(`${mod}+End`);
}

test('character-by-character meeting tags remain tags at a new paragraph and survive corrections', async ({ page }) => {
	const initial = '# Meeting notes\n\n';
	await mountEditor(page, initial);
	await focusEnd(page);
	await page.keyboard.type('#meeting/weekly #followup', { delay: 15 });
	for (let n = 0; n < 8; n++) await page.keyboard.press('Backspace');
	await page.keyboard.type('action', { delay: 15 });
	await assertSourceAndHost(page, initial, initial + '#meeting/weekly #action');
	await expect(page.locator('.mlp-tag')).toHaveText(['#meeting/weekly', '#action']);
});

for (const prefix of ['- Agenda ', '1. Agenda ', '- [ ] Agenda ', '> Agenda ', '==Agenda ==']) {
	test(`emoji completion accepts Enter and immediate typing inside ${JSON.stringify(prefix)}`, async ({ page }) => {
		await mountEditor(page, prefix);
		await focusEnd(page);
		if (prefix.endsWith('==')) { await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft'); }
		await page.keyboard.type(':smilx', { delay: 20 });
		await page.keyboard.press('Backspace');
		await page.keyboard.type('e');
		await expect(page.getByRole('option', { name: /:smile:/ })).toBeVisible();
		// Respect the completion menu's accidental-acceptance grace period.
		await page.waitForTimeout(120);
		await page.keyboard.press('Enter');
		await page.keyboard.type(' approved', { delay: 15 });
		const expected = prefix.endsWith('==') ? prefix.slice(0, -2) + '😄 approved==' : prefix + '😄 approved';
		await assertSourceAndHost(page, prefix, expected);
	});
}

for (const [name, initial, cursorText] of [
	['fenced code', '```text\nkeep first\nEDIT_HERE\nkeep last\n```\n\nAfter', 'EDIT_HERE'],
	['YAML comments', '---\n##EDIT_HERE\nowner: Morgan\n---\n\nAfter', 'EDIT_HERE'],
] as const) test(`hash typing preserves literal ${name}`, async ({ page }) => {
	await mountEditor(page, initial);
	await page.locator('.cm-content').focus();
	await page.keyboard.press(`${mod}+f`);
	await page.locator('.cm-search input[name="search"]').fill(cursorText);
	await page.keyboard.press('Enter'); await page.keyboard.press('Escape');
	await page.keyboard.press('Backspace');
	const typed = name === 'YAML comments' ? 'comment' : '##comment';
	await page.keyboard.type(typed, { delay: 15 });
	await assertSourceAndHost(page, initial, initial.replace(cursorText, typed));
});
