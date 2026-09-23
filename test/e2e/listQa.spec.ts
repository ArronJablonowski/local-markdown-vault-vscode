import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mountEditor } from './harness';

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
async function source(page: Page): Promise<string> {
	await page.locator('.cm-content').focus();
	await page.keyboard.press(`${mod}+a`);
	return page.evaluate(() => {
		const data = new DataTransfer();
		document.querySelector('.cm-content')!.dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: data }));
		return data.getData('text/plain');
	});
}

for (const theme of ['', 'obsidian-dark.css', 'github-like.css']) {
	for (const editingMode of ['editing', 'locked'] as const) {
		test(`tight nested list spacing and alignment, ${theme || 'default'}, ${editingMode}`, async ({ page }, info) => {
			await mountEditor(page, 'Intro\n\n## Heading\n- Parent\n  - Child\n    - Grandchild\n  - Next child\n- Sibling\n\nAfter', {
				css: theme ? readFileSync(join(__dirname, '../../media/sample-styles', theme), 'utf8') : '', editingMode,
			});
			const rows = page.locator('.cm-line.mlp-line-list');
			await expect(rows).toHaveCount(5);
			const metrics = await rows.evaluateAll(lines => lines.map(el => ({
				top: el.getBoundingClientRect().top, height: el.getBoundingClientRect().height,
				paddingTop: parseFloat(getComputedStyle(el).paddingTop), paddingBottom: parseFloat(getComputedStyle(el).paddingBottom),
				bullet: el.querySelector('.mlp-bullet')!.getBoundingClientRect().left,
				bulletWidth: el.querySelector('.mlp-bullet')!.getBoundingClientRect().width,
			})));
			for (const row of metrics.slice(0, -1)) expect(row.paddingBottom).toBe(0);
			for (const row of metrics.slice(1)) expect(row.paddingTop).toBe(0);
			expect(metrics[0].bullet).toBeCloseTo(metrics[4].bullet, 0);
			expect(metrics[1].bullet).toBeCloseTo(metrics[3].bullet, 0);
			expect(metrics[2].bullet - metrics[1].bullet).toBeGreaterThanOrEqual(14);
			expect(metrics[1].bullet - metrics[0].bullet).toBeGreaterThanOrEqual(14);
			for (const row of metrics) expect(row.bulletWidth).toBeCloseTo(metrics[0].bulletWidth, 1);
			await page.screenshot({ path: info.outputPath('nested-list.png') });
		});
	}
}

for (const marker of ['-', '*', '+', '- [ ]']) {
	test(`Tab and Shift+Tab nest and restore ${marker} bullets`, async ({ page }) => {
		const initial = `${marker} Parent\n${marker} Child\n\nAfter`;
		await mountEditor(page, initial);
		await page.locator('.cm-line', { hasText: 'Child' }).click();
		await page.keyboard.press('Tab');
		expect(await source(page)).toBe(`${marker} Parent\n  ${marker} Child\n\nAfter`);
		await page.locator('.cm-line', { hasText: 'Child' }).click();
		await page.keyboard.press('Shift+Tab');
		expect(await source(page)).toBe(initial);
	});
}

test('an empty new bullet nests and outdents without inserting extra blank lines', async ({ page }) => {
	await mountEditor(page, '# Heading\n- Parent');
	await page.locator('.cm-line', { hasText: 'Parent' }).click();
	await page.keyboard.press('End');
	await page.keyboard.press('Enter');
	await page.keyboard.press('Tab');
	await page.keyboard.type('Child');
	await page.keyboard.press('Enter');
	await page.keyboard.press('Shift+Tab');
	await page.keyboard.type('Sibling');
	expect(await source(page)).toBe('# Heading\n- Parent\n  - Child\n- Sibling');
});

