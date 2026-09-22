import { test, expect } from '@playwright/test';
import { mountEditor, postToWebview } from './harness';

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

	test('mouse-highlighted paragraph text can be deleted with Backspace', async ({ page }) => {
		await mountEditor(page, 'Alpha bravo charlie');
		const line = page.locator('.cm-line');
		const box = await line.boundingBox();
		expect(box).not.toBeNull();
		await page.mouse.move(box!.x + 2, box!.y + box!.height / 2);
		await page.mouse.down();
		await page.mouse.move(box!.x + 44, box!.y + box!.height / 2, { steps: 6 });
		await page.mouse.up();
		expect((await page.evaluate(() => window.getSelection()?.toString() ?? '')).trim()).toBe('Alpha');

		await page.keyboard.press('Backspace');
		await expect(line).not.toContainText('Alpha');
		await expect(line).toContainText('bravo charlie');
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
	test('glimmers on a locked edit attempt and stops when unlocked', async ({ page }) => {
		await mountEditor(page, 'Locked text', { editingMode: 'locked' });
		const toggle = page.locator('.mlp-editing-mode-toggle');
		await page.locator('.cm-line').click();
		await page.keyboard.press('Enter');
		await expect(toggle).toHaveClass(/mlp-lock-shine/);
		expect(await toggle.evaluate(e => getComputedStyle(e, '::after').animationName)).toBe('mlp-lock-shine');
		await expect(page.locator('.cm-content')).toHaveText('Locked text');
		await expect(toggle).not.toHaveClass(/mlp-lock-shine/, { timeout: 3500 });
		await page.locator('.cm-line').click();
		await expect(toggle).toHaveClass(/mlp-lock-shine/);
		await toggle.click();
		await expect(toggle).not.toHaveClass(/mlp-lock-shine/);
	});
	test('does not animate the locked toggle with reduced motion', async ({ page }) => {
		await page.emulateMedia({ reducedMotion: 'reduce' });
		await mountEditor(page, 'Locked text', { editingMode: 'locked' });
		await page.locator('.cm-line').click();
		await page.keyboard.press('Enter');
		const toggle = page.locator('.mlp-editing-mode-toggle');
		await expect(toggle).not.toHaveClass(/mlp-lock-shine/);
		expect(await toggle.evaluate(e => getComputedStyle(e, '::after').animationName)).toBe('none');
		await expect(page.locator('.cm-content')).toHaveText('Locked text');
	});
	test('starts locked, blocks document mutations, and unlocks from the upper-right toggle', async ({ page }) => {
		await mountEditor(page, '# Locked note\n', { editingMode: 'locked' });
		const editor = page.locator('.cm-content');
		const toggle = page.getByRole('button', { name: 'Locked: select to edit the document' });
		await expect(editor).toHaveAttribute('contenteditable', 'false');
		await expect(toggle).toHaveAttribute('aria-pressed', 'true');
		await expect(toggle.locator('[data-editing-mode="locked"]')).toHaveClass(/is-selected/);
		await expect(toggle.locator('[data-editing-mode="editing"]')).not.toHaveClass(/is-selected/);
		await expect(toggle.locator('svg')).toHaveCount(2);
		await expect(toggle).toHaveText('');
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
		const unlockedToggle = page.getByRole('button', { name: 'Editing: select to lock the editor' });
		await expect(unlockedToggle.locator('[data-editing-mode="editing"]')).toHaveClass(/is-selected/);
		await unlockedToggle.screenshot({ path: test.info().outputPath('editing-toggle.png') });
		await unlockedToggle.press('Space');
		await expect(editor).toHaveAttribute('contenteditable', 'false');
		await page.getByRole('button', { name: 'Locked: select to edit the document' }).press('Enter');
		await expect(editor).toHaveAttribute('contenteditable', 'true');
		await editor.click();
		await page.keyboard.type('X');
		await expect.poll(() => page.evaluate(() =>
			(window as unknown as { __posted: Array<{ type: string }> }).__posted.some((message) => message.type === 'edit'),
		)).toBe(true);
	});
});

