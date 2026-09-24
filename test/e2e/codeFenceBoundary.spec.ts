import { expect, test, type Page } from '@playwright/test';
import { mountEditor } from './harness';

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

async function editedText(page: Page, source: string): Promise<string> {
	return page.evaluate(original => {
		let text = original;
		for (const message of (window as any).__posted) {
			if (message.type !== 'edit') continue;
			for (const change of [...message.changes].reverse()) text = text.slice(0, change.from) + change.insert + text.slice(change.to);
		}
		return text;
	}, source);
}

for (const opener of ['```', '```text', '~~~~']) {
	for (const key of ['Enter', `${modifier}+Enter`]) {
		test(`${key} between ${opener} blocks keeps new prose outside both code blocks`, async ({ page }) => {
			const closer = opener.startsWith('~') ? '~~~~' : '```';
			const first = `${opener}\nfirst_code\n${closer}`;
			const second = `${opener}\nsecond_code\n${closer}`;
			const source = `Intro\n\n${first}\n\nBetween blocks\n\n${second}\n\nAfter`;
			await mountEditor(page, source);
			await page.locator('.cm-line', { hasText: 'Between blocks' }).click();
			await page.keyboard.press('End');
			await page.keyboard.press('Enter');
			await page.keyboard.press(key);
			await page.keyboard.type('New standalone note');
			await expect.poll(() => editedText(page, source)).toContain('New standalone note');
			const current = await editedText(page, source);
			expect(current).toContain(first);
			expect(current).toContain(second);
			expect(current.indexOf('New standalone note')).toBeGreaterThan(current.indexOf('Between blocks'));
			expect(current.indexOf('New standalone note')).toBeLessThan(current.indexOf(second));
			await expect(page.getByRole('button', { name: 'Copy code block', exact: true })).toHaveCount(2);
		});
	}
}