for (const level of [1, 2, 3, 4, 5, 6]) {
	for (const blank of ['', '\n']) {
		test(`heading ${level} keeps compact spacing before a list (${blank ? 'one blank' : 'no blank'})`, async ({ page }) => {
			await mountEditor(page, `Intro\n\n${'#'.repeat(level)} Heading\n${blank}- Parent\n  - Child\n\nAfter`, {
				css: readFileSync(join(__dirname, '../../media/sample-styles/obsidian-dark.css'), 'utf8'),
			});
			const heading = page.locator(`.mlp-line-h${level}`);
			const padding = await heading.evaluate(el => parseFloat(getComputedStyle(el).paddingBottom) / parseFloat(getComputedStyle(el).fontSize));
			expect(padding).toBeLessThanOrEqual(0.13);
			const gap = await page.evaluate(() => {
				const heading = document.querySelector('.mlp-heading-before-list')!;
				return document.querySelector('.mlp-line-list')!.getBoundingClientRect().top - heading.getBoundingClientRect().bottom;
			});
			expect(gap).toBeLessThanOrEqual(blank ? 30 : 1);
		});
	}
}

test('Shift+Tab at the root leaves the bullet and neighboring paragraph unchanged', async ({ page }) => {
	const initial = 'Intro\n\n- Parent\n- Sibling\n\nAfter';
	await mountEditor(page, initial);
	await page.locator('.cm-line', { hasText: 'Parent' }).click();
	await page.keyboard.press('Shift+Tab');
	expect(await source(page)).toBe(initial);
});

test('selected sibling bullets indent and outdent together', async ({ page }) => {
	const initial = '- Parent\n- One\n- Two';
	await mountEditor(page, initial);
	await page.locator('.cm-line', { hasText: 'One' }).click();
	await page.keyboard.press('Home');
	await page.keyboard.press('Shift+ArrowDown');
	await page.keyboard.press('Shift+End');
	await page.keyboard.press('Tab');
	await expect(page.locator('.cm-line').nth(1)).toContainText('  - One');
	await expect(page.locator('.cm-line').nth(2)).toContainText('  - Two');
	await page.keyboard.press('Shift+Tab');
	expect(await source(page)).toBe(initial);
});

test('Tab cannot modify a locked list', async ({ page }) => {
	const initial = '# Heading\n- Parent\n  - Child';
	await mountEditor(page, initial, { editingMode: 'locked' });
	await page.locator('.cm-line', { hasText: 'Child' }).click();
	await page.keyboard.press('Tab');
	await page.keyboard.press('Shift+Tab');
	expect(await source(page)).toBe(initial);
});

test('photo regression: table, heading, three bullet levels, and a new empty bullet', async ({ page }, info) => {
	const initial = '| Priority | Name |\n| --- | --- |\n| Medium | Example |\n\n## This is a heading\n- This is a bullet\n  - This is a sub-bullet\n    - Third level';
	await mountEditor(page, initial, { css: readFileSync(join(__dirname, '../../media/sample-styles/obsidian-dark.css'), 'utf8') });
	await page.locator('.cm-line', { hasText: 'Third level' }).click();
	await page.keyboard.press('End');
	await page.keyboard.press('Enter');
	await page.keyboard.press('Shift+Tab');
	await page.keyboard.type('Second-level sibling');
	await page.locator('.cm-line', { hasText: 'This is a heading' }).click();
	const positions = await page.locator('.mlp-bullet').evaluateAll(nodes => nodes.map(el => el.getBoundingClientRect().left));
	expect(positions[1]).toBeCloseTo(positions[3], 1);
	await page.screenshot({ path: info.outputPath('photo-regression.png') });
	expect(await source(page)).toBe(initial + '\n  - Second-level sibling');
});

test('loose lists preserve intentional source blank lines and four-space indentation', async ({ page }) => {
	const initial = 'Intro\n\n- Parent\n\n    - Child\n\n    - Sibling\n\n- Final';
	await mountEditor(page, initial);
	await expect(page.locator('.mlp-bullet-2')).toHaveCount(2);
	expect(await source(page)).toBe(initial);
});