test.describe('Markdown list editing', () => {
	test('Shift+Enter creates an Obsidian-style continuation without another list marker', async ({ page }) => {
		const cases = [
			{ source: '- Bullet item', insert: '\n  ' },
			{ source: '1. Numbered item', insert: '\n   ' },
			{ source: '- [ ] Task item', insert: '\n      ' },
		];

		for (const entry of cases) {
			await mountEditor(page, entry.source);
			await page.locator('.cm-content').click();
			await page.keyboard.press('End');
			await page.keyboard.press('Shift+Enter');
			await expect(page.locator('.cm-line')).toHaveCount(2);
			await expect.poll(() => page.evaluate(() =>
				(window as unknown as { __posted: Array<{ type: string; changes?: Array<{ insert: string }> }> }).__posted
					.filter((message) => message.type === 'edit').at(-1)?.changes?.[0]?.insert,
			)).toBe(entry.insert);
		}
	});

	test('Shift+Enter creates a plain line in a paragraph', async ({ page }) => {
		await mountEditor(page, 'First line');
		await page.locator('.cm-content').click();
		await page.keyboard.press('End');
		await page.keyboard.press('Shift+Enter');
		await page.keyboard.type('Second line');

		await expect(page.locator('.cm-line')).toHaveCount(2);
		await expect(page.locator('.cm-line').nth(1)).toHaveText('Second line');
	});

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

		await expect(page.locator('.cm-line')).toHaveCount(3);
		await expect(page.locator('.cm-line').nth(2)).toHaveText('');
	});

	test('ends a task list when its current checkbox is empty', async ({ page }) => {
		await mountEditor(page, '- [ ] First task\n- [ ] ');
		await page.locator('.cm-content').click();
		await page.keyboard.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End');
		await page.keyboard.press('Enter');

		await expect(page.locator('.cm-line')).toHaveCount(3);
		await expect(page.locator('.cm-line').nth(2)).toHaveText('');
	});

	test('repeated Enter escapes a nested list at the bottom of the page', async ({ page }) => {
		await mountEditor(page, '- Parent\n  - Nested item');
		await page.locator('.cm-content').click();
		await page.keyboard.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End');
		await page.keyboard.press('Enter');
		await page.keyboard.press('Enter');
		await page.keyboard.type('Unrelated row');

		const lastLine = page.locator('.cm-line').last();
		await expect(lastLine).toHaveText('Unrelated row');
		await expect(lastLine).not.toHaveClass(/mlp-line-list/);
	});

	test('Enter escapes an indented Shift+Enter continuation at the bottom of the page', async ({ page }) => {
		await mountEditor(page, '- List item');
		await page.locator('.cm-content').click();
		await page.keyboard.press('End');
		await page.keyboard.press('Shift+Enter');
		await page.keyboard.press('Enter');
		await page.keyboard.type('Unrelated row');

		const lastLine = page.locator('.cm-line').last();
		await expect(lastLine).toHaveText('Unrelated row');
		await expect(lastLine).not.toHaveClass(/mlp-line-list/);
	});

	test('repeated Enter escapes a quote or callout at the bottom of the page', async ({ page }) => {
		await mountEditor(page, '> [!note] Section\n> Final content');
		await page.locator('.cm-content').click();
		await page.keyboard.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End');
		await page.keyboard.press('Enter');
		await page.keyboard.press('Enter');
		await page.keyboard.type('Unrelated row');

		const lastLine = page.locator('.cm-line').last();
		await expect(lastLine).toHaveText('Unrelated row');
		await expect(lastLine).not.toHaveClass(/mlp-line-callout|mlp-line-quote/);
	});
});

