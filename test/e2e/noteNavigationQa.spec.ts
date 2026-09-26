import { expect, test, type Page } from '@playwright/test';
import { mountEditor, openSearch, postToWebview } from './harness';

type Edit = { type: string; changes?: Array<{ from: number; to: number; insert: string }> };
const errors = new Map<Page, string[]>();
test.beforeEach(({ page }) => {
	const found: string[] = [];
	errors.set(page, found);
	page.on('pageerror', error => found.push(error.message));
});
test.afterEach(({ page }) => { expect(errors.get(page)).toEqual([]); errors.delete(page); });

async function source(page: Page, original: string): Promise<string> {
	return page.evaluate(initial => {
		let text = initial;
		for (const message of (window as unknown as { __posted: Edit[] }).__posted) {
			if (message.type === 'edit') for (const change of [...message.changes!].reverse()) {
				text = text.slice(0, change.from) + change.insert + text.slice(change.to);
			}
		}
		return text;
	}, original);
}

for (const command of ['Enter', 'next', 'prev'] as const) {
	test(`regular-expression ${command} reveals a matching table cell for review`, async ({ page }) => {
		const original = '# Inventory\n\nIntro\n\n| Item | Identifier |\n| --- | --- |\n| Adapter | asset-418 |\n\nClosing note';
		await mountEditor(page, original);
		await expect(page.locator('.mlp-table')).toHaveCount(1);
		await openSearch(page);
		await page.locator('.cm-search input[name="search"]').fill('asset-\\d+');
		await page.locator('.cm-search label').filter({ has: page.locator('input[name="re"]') }).click();
		if (command === 'Enter') await page.locator('.cm-search input[name="search"]').press('Enter');
		else await page.locator(`.cm-search button[name="${command}"]`).click();
		await expect(page.locator('.cm-line').filter({ hasText: '| Adapter | asset-418 |' })).toBeVisible();
		// The panel intentionally retains focus. Return to the editor without
		// changing its selection before checking the native selected text.
		await page.locator('.cm-content').focus();
		await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('asset-418');
		expect(await source(page, original)).toBe(original);
	});
}

test('typing a report then replacing case-sensitive whole words changes only the intended occurrences', async ({ page }) => {
	await mountEditor(page, '');
	await page.locator('.cm-content').click();
	await page.keyboard.type('# Lab report', { delay: 2 });
	await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
	await page.keyboard.type('Run RUN running.');
	await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
	await page.keyboard.type('- Run diagnostics');
	await page.keyboard.press('Enter');
	await page.keyboard.type('Run final checks');
	await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
	await page.keyboard.type('Done.');
	await expect.poll(() => source(page, '')).toContain('Done.');
	const typed = await source(page, '');
	await openSearch(page);
	await page.locator('.cm-search input[name="search"]').pressSequentially('Run', { delay: 5 });
	for (const option of ['case', 'word']) {
		await page.locator('.cm-search label').filter({ has: page.locator(`input[name="${option}"]`) }).click();
	}
	await page.locator('.mlp-search-toggle').click();
	await page.locator('.cm-search input[name="replace"]').pressSequentially('Execute', { delay: 5 });
	await page.locator('.cm-search button[name="replaceAll"]').click();
	await expect.poll(() => source(page, '')).toBe(typed.replaceAll('Run', 'Execute'));
	await page.locator('.cm-search button[name="close"]').click();
	await expect(page.locator('.cm-content')).toContainText('Execute RUN running.');
	await expect(page.locator('.cm-search')).toHaveCount(0);
});

