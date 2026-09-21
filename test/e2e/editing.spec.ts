import { test, expect } from '@playwright/test';
import { mountEditor } from './harness';

const DOC = '# Heading\n\nBefore ![alt](assets/pic.png) after.\n\nPlain paragraph.\n';

test.describe('live preview editing', () => {
	test.beforeEach(async ({ page }) => {
		await mountEditor(page, DOC);
	});

	test('the caret is drawn in the theme color, not black', async ({ page }) => {
		await page.locator('.cm-content').click();
		const color = await page.locator('.cm-cursor').first().evaluate(
			(el) => getComputedStyle(el).borderLeftColor,
		);
		// The library default is a hardcoded black, invisible on a dark theme.
		expect(color).not.toBe('rgb(0, 0, 0)');
		expect(color).toBe('rgb(174, 175, 173)'); // --vscode-editorCursor-foreground
	});

	test('an image renders in place of its markup', async ({ page }) => {
		await expect(page.locator('img.mlp-image')).toHaveCount(1);
		await expect(page.locator('.cm-content')).not.toContainText('assets/pic.png');
	});

	test('clicking an image reveals the markup behind it', async ({ page }) => {
		// The reported bug: a widget ignores events by default, so the click placed
		// no caret and the `![alt](url)` could never be reached by mouse.
		await page.locator('img.mlp-image').click();
		await expect(page.locator('.cm-content')).toContainText('assets/pic.png');
	});

	test('the markup hides again once the caret leaves', async ({ page }) => {
		await page.locator('img.mlp-image').click();
		await expect(page.locator('.cm-content')).toContainText('assets/pic.png');
		// Click a line well away from the image.
		await page.locator('.cm-line').last().click();
		await expect(page.locator('img.mlp-image')).toHaveCount(1);
	});

	test('a heading hides its hash once the caret leaves the line', async ({ page }) => {
		// A fresh document starts with the caret at position 0, i.e. on the
		// heading, so it legitimately shows its source until the caret moves.
		const first = page.locator('.cm-line').first();
		await expect(first).toContainText('#');
		await page.locator('.cm-line').last().click();
		await expect(page.locator('.cm-line').first()).not.toContainText('#');
	});

	test('a heading shows its hash again when the caret returns', async ({ page }) => {
		await page.locator('.cm-line').last().click();
		const first = page.locator('.cm-line').first();
		await expect(first).not.toContainText('#');
		await first.click();
		await expect(page.locator('.cm-line').first()).toContainText('#');
	});

	test('undo flushes the pending edit before asking the host to undo', async ({ page }) => {
		await page.evaluate(() => {
			(window as unknown as { __posted: unknown[] }).__posted = [];
		});
		await page.locator('.cm-content').click();
		await page.keyboard.type('X');
		await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');

		await expect.poll(() => page.evaluate(() =>
			(window as unknown as { __posted: Array<{ type: string }> }).__posted.map((message) => message.type),
		)).toEqual(['edit', 'undo']);
	});

	test('posts every pasted raster image in one ordered host operation', async ({ page }) => {
		await page.evaluate(() => {
			(window as unknown as { __posted: unknown[] }).__posted = [];
			const transfer = new DataTransfer();
			transfer.items.add(new File(['one'], 'one.png', { type: 'image/png' }));
			transfer.items.add(new File(['two'], 'two.jpg', { type: 'image/jpeg' }));
			document.querySelector('.cm-content')?.dispatchEvent(new ClipboardEvent('paste', {
				bubbles: true,
				cancelable: true,
				clipboardData: transfer,
			}));
		});

		await expect.poll(() => page.evaluate(() =>
			(window as unknown as { __posted: Array<{ type: string; images?: Array<{ mimeType: string; dataBase64: string }> }> })
				.__posted.find((message) => message.type === 'pasteImages'),
		)).toMatchObject({
			type: 'pasteImages',
			images: [
				{ mimeType: 'image/png', dataBase64: 'b25l' },
				{ mimeType: 'image/jpeg', dataBase64: 'dHdv' },
			],
		});
		await expect(page.locator('#mlp-image-paste-warning')).toBeHidden();
	});

	test('rejects unsupported pasted images with an accessible localized warning', async ({ page }) => {
		await page.evaluate(() => {
			(window as unknown as { __posted: unknown[] }).__posted = [];
			const transfer = new DataTransfer();
			transfer.items.add(new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], 'tracking.svg', {
				type: 'image/svg+xml',
			}));
			document.querySelector('.cm-content')?.dispatchEvent(new ClipboardEvent('paste', {
				bubbles: true,
				cancelable: true,
				clipboardData: transfer,
			}));
		});

		const warning = page.locator('#mlp-image-paste-warning');
		await expect(warning).toBeVisible();
		await expect(warning).toHaveAttribute('role', 'alert');
		await expect(warning).toHaveText('Only PNG, JPEG, GIF, WebP, and BMP images can be pasted or dropped.');
		expect(await page.evaluate(() =>
			(window as unknown as { __posted: Array<{ type: string }> }).__posted
				.some((message) => message.type === 'pasteImages'),
		)).toBe(false);
	});
});