test.describe('fenced code editing', () => {
	test('copies exact code through the host and reports confirmed success or failure', async ({ page }) => {
		await mountEditor(page, 'Before\n\n```text\nfirst Ω\n  second\n```\n\nAfter');
		const button = page.getByRole('button', { name: 'Copy code block', exact: true });
		await button.click();
		const request = await page.evaluate(() =>
			(window as unknown as { __posted: Array<{ type: string; requestId: number; text: string }> }).__posted
				.find(message => message.type === 'copyCode'));
		expect(request?.text).toBe('first Ω\n  second');
		await expect(button).not.toHaveText('✓');
		await postToWebview(page, { type: 'copyCodeResult', requestId: request!.requestId, ok: true });
		await expect(button).toHaveText('✓');
		await button.click();
		const second = await page.evaluate(() =>
			(window as unknown as { __posted: Array<{ type: string; requestId: number }> }).__posted
				.filter(message => message.type === 'copyCode').at(-1));
		await postToWebview(page, { type: 'copyCodeResult', requestId: second!.requestId, ok: false });
		await expect(button).toHaveText('✕');
	});
	test('shows a copy button for a single-line fenced block', async ({ page }) => {
		await mountEditor(page, 'Before\n\n```js\nconst value = 1;\n```\n\nAfter');
		await page.locator('.cm-line', { hasText: 'After' }).click();

		await expect(page.getByRole('button', { name: 'Copy code block' })).toHaveCount(1);
	});

	test('shows one copy button for every fenced block', async ({ page }) => {
		await mountEditor(page, '```js\none();\ntwo();\n```\n\n```text\nsingle line\n```\n\nAfter');
		await page.locator('.cm-line', { hasText: 'After' }).click();

		await expect(page.getByRole('button', { name: 'Copy code block' })).toHaveCount(2);
	});

	test('keeps the copy button available while editing code', async ({ page }) => {
		await mountEditor(page, '```js\nconst value = 1;\n```');
		await page.locator('.cm-line', { hasText: 'const value = 1;' }).click();

		await expect(page.getByRole('button', { name: 'Copy code block' })).toHaveCount(1);
	});

	test('deleting all mouse-selected visible code removes the complete fenced block', async ({ page }) => {
		await mountEditor(page, 'Before\n\n```text\none\ntwo\n```\n\nAfter');
		const first = page.locator('.cm-line', { hasText: 'one' });
		const last = page.locator('.cm-line', { hasText: 'two' });
		const firstBox = await first.boundingBox();
		const lastBox = await last.boundingBox();
		expect(firstBox).not.toBeNull();
		expect(lastBox).not.toBeNull();
		await page.mouse.move(firstBox!.x + 18, firstBox!.y + firstBox!.height / 2);
		await page.mouse.down();
		await page.mouse.move(lastBox!.x + lastBox!.width - 8, lastBox!.y + lastBox!.height / 2, { steps: 10 });
		await page.mouse.up();
		expect(await page.evaluate(() => window.getSelection()?.toString())).toContain('one');
		expect(await page.evaluate(() => window.getSelection()?.toString())).toContain('two');

		await page.keyboard.press('Backspace');
		await expect(page.locator('.mlp-line-code')).toHaveCount(0);
		await expect(page.locator('.cm-content')).not.toContainText('```');
		await expect(page.locator('.cm-content')).toContainText('Before');
		await expect(page.locator('.cm-content')).toContainText('After');
	});

	test('shows a copy button for an empty fenced block', async ({ page }) => {
		await mountEditor(page, '```text\n```\n\nAfter');
		await page.locator('.cm-line', { hasText: 'After' }).click();

		await expect(page.getByRole('button', { name: 'Copy code block' })).toHaveCount(1);
	});

	test('Mod-Enter moves the caret out of a fenced block', async ({ page }) => {
		await mountEditor(page, 'Before\n\n```js\nconst value = 1;\n```');
		const codeLine = page.locator('.cm-line', { hasText: 'const value = 1;' });
		await codeLine.click();
		await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter');
		await page.keyboard.type('After');

		const inserted = page.locator('.cm-line', { hasText: 'After' });
		await expect(inserted).toHaveText('After');
		await expect(inserted).not.toHaveClass(/mlp-line-code/);
	});

	test('leaves a fence whose closing marker has surrounding whitespace', async ({ page }) => {
		await mountEditor(page, '```js\nconst value = 1;\n   ```   ');
		const codeLine = page.locator('.cm-line', { hasText: 'const value = 1;' });
		await codeLine.click();
		await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter');
		await page.keyboard.type('After');

		await expect(page.locator('.cm-line', { hasText: 'After' })).not.toHaveClass(/mlp-line-code/);
	});

	test('pressing Enter on a blank final code line leaves the fenced block', async ({ page }) => {
		await mountEditor(page, 'Before\n\n```js\nconst value = 1;\n```');
		const codeLine = page.locator('.cm-line', { hasText: 'const value = 1;' });
		await codeLine.click();
		await page.keyboard.press('End');
		await page.keyboard.press('Enter');
		await page.keyboard.press('Enter');
		await page.keyboard.type('After');

		await expect(page.locator('.cm-line').last()).toHaveText('After');
		await expect(page.locator('.cm-line').last()).not.toHaveClass(/mlp-line-code/);
	});

	test('leaving a fenced block inserts a normal line before following text', async ({ page }) => {
		await mountEditor(page, '```js\nconst value = 1;\n```\nFollowing');
		const codeLine = page.locator('.cm-line', { hasText: 'const value = 1;' });
		await codeLine.click();
		await page.keyboard.press('End');
		await page.keyboard.press('Enter');
		await page.keyboard.press('Enter');
		await page.keyboard.type('After');

		const inserted = page.locator('.cm-line', { hasText: 'After' });
		await expect(inserted).not.toHaveClass(/mlp-line-code/);
		await expect(page.locator('.cm-line').last()).toHaveText('Following');
	});

	test('a single Enter after non-empty code remains inside the block', async ({ page }) => {
		await mountEditor(page, '~~~js\nconst first = 1;\n~~~');
		const codeLine = page.locator('.cm-line', { hasText: 'const first = 1;' });
		await codeLine.click();
		await page.keyboard.press('End');
		await page.keyboard.press('Enter');
		await page.keyboard.type('const second = 2;');

		await expect(page.locator('.cm-line', { hasText: 'const second = 2;' })).toHaveClass(/mlp-line-code/);
	});

	test('Enter preserves code that looks like an empty Markdown bullet', async ({ page }) => {
		await mountEditor(page, '```text\n- \nkeep\n```');
		const marker = page.locator('.cm-line.mlp-line-code').filter({ hasText: '-' });
		await marker.click();
		await page.keyboard.press('End');
		await page.keyboard.press('Enter');
		await page.keyboard.type('new code');
		await expect(page.locator('.cm-line.mlp-line-code').filter({ hasText: '-' })).toHaveCount(1);
		await expect(page.locator('.cm-line', { hasText: 'new code' })).toHaveClass(/mlp-line-code/);
		await expect(page.locator('.cm-line', { hasText: 'keep' })).toHaveCount(1);
	});

	test('ArrowDown and Enter leave a fenced code block at the end of a document', async ({ page }) => {
		await mountEditor(page, 'Before\n\n```js\nconst value = 1;\n```');
		const codeLine = page.locator('.cm-line', { hasText: 'const value = 1;' });
		await codeLine.click();
		await page.keyboard.press('End');
		await page.keyboard.press('ArrowDown');
		await page.keyboard.press('Enter');
		await page.keyboard.type('After');

		await expect(page.locator('.cm-line').last()).toHaveText('After');
	});
});

test.describe('highlight editing', () => {
	test('Mod-Enter moves the caret after highlighted text', async ({ page }) => {
		await mountEditor(page, 'Before ==highlighted text==');
		await page.locator('.mlp-highlight').click();
		await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter');
		await page.keyboard.type(' after');

		await expect(page.locator('.mlp-highlight')).toHaveText('highlighted text');
		await expect(page.locator('.cm-line', { hasText: 'after' })).toContainText('after');
	});

	test('Enter at the end of a highlight starts a normal line', async ({ page }) => {
		await mountEditor(page, '==highlighted text==');
		const highlight = page.locator('.mlp-highlight');
		await highlight.click();
		await page.keyboard.press('End');
		await page.keyboard.press('Enter');
		await page.keyboard.type('After');

		await expect(page.locator('.cm-line').last()).toHaveText('After');
		await expect(page.locator('.cm-line').last().locator('.mlp-highlight')).toHaveCount(0);
	});
});
