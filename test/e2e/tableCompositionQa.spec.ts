import { expect, test } from '@playwright/test';
import { mountEditor } from './harness';

const note = 'Before\n\n| Owner | State |\n| --- | --- |\n| Original | Retain |\n\nAfter';

for (const nested of [false, true]) for (const text of ['\u4f1a\u8b70\u306e\u8a18\u9332', '\ud68c\uc758 \uae30\ub85d 😀']) for (const key of ['Enter', 'Escape', 'Tab']) for (const legacy of [false, true]) test(`IME ${key} keeps ${text} in the active table cell, legacy=${legacy}, nested=${nested}`, async ({ page }) => {
	const original = nested ? '> [!note] Agenda\n>\n' + note.split('\n').map(line => '> ' + line).join('\n') : note;
	await mountEditor(page, original);
	const cell = page.locator('.mlp-table td').first();
	await cell.click();
	await cell.evaluate((element, options) => {
		element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
		element.textContent = options.text;
		element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', data: options.text, isComposing: true }));
		element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: options.key, isComposing: !options.legacy, keyCode: options.legacy ? 229 : 0 }));
	}, { key, legacy, text });
	await expect(cell).toHaveAttribute('contenteditable', 'true');
	await expect(cell).toBeFocused();
	await expect(cell).toHaveText(text);
	expect(await page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString())).toBe(original);
	await cell.evaluate((element, data) => element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data })), text);
	await expect.poll(() => page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString())).toBe(original.replace('Original', text));
	await page.keyboard.press('Enter');
	await expect(cell).not.toHaveAttribute('contenteditable', 'true');
});
