import { expect, test } from '@playwright/test';
import { mountEditor } from './harness';

test.describe('local math rendering', () => {
	test('price ranges remain readable alongside real math', async ({ page }) => {
		await mountEditor(page, 'Intro\n\n- Rack: approximately $75–$85\n- Total: approximately $177–$187\n- Shelves: $34 each; $102 total\n\nPrice $75-$85; formula $x^2$ and $2+2=4$.\n');
		await expect(page.locator('.mlp-math-error')).toHaveCount(0);
		await expect(page.locator('.cm-content')).toContainText('$75–$85');
		await expect(page.locator('.cm-content')).toContainText('$177–$187');
		await expect(page.locator('.cm-content')).toContainText('$34 each; $102 total');
		await expect(page.locator('.cm-content')).toContainText('$75-$85');
		await expect(page.locator('.mlp-math-inline math')).toHaveCount(2);
	});
	test('renders inline and block math as generated MathML', async ({ page }) => {
		await mountEditor(page, 'Intro\n\nEnergy $E = mc^2$.\n\n$$\n\\int_0^1 x dx\n$$\n');
		await expect(page.locator('.mlp-math-inline math')).toHaveCount(1);
		await expect(page.locator('.mlp-math-block math')).toHaveCount(1);
		await expect(page.locator('.mlp-math-block')).toContainText('∫');
	});

	test('keeps unsafe or invalid commands inert', async ({ page }) => {
		await mountEditor(page, 'Intro\n\n$\\href{javascript:alert(1)}{click}$\n');
		await expect(page.locator('.mlp-math math')).toHaveCount(1);
		await expect(page.locator('.mlp-math script, .mlp-math a[href], .mlp-math [onclick]')).toHaveCount(0);
	});

	test('large-note boundary edits preserve literal object content and rendered body math', async ({ page }, info) => {
		const errors: string[] = [];
		page.on('pageerror', error => errors.push(error.message));
		const original = 'Retained paragraph with **formatting**.\n\n'.repeat(1600)
			+ '    $code_literal$\n\n| Formula |\n| --- |\n| $table_literal$ |\n\n'
			+ '> [!note]- Hidden formula\n> $hidden_literal$\n\nVisible $y^2$ math.\n\nBoundary prose';
		await page.setViewportSize({ width: 1100, height: 1200 });
		await mountEditor(page, original);
		await page.locator('.cm-content').focus();
		await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End');
		await expect(page.locator('.mlp-math-inline math')).toHaveCount(1);
		await expect(page.locator('.mlp-math-inline')).toContainText('y');
		await expect(page.locator('.mlp-line-code')).toContainText('$code_literal$');
		await expect(page.locator('.mlp-table td')).toHaveText('$table_literal$');
		await expect(page.locator('.mlp-math-error')).toHaveCount(0);
		await page.locator('.cm-line', { hasText: 'Boundary prose' }).click();
		await page.keyboard.press('End');
		for (const character of ' revised') await page.keyboard.type(character);
		for (let index = 0; index < ' revised'.length; index++) await page.keyboard.press('Backspace');
		const source = await page.locator('.cm-content').evaluate(element => (element as any).cmTile.root.view.state.doc.toString());
		expect(source).toBe(original);
		await expect(page.locator('.mlp-math-inline math')).toHaveCount(1);
		await page.screenshot({ path: info.outputPath('large-note-math-boundaries.png') });
		expect(errors).toEqual([]);
	});
});
