import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';

// Use the actual static host shell without importing production TS into out-test.
const CSV_VIEW_BODY = /export const CSV_VIEW_BODY = `([\s\S]*?)`;/.exec(readFileSync(join(process.cwd(), 'src/shared/csvView.ts'), 'utf8'))![1];

async function mount(page: Page, text: string, state: unknown = null) {
	await page.setContent(`<html lang="en-US"><head><title>CSV QA</title><style>${readFileSync(join(process.cwd(), 'media/webview-csv.css'), 'utf8')}</style></head><body>${CSV_VIEW_BODY}<script>window.__posted=[];window.__state=${JSON.stringify(state).replace(/</g, '\\u003c')};window.acquireVsCodeApi=()=>({postMessage:m=>window.__posted.push(m),getState:()=>window.__state,setState:s=>window.__state=s});</script></body></html>`);
	await page.addScriptTag({ content: readFileSync(join(process.cwd(), 'dist/webview-csv.js'), 'utf8') });
	await update(page, text);
}
async function update(page: Page, text: string) { await page.evaluate(text => window.dispatchEvent(new MessageEvent('message', { data: { type: 'csv', text } })), text); }

for (const header of [true, false]) for (const delimiter of [',', ';', '\t']) {
	test(`CSV sorts complete records with headers=${header}, separator=${JSON.stringify(delimiter)}`, async ({ page }) => {
		const rows = [['Name', 'Count'], ['Zebra', '10'], ['Apple', '2'], ['Empty', '']];
		await mount(page, rows.map(row => row.join(delimiter)).join('\r\n'));
		await page.getByLabel('Separator', { exact: true }).selectOption(delimiter === '\t' ? 'tab' : delimiter);
		if (!header) await page.getByLabel('First row is a header').uncheck();
		await page.locator('#head button').nth(1).click();
		await expect(page.locator('#head th').nth(2)).toHaveAttribute('aria-sort', 'ascending');
		if (header) {
			await expect(page.locator('#rows tr').first()).toHaveText('3Apple2');
			await page.locator('#head button').nth(1).press('Enter');
			await expect(page.locator('#rows tr').first()).toHaveText('2Zebra10');
		}
		await expect(page.locator('#rows tr').last()).toContainText('Empty');
		await page.getByRole('button', { name: 'Reset sort' }).click();
		await expect(page.locator('#rows tr').first()).toContainText(header ? 'Zebra' : 'Name');
		expect(await page.evaluate(() => (window as any).__posted)).toEqual([{ type: 'ready' }]);
	});
}

test('CSV displays hostile fields and formulas literally with no resource requests', async ({ page }) => {
	const requests: string[] = []; page.on('request', request => requests.push(request.url()));
	await mount(page, 'Name,Notes\n<script>,"<img src=x onerror=alert(1)>"\n=HYPERLINK(evil),https://tracker.invalid\n🙂,"line one\nline two, with ""quotes"""');
	await expect(page.locator('#rows tr')).toHaveCount(3);
	await expect(page.locator('#rows img, #rows script, #rows a')).toHaveCount(0);
	await expect(page.locator('#rows')).toContainText('=HYPERLINK(evil)');
	await expect(page.locator('#rows tr').last().locator('td').last()).toHaveText('line one\nline two, with "quotes"');
	expect(requests).toEqual([]);
	await page.getByRole('button', { name: 'Open Text' }).click();
	expect(await page.evaluate(() => (window as any).__posted)).toEqual([{ type: 'ready' }, { type: 'openSource' }]);
});

test('CSV pagination and sorting cover all records without mounting an unbounded grid', async ({ page }) => {
	await mount(page, 'Name,Count\n' + Array.from({ length: 1201 }, (_, n) => `Record${1201 - n},${1201 - n}`).join('\n'));
	await expect(page.locator('#rows tr')).toHaveCount(100);
	await page.locator('#head button').nth(1).click();
	await expect(page.locator('#rows tr').first()).toContainText('Record1');
	for (let n = 0; n < 12; n++) await page.getByRole('button', { name: 'Next page' }).click();
	await expect(page.locator('#rows tr')).toHaveCount(1); await expect(page.locator('#rows tr')).toContainText('Record1201');
	await expect(page.getByRole('button', { name: 'Next page' })).toBeDisabled();
	await page.getByRole('button', { name: 'Previous page' }).click(); await expect(page.locator('#rows tr')).toHaveCount(100);
	await update(page, 'Name,Count\nNew,4'); await expect(page.locator('#rows tr')).toHaveCount(1); await expect(page.locator('#rows')).toContainText('New');
});

for (const source of ['"unclosed', 'A,B\n"x"garbage,y', ','.repeat(200), 'A\n' + 'x'.repeat(65537)]) {
	test(`CSV rejects malformed or oversized source ${source.slice(0, 24)}`, async ({ page }) => {
		await mount(page, source); await expect(page.locator('#rows tr')).toHaveCount(0); await expect(page.getByRole('status')).not.toHaveText('Loading CSV…');
		await page.getByRole('button', { name: 'Reset sort' }).click(); await expect(page.locator('#rows tr')).toHaveCount(0);
		await update(page, 'A,B\nx,y'); await expect(page.locator('#rows tr')).toHaveCount(1);
	});
}

for (const width of [400, 1200]) test(`CSV wide/multiline grid remains readable at ${width}px`, async ({ page }) => {
	await page.setViewportSize({ width, height: 600 });
	await mount(page, Array.from({ length: 12 }, (_, n) => `Column${n}`).join(',') + '\n' + Array.from({ length: 12 }, () => '"A multiline field\nwith detailed notes and Unicode 🙂"').join(','));
	await expect.poll(() => page.locator('#viewport').evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
	expect(await page.locator('#rows td').first().evaluate(el => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
	await page.locator('#viewport').evaluate(el => { el.scrollLeft = 400; });
	await expect(page.locator('#rows th')).toBeVisible();
});

test('CSV restores validated view choices without persisting cell contents', async ({ page }) => {
	await mount(page, Array.from({ length: 220 }, (_, n) => `${n};Sensitive value ${n}`).join('\n'), { separator: ';', headers: false, column: 0, descending: true, page: 1 });
	await expect(page.locator('#page')).toHaveText('Page 2 of 3');
	await expect(page.locator('#rows tr').first()).toHaveText('120119Sensitive value 119');
	expect(await page.evaluate(() => (window as any).__state)).toEqual({ separator: ';', headers: false, column: 0, descending: true, page: 1 });
	await mount(page, 'A,B\nx,y', { page: Infinity, column: 300, separator: { toString: 42 }, headers: 'no' });
	await expect(page.locator('#rows tr')).toHaveCount(1);
});

test('CSV host errors never let controls redisplay an obsolete snapshot', async ({ page }) => {
	await mount(page, 'Name,Count\nOld,4');
	await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', { data: { type: 'error', message: 'CSV is now too large.' } })));
	await page.getByRole('button', { name: 'Reset sort' }).click();
	await page.getByLabel('First row is a header').uncheck();
	await expect(page.locator('#rows tr')).toHaveCount(0); await expect(page.getByRole('status')).toHaveText('CSV is now too large.');
	await update(page, 'Name,Count\nCurrent,5'); await expect(page.locator('#rows')).toContainText('Current');
});

test('CSV controls and table have no serious or critical accessibility violations', async ({ page }) => {
	await mount(page, 'Name,Count\nApple,2\nPear,4');
	const result = await new AxeBuilder({ page }).analyze();
	expect(result.violations.filter(v => ['serious', 'critical'].includes(v.impact ?? ''))).toEqual([]);
});
