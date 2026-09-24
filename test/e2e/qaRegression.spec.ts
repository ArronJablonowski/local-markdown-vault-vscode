import { expect, test } from '@playwright/test';
import { mountEditor } from './harness';

const table = 'Before\n\n| Name | Value |\n| --- | --- |\n| Alpha bravo | Charlie delta |\n\nAfter';

test('handled formatting and Find shortcuts stay inside the editor', async ({ page }) => {
	for (const key of ['b', 'i', 'f']) {
		await mountEditor(page, 'Word');
		await page.evaluate(() => {
			(window as unknown as { forwarded: number }).forwarded = 0;
			window.addEventListener('keydown', event => {
				if ((event.metaKey || event.ctrlKey) && ['b', 'i', 'f'].includes(event.key.toLowerCase())) {
					(window as unknown as { forwarded: number }).forwarded++;
				}
			});
		});
		await page.locator('.cm-line').click();
		await page.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+${key}`);
		expect(await page.evaluate(() => (window as unknown as { forwarded: number }).forwarded)).toBe(0);
	}
});

for (const mode of ['editing', 'locked'] as const) {
	test(`undo and redo do not bubble into a second workbench action in ${mode} mode`, async ({ page }) => {
		await mountEditor(page, 'Text', { editingMode: mode });
		await page.evaluate(() => {
			(window as unknown as { forwardedUndoKeys: number }).forwardedUndoKeys = 0;
			window.addEventListener('keydown', event => {
				if ((event.metaKey || event.ctrlKey) && ['z', 'y'].includes(event.key.toLowerCase())) {
					(window as unknown as { forwardedUndoKeys: number }).forwardedUndoKeys++;
				}
			});
		});
		await page.locator('.cm-line').click();
		const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
		await page.keyboard.press(`${mod}+z`);
		await page.keyboard.press(`${mod}+Shift+z`);
		await page.keyboard.press(`${mod}+y`);
		expect(await page.evaluate(() => (window as unknown as { forwardedUndoKeys: number }).forwardedUndoKeys)).toBe(0);
		const actions = await page.evaluate(() => (window as unknown as { __posted: Array<{ type: string }> }).__posted
			.filter(message => ['undo', 'redo'].includes(message.type)).map(message => message.type));
		expect(actions).toEqual(mode === 'editing' ? ['undo', 'redo', 'redo'] : []);
	});
}

test('locked table cells never become editable or display unsaved changes', async ({ page }) => {
	await mountEditor(page, table, { editingMode: 'locked' });
	const cell = page.locator('.mlp-table td').first();
	await cell.click();
	await expect(cell).not.toHaveAttribute('contenteditable', 'true');
	await page.keyboard.type('DO NOT CHANGE');
	await expect(cell).toHaveText('Alpha bravo');
	await cell.focus();
	await page.keyboard.press('F2');
	await expect(cell).not.toHaveAttribute('contenteditable', 'true');
});

for (const fence of ['```js', '~~~~text']) {
	test(`repeated Enter escapes an automatically closed ${fence} block typed from scratch`, async ({ page }) => {
		await mountEditor(page, '');
		await page.locator('.cm-content').click();
		await page.keyboard.type(fence);
		await page.keyboard.press('Enter');
		await page.keyboard.type('const value = 1;');
		await page.keyboard.press('Enter');
		await page.keyboard.press('Enter');
		await page.keyboard.type('Outside');
		await expect(page.locator('.cm-line').last()).toHaveText('Outside');
		await expect(page.locator('.cm-line').last()).not.toHaveClass(/mlp-line-code/);
	});
	test(`repeated Enter exits an unfinished ${fence} block at EOF`, async ({ page }) => {
		await mountEditor(page, `${fence}\nconst value = 1;`);
		await page.locator('.cm-line', { hasText: 'const value = 1;' }).click();
		await page.keyboard.press('End');
		await page.keyboard.press('Enter');
		await page.keyboard.press('Enter');
		await page.keyboard.type('Outside');
		await expect(page.locator('.cm-line').last()).toHaveText('Outside');
		await expect(page.locator('.cm-line').last()).not.toHaveClass(/mlp-line-code/);
	});
}

test('cutting a native table selection never cuts the unrelated editor line', async ({ page }) => {
	await mountEditor(page, table);
	const bounds = await page.locator('.mlp-table td').first().boundingBox();
	await page.mouse.move(bounds!.x + 12, bounds!.y + bounds!.height / 2);
	await page.mouse.down();
	await page.mouse.move(bounds!.x + 53, bounds!.y + bounds!.height / 2, { steps: 10 });
	await page.mouse.up();
	expect((await page.evaluate(() => window.getSelection()?.toString() ?? '')).trim()).toBe('Alpha');
	const copied = await page.evaluate(() => {
		const transfer = new DataTransfer();
		document.querySelector('.cm-content')!.dispatchEvent(new ClipboardEvent('cut', {
			bubbles: true, cancelable: true, clipboardData: transfer,
		}));
		return transfer.getData('text/plain');
	});
	expect(copied.trim()).toBe('Alpha');
	await expect(page.locator('.cm-line').first()).toHaveText('Before');
	await expect(page.locator('.mlp-table td').first()).not.toContainText('Alpha');
});

for (const action of ['Backspace', 'Delete', 'cut'] as const) {
	for (const mode of ['editing', 'locked'] as const) {
		test(`${action} handles a selected whole table in ${mode} mode`, async ({ page }) => {
			await mountEditor(page, table, { editingMode: mode });
			await page.getByRole('button', { name: 'Table options', exact: true }).click();
			await page.getByRole('button', { name: 'Select entire table', exact: true }).click();
			if (action === 'cut') {
				const copied = await page.evaluate(() => {
					const transfer = new DataTransfer();
					document.querySelector('.cm-content')!.dispatchEvent(new ClipboardEvent('cut', {
						bubbles: true, cancelable: true, clipboardData: transfer,
					}));
					return transfer.getData('text/plain');
				});
				expect(copied).toContain('| Alpha bravo | Charlie delta |');
			} else await page.keyboard.press(action);
			await expect(page.locator('.cm-line').first()).toHaveText('Before');
			await expect(page.locator('.cm-line').last()).toHaveText('After');
			await expect(page.locator('.mlp-table')).toHaveCount(mode === 'locked' ? 1 : 0);
		});
	}
}

for (const action of ['Backspace', 'Delete', 'cut'] as const) {
	test(`native partial-cell ${action} preserves surrounding content and table structure`, async ({ page }) => {
		await mountEditor(page, table);
		const bounds = await page.locator('.mlp-table td').first().boundingBox();
		await page.mouse.move(bounds!.x + 12, bounds!.y + bounds!.height / 2);
		await page.mouse.down();
		await page.mouse.move(bounds!.x + 53, bounds!.y + bounds!.height / 2, { steps: 10 });
		await page.mouse.up();
		if (action === 'cut') await page.evaluate(() => {
			document.querySelector('.cm-content')!.dispatchEvent(new ClipboardEvent('cut', {
				bubbles: true, cancelable: true, clipboardData: new DataTransfer(),
			}));
		});
		else await page.keyboard.press(action);
		await expect(page.locator('.cm-line').first()).toHaveText('Before');
		await expect(page.locator('.mlp-table td').first()).toHaveText('bravo');
		await expect(page.locator('.mlp-table td').nth(1)).toHaveText('Charlie delta');
	});
}
