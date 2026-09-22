import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';

const ROOT = join(__dirname, '..', '..');

test.describe('Markdown Preview code copy controls', () => {
	test('adds a copy button to single-line and multiline fenced output', async ({ page }) => {
		const script = readFileSync(join(ROOT, 'media', 'markdown-preview-copy.js'), 'utf8');
		const style = readFileSync(join(ROOT, 'media', 'markdown-preview-copy.css'), 'utf8');
		await page.setContent(`<!doctype html><html><head><style>${style}</style></head><body>
			<pre><code>single line</code></pre>
			<pre><code>first line\nsecond line</code></pre>
			<script>
				window.__copied = '';
				Object.defineProperty(navigator, 'clipboard', { value: { writeText: async value => { window.__copied = value; } } });
			</script>
			<script>${script.replace(/<\/script>/gi, '<\\/script>')}</script>
		</body></html>`);

		const buttons = page.getByRole('button', { name: 'Copy code block' });
		await expect(buttons).toHaveCount(2);
		await buttons.first().click();
		await expect.poll(() => page.evaluate(() => (window as unknown as { __copied: string }).__copied)).toBe('single line');
		await expect(buttons.first()).toHaveText('Copied');
	});

	test('handles dynamically rendered blocks without interpreting their text as HTML', async ({ page }) => {
		const script = readFileSync(join(ROOT, 'media', 'markdown-preview-copy.js'), 'utf8');
		await page.setContent(`<!doctype html><html><body><script>${script.replace(/<\/script>/gi, '<\\/script>')}</script></body></html>`);
		await page.evaluate(() => {
			const pre = document.createElement('pre');
			const code = document.createElement('code');
			code.textContent = '<img src=x onerror="window.__executed=true">';
			pre.appendChild(code);
			document.body.appendChild(pre);
		});

		await expect(page.getByRole('button', { name: 'Copy code block' })).toHaveCount(1);
		expect(await page.evaluate(() => (window as unknown as { __executed?: boolean }).__executed)).toBeUndefined();
	});

	test('copies the current code after VS Code replaces a rendered code node', async ({ page }) => {
		const script = readFileSync(join(ROOT, 'media', 'markdown-preview-copy.js'), 'utf8');
		await page.setContent('<html><body><pre><code>old text</code></pre></body></html>');
		await page.evaluate(() => {
			Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (value: string) => {
				(window as unknown as { __copied: string }).__copied = value;
			} } });
		});
		await page.addScriptTag({ content: script });
		await expect(page.getByRole('button', { name: 'Copy code block' })).toHaveCount(1);
		await page.evaluate(() => {
			const code = document.createElement('code');
			code.textContent = 'updated text';
			document.querySelector('pre > code')!.replaceWith(code);
		});
		await page.waitForFunction(() => document.querySelector('pre > code')?.textContent === 'updated text');
		await page.getByRole('button', { name: 'Copy code block' }).click();
		await expect.poll(() => page.evaluate(() => (window as unknown as { __copied: string }).__copied)).toBe('updated text');
	});

	test('collapses blocks with eight or more lines and expands them with the keyboard', async ({ page }) => {
		const script = readFileSync(join(ROOT, 'media', 'markdown-preview-copy.js'), 'utf8');
		const style = readFileSync(join(ROOT, 'media', 'markdown-preview-copy.css'), 'utf8');
		const seven = Array.from({ length: 7 }, (_, index) => `short ${index + 1}`).join('\n');
		const eight = Array.from({ length: 8 }, (_, index) => `long ${index + 1}`).join('\n');
		await page.setContent(`<!doctype html><html><head><style>${style}</style></head><body class="vscode-body">
			<pre><code>${seven}</code></pre><pre><code>${eight}</code></pre>
			<script>${script.replace(/<\/script>/gi, '<\\/script>')}</script>
		</body></html>`);

		await expect(page.getByRole('button', { name: 'Collapse code block' })).toHaveCount(1);
		await page.getByRole('button', { name: 'Collapse code block' }).press('Enter');
		await expect(page.locator('pre').nth(1).locator('code')).toBeHidden();
		await page.getByRole('button', { name: 'Expand code block' }).press('Space');
		await expect(page.locator('pre').nth(1).locator('code')).toBeVisible();
	});
});
