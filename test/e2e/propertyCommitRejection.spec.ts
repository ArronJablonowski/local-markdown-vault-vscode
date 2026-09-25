import { expect, test, type Page } from '@playwright/test';
import { mountEditor, postToWebview } from './harness';

const source = '---\npriority: 1\npublished: true\n---\n\nBody';

/** Fill isolated pending groups while the first ordinary edit awaits its ACK. */
async function fillPendingQueue(page: Page): Promise<void> {
	await mountEditor(page, source, { currentVaultPath: 'property-capacity.md' });
	await page.evaluate(() => { (window as any).__holdEditAck = true; });
	await postToWebview(page, { type: 'jumpToLine', line: 6 });
	await page.keyboard.press('End');
	await page.keyboard.type('A');
	await expect.poll(() => page.evaluate(() => (window as any).__posted.filter((message: any) => message.type === 'edit').length)).toBe(1);
	await page.locator('.cm-content').evaluate(element => {
		for (let index = 0; index < 32; index++) {
			const transfer = new DataTransfer();
			transfer.setData('text/tab-separated-values', `Column\tValue\nRow ${index}\t${index}`);
			element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer }));
		}
	});
	await expect.poll(() => page.evaluate(() => (window as any).__webviewState?.recovery?.draftText)).toContain('Row 31');
	await postToWebview(page, { type: 'jumpToLine', line: 5 });
	await expect(page.locator('.mlp-frontmatter')).toBeVisible();
}

test('a queue-rejected property edit retains its exact draft instead of marking it committed', async ({ page }) => {
	await fillPendingQueue(page);
	const cell = page.locator('.mlp-frontmatter tr', { hasText: 'priority' }).locator('td');
	await cell.focus(); await page.keyboard.press('Enter');
	const input = cell.locator('input');
	await input.fill('12345');
	await input.press('Enter');
	await expect(input).toHaveValue('12345');
	await expect.poll(() => page.evaluate(() => (window as any).__posted
		.filter((message: any) => message.type === 'preserveDraft')
		.some((message: any) => message.text.includes('Uncommitted property priority:\n12345')))).toBe(true);
	await expect.poll(() => page.evaluate(() => (window as any).__webviewState?.recovery?.requiresSeparatePreservation)).toBe(true);
	expect(await page.evaluate(() => (window as any).__posted.filter((message: any) => message.type === 'edit').length)).toBe(1);
});

test('a queue-rejected boolean toggle returns to the authoritative checkbox state', async ({ page }) => {
	await fillPendingQueue(page);
	const checkbox = page.locator('.mlp-frontmatter .mlp-property-boolean input');
	await expect(checkbox).toBeChecked();
	await checkbox.click();
	await expect(page.locator('#mlp-recovery-notice')).toContainText('Too many edits are waiting to save');
	await expect(checkbox).toBeChecked();
	await expect(checkbox).toHaveAttribute('aria-label', 'True');
	expect(await page.evaluate(() => (window as any).__posted.filter((message: any) => message.type === 'edit').length)).toBe(1);
	expect(await page.evaluate(() => (window as any).__webviewState?.recovery?.draftText)).toContain('published: true');
});

test('an accepted property commit is not captured again as an uncommitted residual', async ({ page }) => {
	await mountEditor(page, source, { currentVaultPath: 'property-accepted.md' });
	const cell = page.locator('.mlp-frontmatter tr', { hasText: 'priority' }).locator('td');
	await cell.focus(); await page.keyboard.press('Enter');
	await cell.locator('input').fill('7');
	await cell.locator('input').press('Enter');
	await expect(cell).toHaveText('7');
	await expect.poll(() => page.evaluate(() => (window as any).__posted.filter((message: any) => message.type === 'edit').length)).toBe(1);
	expect(await page.evaluate(() => (window as any).__posted.filter((message: any) => message.type === 'preserveDraft'))).toEqual([]);
	expect(await page.evaluate(() => (window as any).__webviewState?.recovery?.requiresSeparatePreservation)).not.toBe(true);
});

test('a queue-rejected table cell commit remains editable and preserves its exact draft', async ({ page }) => {
	await fillPendingQueue(page);
	const cell = page.locator('.mlp-table tbody td').first();
	await cell.click();
	await expect(cell).toHaveAttribute('contenteditable', 'true');
	const draft = '**typed cell draft** & source';
	await cell.fill(draft);
	await cell.press('Enter');
	await expect(cell).toHaveText(draft);
	await expect(cell).toHaveAttribute('contenteditable', 'true');
	await expect(cell).not.toHaveAttribute('data-mlp-committed', '1');
	await expect.poll(() => page.evaluate(value => (window as any).__posted
		.filter((message: any) => message.type === 'preserveDraft')
		.some((message: any) => message.text.includes(`Uncommitted table cell:\n${value}`)), draft)).toBe(true);
	await expect.poll(() => page.evaluate(() => (window as any).__webviewState?.recovery?.requiresSeparatePreservation)).toBe(true);
	expect(await page.evaluate(() => (window as any).__posted.filter((message: any) => message.type === 'edit').length)).toBe(1);
});
