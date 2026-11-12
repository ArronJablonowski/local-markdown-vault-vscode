import { expect, test } from '@playwright/test';
import { mountEditor } from './harness';

const code = Array.from({ length: 9 }, (_, i) => `key${i + 1}: value${i + 1}`).join('\n');
const source = '---\ntitle: YAML defaults\n---\n\n# Note\n\n```yaml\n' + code + '\n```\n\nAfter';
for (const collapsed of [true, false]) {
 test(`YAML opening preference ${collapsed} preserves source and manual choices`, async ({ page }) => {
  await mountEditor(page, source, { collapseYamlByDefault: collapsed });
  const properties = page.locator('.mlp-frontmatter-content');
  await expect(properties).toBeVisible({ visible: !collapsed });
  await expect(page.getByRole('button', { name: collapsed ? 'Expand code block' : 'Collapse code block', exact: true })).toBeVisible();
  await page.getByRole('button', { name: collapsed ? 'Expand YAML properties' : 'Collapse YAML properties', exact: true }).click();
  await expect(properties).toBeVisible({ visible: collapsed });
  await page.getByRole('button', { name: collapsed ? 'Expand code block' : 'Collapse code block', exact: true }).click();
  await page.getByRole('button', { name: 'Copy code block', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__posted.findLast((m: any) => m.type === 'copyCode')?.text)).toBe(code);
  await expect.poll(() => page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString())).toBe(source);
  await page.waitForTimeout(100);
  await expect(page.getByRole('button', { name: collapsed ? 'Collapse code block' : 'Expand code block', exact: true })).toBeVisible();
 });
}
for (const language of ['yaml', 'yml', 'YAML']) for (const prefix of ['', '> ']) {
 test(`default six-line preview for ${language}, prefix=${prefix}`, async ({ page }) => {
  const block = ('```' + language + '\n' + code + '\n```').split('\n').map(line => prefix + line).join('\n');
  await mountEditor(page, '# Note\n\n' + (prefix ? '> [!note]+ Config\n>\n' : '') + block + '\n\nAfter');
  await expect(page.getByRole('button', { name: 'Expand code block', exact: true })).toBeVisible();
  await expect(page.locator('.cm-content')).toContainText('key6');
  await expect(page.locator('.cm-content')).not.toContainText('key7');
 });
}
test('frontmatter-only note starts collapsed', async ({ page }) => {
 await mountEditor(page, '---\ntitle: Only YAML\n---');
 await expect(page.getByRole('button', { name: 'Expand YAML properties', exact: true })).toBeVisible();
 await page.getByRole('button', { name: 'Expand YAML properties', exact: true }).click();
 await expect(page.locator('.mlp-frontmatter-content')).toBeVisible();
});
test('sidebar exposes the default-enabled YAML setting', async ({ page }) => {
 const { mountStyleSidebar } = await import('./harness');
 await mountStyleSidebar(page, []);
 const setting = page.getByLabel('Collapse YAML by default (newly opened notes)');
 await expect(setting).toHaveValue('on');
 await setting.selectOption('off');
 await expect.poll(() => page.evaluate(() => (window as any).__posted.findLast((m: any) => m.type === 'setSetting'))).toEqual({ type: 'setSetting', key: 'collapseYamlByDefault', value: false });
});
for (const collapsed of [true, false]) test(`built-in preview honors YAML opening preference ${collapsed}`, async ({ page }) => {
 const { readFileSync } = await import('node:fs');
 const { join } = await import('node:path');
 const root = join(__dirname, '..', '..');
 const script = readFileSync(join(root, 'media', 'markdown-preview-copy.js'), 'utf8');
 const style = readFileSync(join(root, 'media', 'markdown-preview-copy.css'), 'utf8');
 await page.setContent(`<style>${style}</style><pre data-lmv-yaml-default-collapsed="${collapsed}"><code class="language-yml">${code}</code></pre><script>${script}</script>`);
 await expect(page.getByRole('button', { name: collapsed ? 'Expand code block' : 'Collapse code block', exact: true })).toBeVisible();
 await page.getByRole('button', { name: collapsed ? 'Expand code block' : 'Collapse code block', exact: true }).click();
 await expect(page.getByRole('button', { name: collapsed ? 'Collapse code block' : 'Expand code block', exact: true })).toBeVisible();
 await expect(page.locator('code')).toHaveText(code);
});
test('seven-line YAML remains expandable and collapsible', async ({ page }) => {
 await mountEditor(page, '# Note\n\n```yml\n' + code.split('\n').slice(0, 7).join('\n') + '\n```\n\nAfter');
 await page.getByRole('button', { name: 'Expand code block', exact: true }).click();
 await expect(page.locator('.cm-content')).toContainText('key7');
 await page.getByRole('button', { name: 'Collapse code block', exact: true }).click();
 await expect(page.locator('.cm-content')).not.toContainText('key7');
});
for (const value of ['2', 'invalid']) test(`collapsing properties preserves the pending value ${value}`, async ({ page }) => {
 await mountEditor(page, '---\npriority: 1\n---\n\nBody');
 await page.getByRole('button', { name: 'Expand YAML properties', exact: true }).click();
 const cell = page.locator('.mlp-property-number');
 await cell.focus(); await page.keyboard.press('Enter');
 await cell.locator('input').fill(value);
 await page.getByRole('button', { name: 'Collapse YAML properties', exact: true }).click();
 if (value === 'invalid') {
  await expect(cell.locator('input')).toHaveValue(value);
  await expect(page.locator('.mlp-frontmatter-content')).toBeVisible();
 } else {
  await expect(page.locator('.mlp-frontmatter-content')).toBeHidden();
  await expect.poll(() => page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString())).toContain('priority: 2');
  await page.getByRole('button', { name: 'Expand YAML properties', exact: true }).click();
  await expect(cell).toHaveText('2');
 }
});
test('CRLF frontmatter and YAML previews fold without sending document edits', async ({ page }) => {
 const crlf = source.replaceAll('\n', '\r\n');
 await mountEditor(page, crlf);
 await expect(page.getByRole('button', { name: 'Expand YAML properties', exact: true })).toBeVisible();
 await expect(page.getByRole('button', { name: 'Expand code block', exact: true })).toBeVisible();
 // The webview uses normalized lines; opening folds must never request a file rewrite.
 expect(await page.locator('.cm-content').evaluate((el: any) => el.cmTile.root.view.state.doc.toString())).toBe(source);
 expect(await page.evaluate(() => (window as any).__posted.filter((m: any) => m.type === 'edit'))).toEqual([]);
});
test('global expand and collapse include YAML sections and code previews', async ({ page }) => {
 await mountEditor(page, source);
 await page.getByRole('button', { name: 'Expand all collapsible objects', exact: true }).click();
 await expect(page.locator('.mlp-frontmatter-content')).toBeVisible();
 await expect(page.getByRole('button', { name: 'Collapse code block', exact: true })).toBeVisible();
 await page.getByRole('button', { name: 'Collapse all collapsible objects', exact: true }).click();
 await expect(page.locator('.mlp-frontmatter-content')).toBeHidden();
 await expect(page.getByRole('button', { name: 'Expand code block', exact: true })).toBeVisible();
 expect(await page.evaluate(() => (window as any).__posted.filter((m: any) => m.type === 'edit'))).toEqual([]);
});
