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
			await controls.nth(index).focus();
			await expect(controls.nth(index)).toBeFocused();
		}
		const results = await new AxeBuilder({ page })
			.withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
			.analyze();
		expect(results.violations.filter((violation) => violation.impact === 'critical')).toEqual([]);
	});
});
