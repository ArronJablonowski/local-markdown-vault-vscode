import { test, expect } from '@playwright/test';
import { mountEditor } from './harness';

const ONE_MIB = 1024 * 1024;

function oneMibNote(): string {
	const heading = '# One MiB note\n\n';
	const line = 'A plain Markdown line kept intentionally simple for viewport measurement.\n';
	let text = heading + line.repeat(Math.ceil((ONE_MIB - heading.length) / line.length));
	text = text.slice(0, ONE_MIB);
	return text;
}

test.describe('large-note performance', () => {
	for (let run = 1; run <= 5; run++) {
		test(`mounts an editable first viewport for a 1 MiB note within one second (run ${run})`, async ({ page }) => {
			const started = performance.now();
			await mountEditor(page, oneMibNote());
			const elapsedMs = performance.now() - started;
			console.log(`PERF-004 run ${run}: ${elapsedMs.toFixed(1)} ms`);

			const content = page.locator('.cm-content');
			await expect(content).toHaveAttribute('contenteditable', 'true');
			await expect(page.locator('.cm-line').first()).toContainText('One MiB note');
			expect(elapsedMs).toBeLessThan(1_000);

			await page.evaluate(() => {
				(window as unknown as { __posted: unknown[] }).__posted = [];
			});
			await page.locator('.cm-line').first().click();
			await page.keyboard.type('X');
			await expect.poll(() => page.evaluate(() =>
				(window as unknown as { __posted: Array<{ type: string }> }).__posted.some((message) => message.type === 'edit'),
			)).toBe(true);
		});
	}
});