test('a regex capture replacement in table source preserves its surrounding note and renders the update', async ({ page }) => {
	const original = 'Before\n\n| Asset | Code |\n| --- | --- |\n| A | REF-304 |\n| B | REF-527 |\n\nAfter';
	await mountEditor(page, original);
	await openSearch(page);
	await page.locator('.cm-search input[name="search"]').fill('REF-(\\d+)');
	await page.locator('.cm-search label').filter({ has: page.locator('input[name="re"]') }).click();
	await page.locator('.mlp-search-toggle').click();
	await page.locator('.cm-search input[name="replace"]').fill('LOC-$1');
	await page.locator('.cm-search button[name="replaceAll"]').click();
	await expect.poll(() => source(page, original)).toBe(original.replaceAll('REF-', 'LOC-'));
	await page.locator('.cm-search button[name="close"]').click();
	await page.locator('.cm-line').filter({ hasText: /^After$/ }).click();
	await expect(page.locator('.mlp-table td')).toHaveText(['A', 'LOC-304', 'B', 'LOC-527']);
});

test('emoji navigation accepts a later suggestion with keyboard and does not complete inside a code fence', async ({ page }) => {
	await mountEditor(page, '');
	await page.locator('.cm-content').click();
	await page.keyboard.type('Status: :s', { delay: 10 });
	await expect(page.getByRole('option', { name: /:smile:/ })).toBeVisible();
	await page.waitForTimeout(100);
	await page.keyboard.press('ArrowDown');
	const chosen = await page.locator('[role="option"][aria-selected="true"] .cm-completionDetail').textContent();
	await page.keyboard.press('Enter');
	await expect.poll(() => source(page, '')).toBe('Status: ' + chosen);
	await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
	await page.keyboard.type('```text'); await page.keyboard.press('Enter');
	await page.keyboard.type(':smile', { delay: 25 });
	await expect(page.getByRole('option')).toHaveCount(0);
	expect(await source(page, '')).toContain(':smile');
});

test('a Mermaid source edit updates the diagram and leaves neighboring task edits intact', async ({ page }) => {
	const original = '# Workflow\n\n- [ ] Verify diagram\n\n```mermaid\nflowchart LR\nA[Plan] --> B[Build]\n```\n\nAfter';
	await mountEditor(page, original);
	await expect(page.locator('.mlp-mermaid-wrap svg')).toBeVisible({ timeout: 15000 });
	await page.locator('.mlp-checkbox').click();
	await page.locator('.mlp-mermaid-wrap .mlp-code-mode-btn').click();
	const line = page.locator('.cm-line').filter({ hasText: /^A\[Plan\] --> B\[Build\]$/ });
	await line.click();
	await page.keyboard.press('Home'); await page.keyboard.press('Shift+End');
	await page.keyboard.type('A[Plan] --> B[Verify]', { delay: 5 });
	await page.locator('.cm-line').filter({ hasText: /^After$/ }).click();
	await expect(page.locator('.mlp-mermaid-wrap svg')).toContainText('Verify');
	await expect.poll(() => source(page, original)).toBe(original.replace('[ ]', '[x]').replace('B[Build]', 'B[Verify]'));
	await page.getByRole('button', { name: 'Editing: select to lock the editor', exact: true }).click();
	await page.locator('.mlp-mermaid-wrap').getByRole('button', { name: 'Switch to actual size (drag to pan, Ctrl+wheel to zoom)', exact: true }).click();
	await page.locator('.mlp-mermaid-wrap').getByRole('button', { name: 'Zoom in (Ctrl+wheel also works)', exact: true }).click();
	await page.locator('.mlp-mermaid-wrap').getByRole('button', { name: 'Reset the view (fit to width)', exact: true }).click();
	await expect(page.locator('.mlp-mermaid-wrap svg')).toContainText('Verify');
	expect(await source(page, original)).toBe(original.replace('[ ]', '[x]').replace('B[Build]', 'B[Verify]'));
});

test('search remains usable after an invalid regular expression and a presentation setting change', async ({ page }) => {
	const original = 'Before\n\nA citation[^src].\n\n[^src]: Local source 721.\n\nAfter';
	await mountEditor(page, original);
	await openSearch(page);
	await page.locator('.cm-search label').filter({ has: page.locator('input[name="re"]') }).click();
	await page.locator('.cm-search input[name="search"]').fill('[');
	await page.locator('.cm-search input[name="search"]').press('Enter');
	await postToWebview(page, { type: 'setStickyTableHeaders', enabled: true });
	await page.locator('.cm-search input[name="search"]').fill('source \\d+');
	await page.locator('.cm-search input[name="search"]').press('Enter');
	await expect(page.locator('.cm-line').filter({ hasText: 'Local source 721.' })).toBeVisible();
	await page.locator('.cm-content').focus();
	await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('source 721');
	expect(await source(page, original)).toBe(original);
});

