import { expect, test, type Page } from '@playwright/test';
import { mountEditor } from './harness';

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

async function sourceAfterEdits(page: Page, original: string): Promise<string> {
	return page.evaluate(initial => {
		let text = initial;
		for (const message of (window as any).__posted) {
			if (message.type === 'edit') for (const change of [...message.changes].reverse()) {
				text = text.slice(0, change.from) + change.insert + text.slice(change.to);
			}
		}
		return text;
	}, original);
}

test.beforeEach(({ page }) => {
	page.on('pageerror', error => { throw error; });
});

test('property editing can be canceled repeatedly before a later accepted value', async ({ page }) => {
	const original = '---\nrelated: "[[Before]]"\npriority: 3\n---\n\nBody';
	await mountEditor(page, original);
	for (const value of ['[[Discarded]]', '[[Other|Discarded alias]]']) {
		await page.getByRole('button', { name: 'Edit related', exact: true }).click();
		await page.getByRole('textbox', { name: 'Edit related', exact: true }).fill(value);
		await page.keyboard.press('Escape');
		await expect(page.locator('.mlp-property-link')).toHaveText('Before');
		await expect(page.getByRole('button', { name: 'Edit related', exact: true })).toBeFocused();
	}
	expect(await sourceAfterEdits(page, original)).toBe(original);
	await page.getByRole('button', { name: 'Edit related', exact: true }).press('Enter');
	await page.getByRole('textbox', { name: 'Edit related', exact: true }).fill('[[After|Saved]]');
	await page.keyboard.press('Enter');
	await expect(page.locator('.mlp-property-link')).toHaveText('Saved');
	await expect.poll(() => sourceAfterEdits(page, original)).toContain('[[After|Saved]]');
});

test('clicking another property while typing saves the first without swallowing the next edit', async ({ page }) => {
	const original = '---\nowner: Morgan\nstatus: Draft\n---\n\nBody';
	await mountEditor(page, original);
	await page.getByRole('button', { name: 'Edit owner', exact: true }).dblclick();
	await page.getByRole('textbox', { name: 'Edit owner', exact: true }).fill('Casey');
	await page.getByRole('button', { name: 'Edit status', exact: true }).dblclick();
	await expect(page.getByRole('textbox', { name: 'Edit status', exact: true })).toBeFocused();
	await page.keyboard.type('Reviewed');
	await page.keyboard.press('Enter');
	await expect.poll(() => sourceAfterEdits(page, original)).toBe(original.replace('Morgan', 'Casey').replace('Draft', 'Reviewed'));
});

test('locked properties do not offer an editable draft or claim an unsaved change', async ({ page }) => {
	const original = '---\nowner: Morgan\npublished: true\nrelated: "[[Before]]"\n---\n\nBody';
	await mountEditor(page, original, { editingMode: 'locked' });
	await page.getByRole('button', { name: 'Edit owner', exact: true }).focus();
	await page.keyboard.press('F2');
	await expect(page.locator('.mlp-property-input')).toHaveCount(0);
	await page.getByRole('button', { name: 'Edit related', exact: true }).click();
	await expect(page.locator('.mlp-property-input')).toHaveCount(0);
	await page.locator('.mlp-property-boolean input').click();
	await expect(page.locator('.mlp-property-boolean input')).toBeChecked();
	expect(await sourceAfterEdits(page, original)).toBe(original);
	expect(await page.evaluate(() => (window as any).__posted.filter((message: any) => message.type === 'preserveDraft'))).toEqual([]);
	await page.getByRole('button', { name: 'Locked: select to edit the document', exact: true }).click();
	await page.getByRole('button', { name: 'Edit owner', exact: true }).dblclick();
	await expect(page.getByRole('textbox', { name: 'Edit owner', exact: true })).toBeFocused();
	await page.keyboard.type('Casey');
	await page.keyboard.press('Enter');
	await page.getByRole('button', { name: 'Editing: select to lock the editor', exact: true }).click();
	await page.getByRole('button', { name: 'Edit owner', exact: true }).dblclick();
	await expect(page.locator('.mlp-property-input')).toHaveCount(0);
	await expect.poll(() => sourceAfterEdits(page, original)).toBe(original.replace('Morgan', 'Casey'));
});

