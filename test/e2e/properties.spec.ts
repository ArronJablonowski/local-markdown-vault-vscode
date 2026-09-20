import { expect, test } from '@playwright/test';
import { mountEditor } from './harness';

test('renders bounded YAML frontmatter as typed properties', async ({ page }) => {
	await mountEditor(page, `---
published: true
priority: 3
due: 2026-09-19
updated: 2026-09-19T18:00:00Z
related: "[[Project|Project alias]]"
references: ["[[Alpha]]", "[[Beta|B]]"]
milestones: [1, 2]
tags: [work, secure]
---
# Note
`);
	const properties = page.locator('.mlp-frontmatter');
	await expect(properties.locator('.mlp-property-boolean input')).toBeChecked();
	await expect(properties.locator('.mlp-property-number')).toHaveText('3');
	await expect(properties.locator('.mlp-property-date time')).toHaveAttribute('datetime', '2026-09-19');
	await expect(properties.locator('.mlp-property-datetime time')).toHaveAttribute('datetime', '2026-09-19T18:00:00Z');
	const relatedRow = page.locator('.mlp-frontmatter tr', { hasText: 'related' });
	const related = relatedRow.locator('.mlp-property-link');
	await expect(related).toHaveText('Project alias');
	await expect(related).toHaveAttribute('role', 'link');
	await expect(related).toHaveAttribute('tabindex', '0');
	await expect(related).toHaveAttribute('data-href', 'wikilink:Project%7CProject%20alias');
	const referencesRow = page.locator('.mlp-frontmatter tr', { hasText: 'references' });
	await expect(referencesRow.locator('.mlp-property-link')).toHaveCount(2);
	await expect(referencesRow.locator('.mlp-property-link').nth(1)).toHaveText('B');
	await expect(referencesRow.locator('.mlp-property-link').nth(1)).toHaveAttribute('data-href', 'wikilink:Beta%7CB');
	await expect(properties.locator('.mlp-property-tag')).toHaveCount(2);

	await page.evaluate(() => {
		(window as unknown as { __posted: unknown[] }).__posted = [];
	});
	await related.focus();
	await page.keyboard.press('Enter');
	await expect.poll(() => page.evaluate(() =>
		(window as unknown as { __posted: Array<{ type: string; href?: string }> }).__posted,
	)).toContainEqual({ type: 'openLink', href: 'wikilink:Project%7CProject%20alias' });

	await relatedRow.locator('.mlp-property-edit').click();
	await relatedRow.locator('input').fill('[[Other]]');
	await relatedRow.locator('input').press('Enter');
	await expect(page.locator('.mlp-frontmatter tr', { hasText: 'related' }).locator('.mlp-property-link')).toHaveText('Other');

	await referencesRow.locator('.mlp-property-edit').click();
	await referencesRow.locator('input').fill('[[Gamma|Q1, launch]], [[Delta|D]]');
	await referencesRow.locator('input').press('Enter');
	const updatedReferences = page.locator('.mlp-frontmatter tr', { hasText: 'references' }).locator('.mlp-property-link');
	await expect(updatedReferences).toHaveCount(2);
	await expect(updatedReferences.first()).toHaveText('Q1, launch');
	await expect(updatedReferences.nth(1)).toHaveText('D');

	const milestonesRow = page.locator('.mlp-frontmatter tr', { hasText: 'milestones' });
	await milestonesRow.locator('td').focus();
	await page.keyboard.press('Enter');
	await milestonesRow.locator('input').fill('1, nope');
	await milestonesRow.locator('input').press('Enter');
	await expect(milestonesRow.locator('input')).toHaveAttribute('aria-invalid', 'true');
	await milestonesRow.locator('input').fill('1, 2, 3');
	await milestonesRow.locator('input').press('Enter');
	await expect(page.locator('.mlp-frontmatter tr', { hasText: 'milestones' }).locator('.mlp-property-chip')).toHaveCount(3);

	const published = properties.locator('.mlp-property-boolean input');
	await published.click();
	await expect(page.locator('.mlp-frontmatter .mlp-property-boolean input')).not.toBeChecked();

	const priority = page.locator('.mlp-frontmatter tr', { hasText: 'priority' }).locator('td');
	await priority.focus();
	await page.keyboard.press('Enter');
	await priority.locator('input').fill('not a number');
	await priority.locator('input').press('Enter');
	await expect(priority.locator('input')).toHaveAttribute('aria-invalid', 'true');
	const describedBy = await priority.locator('input').getAttribute('aria-describedby');
	expect(describedBy).toMatch(/^mlp-property-error-/);
	await expect(priority.locator(`#${describedBy}`)).toHaveText('Enter a valid number.');
	await priority.locator('input').fill('7');
	await expect(priority.locator('input')).not.toHaveAttribute('aria-invalid');
	await priority.locator('input').press('Enter');
	await expect(page.locator('.mlp-frontmatter tr', { hasText: 'priority' }).locator('td')).toHaveText('7');

	const tags = page.locator('.mlp-frontmatter tr', { hasText: 'tags' }).locator('td');
	await tags.focus();
	await page.keyboard.press('F2');
	await tags.locator('input').fill('#work/active, secure, added');
	await tags.locator('input').press('Enter');
	await expect(page.locator('.mlp-property-tag')).toHaveCount(3);
	await expect(page.locator('.mlp-property-tag').last()).toHaveText('#added');
});

test('emits normalized offsets when editing a CRLF property block', async ({ page }) => {
	const source = '---\r\npublished: true\r\n---\r\n# Note\r\n';
	await mountEditor(page, source);
	const checkbox = page.locator('.mlp-frontmatter .mlp-property-boolean input');
	await expect(checkbox).toBeChecked();
	await checkbox.click();

	await expect.poll(() => page.evaluate(() =>
		(window as unknown as { __posted: Array<{ type: string; changes?: Array<{ from: number; to: number; insert: string }> }> })
			.__posted.find((message) => message.type === 'edit'),
	)).not.toBeUndefined();
	const message = await page.evaluate(() =>
		(window as unknown as { __posted: Array<{ type: string; changes?: Array<{ from: number; to: number; insert: string }> }> })
			.__posted.find((candidate) => candidate.type === 'edit'));
	expect(message?.changes).toEqual([{
		from: 0,
		to: source.replace(/\r\n/g, '\n').indexOf('\n# Note'),
		insert: '---\npublished: false\n---',
	}]);
});
