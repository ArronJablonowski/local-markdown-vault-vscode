import { expect, test } from '@playwright/test';
import { mountEditor } from './harness';

for (const prefix of ['', '> ', '> > ']) for (const language of ['javascript', 'typescript', 'python', 'text']) {
	test(`closing backticks are literal in ${language}, prefix=${JSON.stringify(prefix)}`, async ({ page }) => {
		const original = 'Before\n\n' + (prefix ? prefix + '[!note]+ Meeting\n' : '') + prefix + '```' + language + '\n' + prefix + 'const retained = true;\n' + prefix;
		await mountEditor(page, original);
		await page.locator('.cm-content').evaluate((el: any) => { const view = el.cmTile.root.view; view.dispatch({ selection: { anchor: view.state.doc.length } }); view.focus(); });
		await page.keyboard.type('```', { delay: 20 });
		await expect.poll(() => page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString())).toBe(original + '```');
	});
}

for (const prefix of ['> ', '> > ']) for (const language of ['js', 'typescript', 'text']) {
	test(`opening a quoted ${language} fence does not leave an inline closing tick, prefix=${JSON.stringify(prefix)}`, async ({ page }) => {
		const original = 'Before\n\n' + prefix + '[!note]+ Meeting\n' + prefix;
		await mountEditor(page, original);
		await page.locator('.cm-content').evaluate((el: any) => { const view = el.cmTile.root.view; view.dispatch({ selection: { anchor: view.state.doc.length } }); view.focus(); });
		await page.keyboard.type('```' + language, { delay: 20 });
		await expect.poll(() => page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString())).toBe(original + '```' + language);
	});
}
