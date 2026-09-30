import { test, expect } from '@playwright/test';
import { mountEditor } from './harness';
import { largeMixedDocument } from '../fixtures/largeMixedDocument';

test('typing Find immediately after opening preserves the complete query and replacement range', async ({ page }) => {
	test.setTimeout(120000);
	const source = '# Search test\n\nDRAFT_SUMMARY\n\n' + largeMixedDocument(80);
	await mountEditor(page, source);
	await page.evaluate(() => {
		(window as any).__forwardedSearchKeys = [];
		// VS Code's outer webview forwards these events even if defaultPrevented.
		window.addEventListener('keydown', event => {
			if (((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') || ['Escape', 'Enter'].includes(event.key)) {
				(window as any).__forwardedSearchKeys.push(event.key);
			}
		});
	});
	const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
	for (const query of ['DRAFT_SUMMARY', 'Checkpoint 0020', 'DRAFT_SUMMARY']) {
		await page.locator('.cm-line').first().click();
		await page.keyboard.press(`${modifier}+f`);
		const input = page.locator('.cm-search input[name="search"]');
		await input.click();
		await page.keyboard.press(`${modifier}+a`);
		for (const character of query) await page.keyboard.type(character, { delay: 3 });
		await expect(input).toHaveValue(query);
		await page.keyboard.press('Enter');
		await page.keyboard.press('Escape');
		expect(await page.evaluate(() => {
			const content = document.querySelector('.cm-content') as HTMLElement & { cmTile?: { root?: { view?: { state: any } } } };
			const state = content.cmTile?.root?.view?.state;
			return state?.sliceDoc(state.selection.main.from, state.selection.main.to);
		})).toBe(query);
	}
	expect(await page.evaluate(() => (window as any).__forwardedSearchKeys)).toEqual([]);
	for (const character of 'Revised local evidence.') await page.keyboard.type(character, { delay: 3 });
	await expect.poll(() => page.evaluate(() => {
		const content = document.querySelector('.cm-content') as HTMLElement & { cmTile?: { root?: { view?: { state: any } } } };
		return content.cmTile?.root?.view?.state.doc.toString();
	})).toBe(source.replace('DRAFT_SUMMARY', 'Revised local evidence.'));
});

for (const editingMode of ['editing', 'locked'] as const) {
	test(`Select All does not replay through the host while ${editingMode}`, async ({ page }) => {
		const source = '# Original\n\nKeep this whole source selected.\n\n| Item | State |\n| --- | --- |\n| Local | Ready |';
		await mountEditor(page, source, { editingMode });
		await page.evaluate(() => {
			(window as any).__forwardedSelectAll = 0;
			window.addEventListener('keydown', event => {
				if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') (window as any).__forwardedSelectAll++;
			});
		});
		await page.locator('.cm-line').first().click();
		await page.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+a`);
		expect(await page.evaluate(() => (window as any).__forwardedSelectAll)).toBe(0);
		for (const character of 'Complete replacement.') await page.keyboard.type(character, { delay: 3 });
		await expect.poll(() => page.evaluate(() => {
			const content = document.querySelector('.cm-content') as HTMLElement & { cmTile?: { root?: { view?: { state: any } } } };
			return content.cmTile?.root?.view?.state.doc.toString();
		})).toBe(editingMode === 'editing' ? 'Complete replacement.' : source);
	});
}
