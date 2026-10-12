import { expect, test } from '@playwright/test';
import { mountEditor } from './harness';

for (const prefix of ['> ', '>', '  > ', '- > ', '1. > ']) {
	test(`callout continuation renders its complete panel for ${JSON.stringify(prefix)}`, async ({ page }) => {
		const initial = `${prefix}[!warning]+ Review\n${prefix.startsWith('-') || prefix.startsWith('1.') ? '   > ' : prefix}First risk.`;
		await mountEditor(page, initial);
		await page.locator('.cm-content').focus();
		await page.keyboard.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End');
		await page.keyboard.press('Enter');
		await page.keyboard.type('Second risk needs an owner.', { delay: 15 });
		await page.keyboard.press('Shift+Enter');
		await page.keyboard.press('Shift+Enter');
		await page.keyboard.type('Third risk changes the scope.', { delay: 15 });
		await page.keyboard.press('Enter');
		await page.keyboard.press('Enter');
		await page.keyboard.type('Outside follow-up.', { delay: 15 });
		await expect(page.getByRole('button', { name: 'Review callout', exact: true })).toBeVisible();
		for (const body of ['First risk.', 'Second risk needs an owner.', 'Third risk changes the scope.']) {
			await expect(page.locator('.cm-line', { hasText: body })).toHaveClass(/mlp-line-callout/);
		}
		await expect(page.locator('.cm-line', { hasText: 'Outside follow-up.' })).not.toHaveClass(/mlp-line-callout/);
	});
}

for (const prefix of ['- > ', '1. > ', '123456789. > ', '  > ']) test(`clicking a rendered ${prefix}callout body edits that body instead of the header`, async ({ page }) => {
	const initial = `${prefix}[!warning]+ Review\n${' '.repeat(prefix.indexOf('>'))}> First risk.\n\nOutside.`;
	await mountEditor(page, initial);
	await page.locator('.cm-content').focus();
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End');
	await expect(page.getByRole('button', { name: 'Review callout', exact: true })).toBeVisible();
	await page.locator('.cm-line', { hasText: 'First risk.' }).click();
	await page.keyboard.press('End');
	await page.keyboard.type(' Revised.', { delay: 20 });
	await expect.poll(() => page.locator('.cm-content').evaluate(el => (el as any).cmTile.root.view.state.doc.toString()))
		.toBe(initial.replace('First risk.', 'First risk. Revised.'));
});

test('a lazy continuation paragraph keeps new Enter lines inside its callout', async ({ page }) => {
	const initial = '> [!warning]+ Review\n> First risk.\nLazy continuation';
	await mountEditor(page, initial);
	await page.locator('.cm-content').focus();
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End');
	await page.keyboard.press('Enter');
	await page.keyboard.type('Next risk.', { delay: 15 });
	await expect.poll(() => page.locator('.cm-content').evaluate(el => (el as any).cmTile.root.view.state.doc.toString()))
		.toBe(initial + '\n> Next risk.');
});

test('a callout nested through a quoted list keeps its title and body editable', async ({ page }) => {
	const initial = '> [!note]+ Outer\n> - > [!warning]+ Child\n>   > Body risk.\n\nOutside.';
	await mountEditor(page, initial);
	await page.locator('.cm-content').focus();
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End');
	await expect(page.getByRole('button', { name: 'Child callout', exact: true })).toBeVisible();
	await page.locator('.cm-line', { hasText: 'Body risk.' }).click();
	await page.keyboard.press('End');
	await page.keyboard.type(' Revised.', { delay: 15 });
	await expect.poll(() => page.locator('.cm-content').evaluate(el => (el as any).cmTile.root.view.state.doc.toString()))
		.toBe(initial.replace('Body risk.', 'Body risk. Revised.'));
});

test('narrow callout titles and mixed objects remain within the panel', async ({ page }, info) => {
	await page.setViewportSize({ width: 480, height: 1000 });
	const title = 'ReviewWithoutSpaces'.repeat(8);
	const initial = `# Visual QA\n\n- > [!warning]+ ${title}\n  > A wrapped body paragraph with **important decisions** and additional explanatory text for the next meeting.\n  >\n  > | Owner | Status |\n  > | --- | --- |\n  > | Alex | Review |\n  >\n  > \`\`\`javascript\n  > const next = "pilot";\n  > \`\`\`\n\nOutside.`;
	await mountEditor(page, initial);
	await page.locator('.cm-content').focus();
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End');
	const header = page.getByRole('button', { name: `${title} callout`, exact: true });
	await expect(header).toBeVisible();
	const bounds = await header.evaluate(el => {
		const h = el.getBoundingClientRect();
		const t = el.querySelector('.mlp-callout-title')!.getBoundingClientRect();
		return { headerRight: h.right, titleRight: t.right };
	});
	expect(bounds.titleRight).toBeLessThanOrEqual(bounds.headerRight + 1);
	await expect(page.locator('.mlp-table')).toBeVisible();
	await page.screenshot({ path: info.outputPath('narrow-mixed-callout.png') });
});
