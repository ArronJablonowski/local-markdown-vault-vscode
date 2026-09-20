import { expect, test } from '@playwright/test';
import { mountEditor } from './harness';

test.describe('local math rendering', () => {
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