test.describe('locked Live Preview mode', () => {
	test('starts locked, blocks document mutations, and unlocks from the upper-right toggle', async ({ page }) => {
		await mountEditor(page, '# Locked note\n', { editingMode: 'locked' });
		const editor = page.locator('.cm-content');
		const toggle = page.getByRole('button', { name: 'Locked: select to edit the document' });
		await expect(editor).toHaveAttribute('contenteditable', 'false');
		await expect(toggle).toHaveAttribute('aria-pressed', 'true');
		await page.evaluate(() => {
			(window as unknown as { __posted: unknown[] }).__posted = [];
		});
		await editor.click();
		await page.keyboard.type('malicious mutation');
		await expect(editor).toContainText('Locked note');
		await expect(editor).not.toContainText('malicious mutation');
		expect(await page.evaluate(() =>
			(window as unknown as { __posted: Array<{ type: string }> }).__posted.some((message) => message.type === 'edit'),
		)).toBe(false);

		await toggle.click();
		await expect(editor).toHaveAttribute('contenteditable', 'true');
		await expect(page.getByRole('button', { name: 'Editing: select to lock the editor' })).toHaveAttribute('aria-pressed', 'false');
		await editor.click();
		await page.keyboard.type('X');
		await expect.poll(() => page.evaluate(() =>
			(window as unknown as { __posted: Array<{ type: string }> }).__posted.some((message) => message.type === 'edit'),
		)).toBe(true);
	});
});

test.describe('Markdown list editing', () => {
	test('continues an ordered list with the next number on Enter', async ({ page }) => {
		await mountEditor(page, '7. Seventh item');
		await page.locator('.cm-content').click();
		await page.keyboard.press('End');
		await page.keyboard.press('Enter');

		await expect(page.locator('.cm-line')).toHaveCount(2);
		await expect(page.locator('.cm-line').nth(1)).toContainText('8.');
	});

	test('continues an indented ordered list at the same level', async ({ page }) => {
		await mountEditor(page, '1. Parent\n   1. Child');
		await page.locator('.cm-content').click();
		await page.keyboard.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End');
		await page.keyboard.press('Enter');

		await expect(page.locator('.cm-line')).toHaveCount(3);
		await expect(page.locator('.cm-line').nth(2)).toContainText('2.');
	});

	test('starts another unchecked task on Enter', async ({ page }) => {
		await mountEditor(page, '- [ ] First task');
		await page.locator('.cm-content').click();
		await page.keyboard.press('End');
		await page.keyboard.press('Enter');

		await expect(page.locator('.cm-line')).toHaveCount(2);
		await expect(page.locator('.cm-line').nth(1)).toContainText('- [ ]');
	});

	test('ends an ordered list when its current item is empty', async ({ page }) => {
		await mountEditor(page, '1. First item\n2. ');
		await page.locator('.cm-content').click();
		await page.keyboard.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End');
		await page.keyboard.press('Enter');

		await expect(page.locator('.cm-line')).toHaveCount(2);
		await expect(page.locator('.cm-line').nth(1)).toHaveText('');
	});

	test('ends a task list when its current checkbox is empty', async ({ page }) => {
		await mountEditor(page, '- [ ] First task\n- [ ] ');
		await page.locator('.cm-content').click();
		await page.keyboard.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End');
		await page.keyboard.press('Enter');

		await expect(page.locator('.cm-line')).toHaveCount(2);
		await expect(page.locator('.cm-line').nth(1)).toHaveText('');
	});
});
