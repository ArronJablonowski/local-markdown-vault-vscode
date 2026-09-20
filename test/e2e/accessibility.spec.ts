import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { mountEditor } from './harness';

test.describe('automated accessibility gate', () => {
	test('representative live preview has no critical WCAG violations', async ({ page }) => {
		await mountEditor(page, `---
published: true
priority: 3
tags: [secure, work/active]
related: "[[Related note]]"
references: ["[[First note]]", "[[Second note|Second]]"]
---
# Accessible note

> [!NOTE]- Details
> Keyboard-operable callout.

- [ ] Keyboard task

| name | value |
| --- | ---: |
| alpha | 1 |

[[Related note]]
`, {
			vaultNotes: [{ path: 'Related note.md', basename: 'Related note', aliases: [], headings: [], blockIds: [] }],
		});
		const results = await new AxeBuilder({ page })
			.withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
			.analyze();
		expect(results.violations.filter((violation) => violation.impact === 'critical')).toEqual([]);
	});

	test('controls remain reachable at 200 percent zoom in high contrast mode', async ({ page }) => {
		await mountEditor(page, `---
published: true
---
Intro

- [ ] task

> [!NOTE]- Details
> Keyboard-operable callout.

| a | b |
| --- | --- |
| 1 | 2 |
`);
		await page.evaluate(() => {
			document.body.classList.add('vscode-high-contrast');
			document.documentElement.style.fontSize = '32px';
		});
		const controls = page.locator('button:not([disabled]), input:not([disabled]), [role="checkbox"], [role="button"][tabindex="0"]');
		expect(await controls.count()).toBeGreaterThan(0);
		for (let index = 0; index < await controls.count(); index++) {
			await controls.nth(index).scrollIntoViewIfNeeded();
			await controls.nth(index).focus();
			await expect(controls.nth(index)).toBeFocused();
		}
		const task = page.locator('.mlp-checkbox').first();
		const editor = page.locator('.cm-content');
		await editor.focus();
		await editor.press('Escape');
		await editor.press('Tab');
		for (let index = 0; index < 100 && !await task.evaluate((element) => document.activeElement === element); index++) {
			await page.locator(':focus').press('Tab');
		}
		await expect(task).toBeFocused();
		const taskFocus = await task.evaluate((element) => {
			const style = getComputedStyle(element);
			return { width: Number.parseFloat(style.outlineWidth), style: style.outlineStyle };
		});
		expect(taskFocus.style).not.toBe('none');
		expect(taskFocus.width).toBeGreaterThanOrEqual(2);
		for (const sourceButton of await page.locator('.mlp-code-mode-btn').all()) {
			await sourceButton.scrollIntoViewIfNeeded();
			await expect(sourceButton).toBeVisible();
			await expect(sourceButton).toHaveAccessibleName(/source|code mode/i);
		}
		const results = await new AxeBuilder({ page })
			.withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
			.analyze();
		expect(results.violations.filter((violation) => violation.impact === 'critical')).toEqual([]);
	});
});