test('table at end of document stays rendered after appending a row and column', async ({ page }) => {
	const original = '# Inventory\n\n| Item | Count |\n| --- | ---: |\n| Cable | 2 |';
	await mountEditor(page, original);
	await page.getByRole('button', { name: 'Add a row', exact: true }).click();
	await expect(page.locator('.mlp-table tbody tr')).toHaveCount(2);
	await page.getByRole('button', { name: 'Add a column', exact: true }).click();
	await expect(page.locator('.mlp-table thead th')).toHaveCount(3);
	await page.locator('.mlp-table tbody tr').last().locator('td').first().click();
	await page.keyboard.type('Adapter');
	await page.keyboard.press('Enter');
	await expect(page.locator('.mlp-table tbody tr').last()).toContainText('Adapter');
	await expect.poll(() => sourceAfterEdits(page, original)).toMatch(/\|\s*Adapter\s*\|\s*\|\s*\|\n\n$/);
});

for (const reverse of [false, true]) test(`typing in one table and clicking another retains both edits, reverse=${reverse}`, async ({ page }) => {
	const original = 'Start\n\n| A | B |\n| --- | --- |\n| First | Keep A |\n\nBetween\n\n| C | D |\n| --- | --- |\n| Second | Keep B |\n\nEnd';
	await mountEditor(page, original);
	const first = page.locator('.mlp-table').nth(reverse ? 1 : 0).locator('td').first();
	const second = page.locator('.mlp-table').nth(reverse ? 0 : 1).locator('td').first();
	await first.click();
	await page.keyboard.press(`${modifier}+a`);
	await page.keyboard.type('First revised');
	await second.click();
	await expect(second).toHaveAttribute('contenteditable', 'true');
	await page.keyboard.press(`${modifier}+a`);
	await page.keyboard.type('Second revised');
	await page.keyboard.press('Enter');
	const upper = reverse ? 'Second revised' : 'First revised';
	const lower = reverse ? 'First revised' : 'Second revised';
	await expect.poll(() => sourceAfterEdits(page, original)).toBe(original.replace('| First |', `| ${upper} |`).replace('| Second |', `| ${lower} |`));
	await expect(page.locator('.mlp-table td')).toHaveText([upper, 'Keep A', lower, 'Keep B']);
});

test('locked table selection permits copying but refuses keyboard deletion and cell editing', async ({ page }) => {
	const original = 'Before\n\n| A | B |\n| --- | --- |\n| One | Two |\n\nAfter';
	await mountEditor(page, original, { editingMode: 'locked' });
	await page.locator('.mlp-table td').first().click();
	await page.keyboard.press('F2');
	await expect(page.locator('.mlp-table-cell-editing')).toHaveCount(0);
	await page.getByRole('button', { name: 'Table options', exact: true }).click();
	await page.getByRole('button', { name: 'Select entire table', exact: true }).click();
	const copied = await page.locator('.mlp-table-wrap').evaluate(element => {
		const data = new DataTransfer();
		element.dispatchEvent(new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true }));
		return data.getData('text/plain');
	});
	expect(copied).toBe('| A | B |\n| --- | --- |\n| One | Two |');
	await page.keyboard.press('Backspace');
	await expect(page.locator('.mlp-table td')).toHaveText(['One', 'Two']);
	expect(await sourceAfterEdits(page, original)).toBe(original);
});

test('table options keyboard navigation can close without changing the selected cell', async ({ page }) => {
	const original = 'Before\n\n| A | B |\n| --- | --- |\n| One | Two |\n| Three | Four |\n\nAfter';
	await mountEditor(page, original);
	await page.locator('.mlp-table td').first().click();
	await page.keyboard.press('Escape');
	const options = page.getByRole('button', { name: 'Table options', exact: true });
	await options.click();
	await options.focus();
	await page.keyboard.press('Tab');
	await expect(page.getByRole('button', { name: 'Select entire table', exact: true })).toBeFocused();
	await page.keyboard.press('End');
	await page.keyboard.press('ArrowDown');
	await expect(page.getByRole('button', { name: 'Select entire table', exact: true })).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(options).toBeFocused();
	await expect(options).toHaveAttribute('aria-expanded', 'false');
	expect(await sourceAfterEdits(page, original)).toBe(original);
});
