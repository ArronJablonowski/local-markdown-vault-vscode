import { expect, test, type Page } from '@playwright/test';
import { mountEditor, postToWebview } from './harness';

async function holdImageReads(page: Page): Promise<void> {
	await page.evaluate(() => {
		const read = FileReader.prototype.readAsDataURL;
		(window as any).__imageReads = [];
		FileReader.prototype.readAsDataURL = function (file: Blob) {
			(window as any).__imageReads.push(() => new Promise<void>(resolve => {
				this.addEventListener('loadend', () => resolve(), { once: true });
				read.call(this, file);
			}));
		};
	});
}

async function pasteImage(page: Page): Promise<void> {
	await page.locator('.cm-content').evaluate(element => {
		const data = new DataTransfer();
		data.items.add(new File(['synthetic image data'], 'fixture.png', { type: 'image/png' }));
		element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
	});
}

async function releaseImageReads(page: Page): Promise<void> {
	await page.evaluate(async () => {
		await Promise.all((window as any).__imageReads.splice(0).map((read: () => Promise<void>) => read()));
	});
}

async function imageMessages(page: Page) {
	return page.evaluate(() => (window as any).__posted.filter((message: any) => message.type === 'pasteImages'));
}

test('a delayed image paste follows edits before its original insertion point', async ({ page }) => {
	await mountEditor(page, 'Anchor\nTail');
	await holdImageReads(page);
	await postToWebview(page, { type: 'jumpToLine', line: 2 });
	await pasteImage(page);
	await postToWebview(page, { type: 'jumpToLine', line: 1 });
	await page.keyboard.type('PREFIX ');
	await releaseImageReads(page);
	await expect.poll(() => imageMessages(page)).toMatchObject([{ atPos: 14, needsOwnParagraph: false }]);
});

test('an image pasted while locked cannot become authorized by unlocking during its read', async ({ page }) => {
	await mountEditor(page, 'Retain locked content', { editingMode: 'locked' });
	await holdImageReads(page);
	await pasteImage(page);
	const started = await page.evaluate(() => (window as any).__imageReads.length);
	await page.getByRole('button', { name: 'Locked: select to edit the document', exact: true }).click();
	await releaseImageReads(page);
	expect(started).toBe(0);
	expect(await imageMessages(page)).toEqual([]);
});

test('locking cancels an already pending image paste even if the editor is unlocked again', async ({ page }) => {
	await mountEditor(page, 'Retain unlocked content');
	await holdImageReads(page);
	await pasteImage(page);
	await page.getByRole('button', { name: 'Editing: select to lock the editor', exact: true }).click();
	await page.getByRole('button', { name: 'Locked: select to edit the document', exact: true }).click();
	await releaseImageReads(page);
	expect(await imageMessages(page)).toEqual([]);
});

test('a decoded image waits for all preceding text edits to reach the host', async ({ page }) => {
	await mountEditor(page, 'Anchor\nTail');
	await holdImageReads(page);
	await postToWebview(page, { type: 'jumpToLine', line: 2 });
	await pasteImage(page);
	await page.evaluate(() => { (window as any).__holdEditAck = true; });
	await postToWebview(page, { type: 'jumpToLine', line: 1 });
	await page.keyboard.type('P');
	await expect.poll(() => page.evaluate(() => (window as any).__posted.filter((message: any) => message.type === 'edit').length)).toBe(1);
	await page.keyboard.type('REFIX ');
	await releaseImageReads(page);
	expect(await imageMessages(page)).toEqual([]);
	await postToWebview(page, { type: 'ackEdit', version: 1 });
	await expect.poll(() => page.evaluate(() => (window as any).__posted.filter((message: any) => message.type === 'edit').length)).toBe(2);
	expect(await imageMessages(page)).toEqual([]);
	await postToWebview(page, { type: 'ackEdit', version: 2 });
	await expect.poll(() => imageMessages(page)).toMatchObject([{ atPos: 14, needsOwnParagraph: false, baseVersion: 2 }]);
});

test('remote changes map a delayed image and its version before it reaches the host', async ({ page }) => {
	await mountEditor(page, 'Anchor\nTail');
	await holdImageReads(page);
	await postToWebview(page, { type: 'jumpToLine', line: 2 });
	await pasteImage(page);
	await postToWebview(page, { type: 'externalUpdate', changes: [{ from: 0, to: 0, insert: 'Remote ' }], version: 1 });
	await releaseImageReads(page);
	await expect.poll(() => imageMessages(page)).toMatchObject([{ atPos: 14, baseVersion: 1 }]);
});

test('replacing the destination cancels an image with a visible retry warning', async ({ page }) => {
	await mountEditor(page, 'Anchor\nTail');
	await holdImageReads(page);
	await postToWebview(page, { type: 'jumpToLine', line: 2 });
	await pasteImage(page);
	await postToWebview(page, { type: 'externalUpdate', changes: [{ from: 0, to: 11, insert: 'Replacement' }], version: 1 });
	await releaseImageReads(page);
	expect(await imageMessages(page)).toEqual([]);
	await expect(page.locator('#mlp-image-paste-warning')).toContainText('Paste or drop it again');
});

test('a second image gesture is visibly rejected while preserving the first pending job', async ({ page }) => {
	await mountEditor(page, 'Anchor\nTail');
	await holdImageReads(page);
	await postToWebview(page, { type: 'jumpToLine', line: 2 });
	await pasteImage(page);
	await pasteImage(page);
	expect(await page.evaluate(() => (window as any).__imageReads.length)).toBe(1);
	await expect(page.locator('#mlp-image-paste-warning')).toContainText('still being prepared');
	await releaseImageReads(page);
	await expect.poll(() => imageMessages(page)).toMatchObject([{ atPos: 7 }]);
	await expect(page.locator('#mlp-image-paste-warning')).toBeHidden();
});

test('locking also cancels decoded images waiting for an edit acknowledgment', async ({ page }) => {
	await mountEditor(page, 'Anchor\nTail');
	await holdImageReads(page);
	await postToWebview(page, { type: 'jumpToLine', line: 2 });
	await pasteImage(page);
	await page.evaluate(() => { (window as any).__holdEditAck = true; });
	await postToWebview(page, { type: 'jumpToLine', line: 1 });
	await page.keyboard.type('P');
	await releaseImageReads(page);
	expect(await imageMessages(page)).toEqual([]);
	await page.getByRole('button', { name: 'Editing: select to lock the editor', exact: true }).click();
	await page.getByRole('button', { name: 'Locked: select to edit the document', exact: true }).click();
	await postToWebview(page, { type: 'ackEdit', version: 1 });
	expect(await imageMessages(page)).toEqual([]);
});
