import { expect, test } from '@playwright/test';
import { mountEditor } from './harness';

test('renders formatting HTML and reveals editable original source', async ({ page }) => {
	const html = '<div><h2>Meeting</h2><p><strong>Important</strong> <mark>decision</mark></p><ul><li>Action</li></ul><table><tr><th>Owner</th></tr><tr><td>Alex</td></tr></table><details><summary>More</summary>Evidence</details></div>';
	await mountEditor(page, '# Notes\n\n' + html + '\n\nEnd');
	const preview = page.locator('.mlp-safe-html');
	await expect(preview.locator('h2')).toHaveText('Meeting');
	await expect(preview.locator('li')).toHaveText('Action');
	await expect(preview.locator('td')).toHaveText('Alex');
	await preview.locator('summary').click();
	await expect(preview.locator('details')).toHaveAttribute('open', '');
	await page.getByRole('button', { name: 'Edit HTML source' }).click();
	await expect(page.locator('.cm-content')).toContainText(html);
});

test('HTML cannot introduce executable markup, URLs, attributes, or network loads', async ({ page }) => {
	const requests: string[] = [];
	page.on('request', request => { if (request.url().includes('attacker.invalid')) requests.push(request.url()); });
	await mountEditor(page, '# Notes\n\n<div style="position:fixed" onclick="alert(1)" id="controls"><b>Safe</b><img src="https://attacker.invalid/pixel"><a href="javascript:alert(1)">Link</a><script>alert(1)</script><iframe src="https://attacker.invalid/"></iframe><svg onload="alert(1)"></svg><form><input></form><template shadowrootmode="open">Hidden</template></div>\n\nEnd');
	const preview = page.locator('.mlp-safe-html');
	await expect(preview.locator('b')).toHaveText('Safe');
	await expect(preview.locator('script, img, a, iframe, svg, form, input, template, [style], [id], [onclick], [href], [src]')).toHaveCount(0);
	await page.waitForTimeout(200);
	expect(requests).toEqual([]);
});
