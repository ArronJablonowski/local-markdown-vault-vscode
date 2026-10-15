import { expect, test, type Page } from '@playwright/test';
import { mountEditor } from './harness';

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
const source = (page: Page) => page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString());
const initial = '# Meetings\n\n> [!abstract]+ Planning\n> Scope must remain intact.\n>\n> > [!warning]+ Risks\n> > Review deployment.\n> >\n> > - Primary action\n> >     - [ ] Confirm owner\n> >\n> > | Owner | Status |\n> > | --- | --- |\n> > | Alex | Pending |\n> >\n> > ```typescript\n> > const decision = "pilot";\n> > console.log(decision);\n> > ```\n> >\n> > ```mermaid\n> > flowchart LR\n> > A[Plan] --> B[Review]\n> > ```\n> >\n> > $$\n> > x^2 + y^2 = z^2\n> > $$\n> >\n> > Closing risk.\n>\n> Final planning summary.\n\nOutside summary.';

async function find(page: Page, text: string) {
	await page.locator('.cm-content').focus(); await page.keyboard.press(`${mod}+f`);
	await page.locator('.cm-search input[name="search"]').fill(text);
	await page.keyboard.press('Enter'); await page.keyboard.press('Escape');
}

for (const width of [480, 1100]) test(`nested mixed-object callout redraft and independent folding at ${width}px`, async ({ page }, info) => {
	const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
	await page.setViewportSize({ width, height: 1000 });
	await mountEditor(page, initial);
	await expect(page.locator('.mlp-mermaid-wrap svg')).toContainText('Review');
	await expect(page.locator('.mlp-math-block math')).toHaveCount(1);
	await find(page, 'Review deployment.'); await page.keyboard.press('ArrowRight');
	await page.keyboard.press('Shift+Enter');
	for (const char of 'Assign risk owner.') await page.keyboard.type(char);
	let expected = initial.replace('Review deployment.', 'Review deployment.\n> > Assign risk owner.');
	await expect.poll(() => source(page)).toBe(expected);
	await page.locator('.mlp-checkbox').click();
	expected = expected.replace('[ ] Confirm', '[x] Confirm');
	await expect.poll(() => source(page)).toBe(expected);
	await page.locator('.mlp-table td').last().click(); await page.keyboard.press(`${mod}+a`);
	for (const char of 'Reviewed') await page.keyboard.type(char);
	await page.keyboard.press('Backspace'); await page.keyboard.type('d');
	expected = expected.replace('| Alex | Pending |', '| Alex | Reviewed |');
	await expect.poll(() => source(page)).toBe(expected);
	// Folding must commit a live cell without leaking its keys into the header.
	const inner = page.getByRole('button', { name: 'Risks callout', exact: true });
	await inner.click(); await expect(page.locator('.mlp-table')).toHaveCount(0);
	await expect(page.getByText('Final planning summary.', { exact: true })).toBeVisible();
	await inner.click(); await expect(page.locator('.mlp-table td').last()).toHaveText('Reviewed');
	await find(page, 'pilot');
	for (const char of 'release') await page.keyboard.type(char);
	expected = expected.replace('"pilot"', '"release"');
	await expect.poll(() => source(page)).toBe(expected);
	await find(page, 'Outside summary.'); await page.keyboard.press('ArrowRight');
	await expect(page.locator('.mlp-copy-code-btn')).toHaveCount(1);
	await page.locator('.mlp-copy-code-btn').click();
	await expect.poll(() => page.evaluate(() => (window as any).__posted.filter((m: any) => m.type === 'copyCode').at(-1)?.text)).toBe('const decision = "release";\nconsole.log(decision);');
	await inner.click();
	const outer = page.getByRole('button', { name: 'Planning callout', exact: true });
	await outer.click(); await expect(inner).toHaveCount(0);
	await outer.click(); await expect(inner).toHaveAttribute('aria-expanded', 'false');
	await inner.click(); await expect(page.locator('.mlp-mermaid-wrap svg')).toContainText('Review');
	await expect.poll(() => source(page)).toBe(expected);
	await page.screenshot({ path: info.outputPath('nested-redraft.png') });
	expect(errors).toEqual([]);
});

for (const type of ['constructor', '__proto__']) test(`custom callout ${type} renders and remains editable without a parser crash`, async ({ page }) => {
	const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
	const text = `Intro\n\n> [!${type}]+\n> - [ ] Task\n>\n> | A | B |\n> | --- | --- |\n> | One | Two |\n\nOutside.`;
	await mountEditor(page, text);
	await expect(page.locator('.mlp-callout-header')).toBeVisible();
	await page.locator('.mlp-checkbox').click();
	await expect.poll(() => source(page)).toBe(text.replace('[ ]', '[x]'));
	await page.locator('.mlp-callout-header').click(); await expect(page.locator('.mlp-table')).toHaveCount(0);
	await page.locator('.mlp-callout-header').click(); await expect(page.locator('.mlp-table td').last()).toHaveText('Two');
	expect(errors).toEqual([]);
});
