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
});
