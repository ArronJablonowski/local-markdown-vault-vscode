import { expect, test } from '@playwright/test';
import { mountEditor } from './harness';

const contexts = [
	['- > [!note]+ Agenda', '  > '], ['1. > [!warning]+ Agenda', '   > '],
	['> - > [!abstract]+ Agenda', '>   > '], ['> 1. > [!tip]+ Agenda', '>    > '],
];
for (const [header, quote] of contexts) for (const marker of ['*', '- [x]']) for (const value of ['**Decision**<br>Follow up', '<ul><li>First<ul><li>Nested detail</li></ul></li></ul>']) {
	test(`list-contained callout retains table dimensions and bullet depth: ${JSON.stringify({ header, marker, value })}`, async ({ page }) => {
		const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
		const table = `| Notes | Owner |\n| --- | --- |\n| ${value} | Team |`;
		const source = 'Before\n\n' + header + '\n' + `${quote}${marker} Parent\n${quote}${marker} Child\n${quote}\n` + table.split('\n').map(line => quote + line).join('\n') + '\n\nAfter';
		await mountEditor(page, source);
		const handle = page.getByRole('separator', { name: 'Resize column 1', exact: true });
		await handle.focus(); for (let n = 0; n < 55; n++) await page.keyboard.press('Shift+ArrowLeft');
		await page.locator('.cm-line', { hasText: 'Child' }).click(); await page.keyboard.press('End');
		await page.keyboard.press('Tab'); await page.keyboard.press('Enter'); await page.keyboard.type('Sibling', { delay: 15 });
		await page.keyboard.press('Shift+Tab');
		const nextMarker = marker === '- [x]' ? '- [ ]' : marker;
		const expected = source.replace(`${quote}${marker} Child`, `${quote}    ${marker} Child\n${quote}${nextMarker} Sibling`);
		await expect.poll(() => page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString())).toBe(expected);
		await page.locator('.cm-line', { hasText: /^After$/ }).click();
		await expect(handle).toHaveAttribute('aria-valuenow', '64');
		await expect(page.locator('.mlp-table td').last()).toHaveText('Team');
		await expect.poll(() => page.locator('.mlp-table td').first().evaluate(cell => cell.getBoundingClientRect().height)).toBeGreaterThan(34);
		const callout = page.getByRole('button', { name: 'Agenda callout', exact: true });
		await callout.click(); await expect(page.locator('.mlp-table')).toHaveCount(0);
		await callout.click(); await expect(handle).toHaveAttribute('aria-valuenow', '64');
		expect(errors).toEqual([]);
	});
}