test('typing bracketed strings inside fenced code does not offer note completions', async ({ page }) => {
	const original = '# Reference\n\n```python\n\n```\n\nAfter';
	await mountEditor(page, original, { vaultNotes: [{ path: 'Array.md', basename: 'Array', aliases: [], headings: [], blockIds: [] }] });
	await page.locator('.cm-content').click();
	await page.keyboard.press('ControlOrMeta+Home');
	for (let index = 0; index < 3; index++) await page.keyboard.press('ArrowDown');
	await page.keyboard.type('data = [[Ar', { delay: 40 });
	// Wait beyond the completion activation delay so absence is meaningful.
	await page.waitForTimeout(250);
	await expect(page.getByRole('option')).toHaveCount(0);
	await expect.poll(() => source(page, original)).toContain('data = [[Ar');
});

test('auto-paired wiki embed brackets still offer and accept the selected note', async ({ page }) => {
	await mountEditor(page, '', { vaultNotes: [{ path: 'Array.md', basename: 'Array', aliases: [], headings: [], blockIds: [] }] });
	await page.locator('.cm-content').click();
	await page.keyboard.type('See ![[Ar', { delay: 20 });
	await page.getByRole('option', { name: /Array/ }).click();
	await expect.poll(() => source(page, '')).toBe('See ![[Array]]');
});

test('finding text inside a collapsed callout reveals the match without changing saved Markdown', async ({ page }) => {
	const original = 'Before\n\n> [!note]- Archive\n> Token stored: pending-841.\n\nAfter';
	await mountEditor(page, original);
	await expect(page.getByRole('button', { name: 'Archive callout', exact: true })).toHaveAttribute('aria-expanded', 'false');
	await openSearch(page);
	await page.locator('.cm-search input[name="search"]').fill('pending-841');
	await page.locator('.cm-search input[name="search"]').press('Enter');
	await expect(page.locator('.cm-line').filter({ hasText: 'Token stored: pending-841.' })).toBeVisible();
	expect(await source(page, original)).toBe(original);
	await page.locator('.cm-search button[name="close"]').click();
	await page.locator('.cm-line').filter({ hasText: /^After$/ }).click();
	await expect(page.getByRole('button', { name: 'Archive callout', exact: true })).toHaveAttribute('aria-expanded', 'true');
	await page.getByRole('button', { name: 'Archive callout', exact: true }).click();
	await expect(page.locator('.cm-line').filter({ hasText: 'Token stored: pending-841.' })).toHaveCount(0);
	expect(await source(page, original)).toBe(original);
});

test('Find All opens nested callouts and table matches while leaving unrelated folded content closed', async ({ page }) => {
	const original = 'Before\n\n> [!note]- Outer\n> > [!tip]- Inner\n> > Code: item-732\n\n| Asset | Code |\n| --- | --- |\n| Adapter | item-519 |\n\n> [!warning]- Unrelated\n> Keep this section folded.\n\nAfter';
	await mountEditor(page, original);
	await openSearch(page);
	await page.locator('.cm-search input[name="search"]').fill('item-\\d+');
	await page.locator('.cm-search label').filter({ has: page.locator('input[name="re"]') }).click();
	await page.locator('.cm-search button[name="select"]').click();
	await expect(page.locator('.cm-line').filter({ hasText: 'Code: item-732' })).toBeVisible();
	await expect(page.locator('.cm-line').filter({ hasText: '| Adapter | item-519 |' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Unrelated callout', exact: true })).toHaveAttribute('aria-expanded', 'false');
	expect(await source(page, original)).toBe(original);
});
