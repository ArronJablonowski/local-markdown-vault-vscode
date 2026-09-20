import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

describe('extension-host localization', () => {
	it('localizes every user-facing manifest field in both catalogs', () => {
		const manifest = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
			displayName: string;
			description: string;
			contributes: {
				customEditors: Array<{ displayName: string }>;
				viewsContainers: { activitybar: Array<{ title: string }> };
				configuration: { title: string };
			};
		};
		const english = JSON.parse(readFileSync(join(process.cwd(), 'package.nls.json'), 'utf8')) as Record<string, string>;
		const japanese = JSON.parse(readFileSync(join(process.cwd(), 'package.nls.ja.json'), 'utf8')) as Record<string, string>;
		expect(Object.keys(japanese).sort(), 'Manifest catalogs must have identical keys').toEqual(Object.keys(english).sort());
		const fields = [
			manifest.displayName,
			manifest.description,
			...manifest.contributes.customEditors.map((editor) => editor.displayName),
			...manifest.contributes.viewsContainers.activitybar.map((container) => container.title),
			manifest.contributes.configuration.title,
		];
		for (const field of fields) {
			const match = /^%([^%]+)%$/.exec(field);
			expect(match, `Unlocalized manifest field: ${field}`).not.toBeNull();
			const key = match![1];
			expect(english[key], `Missing English manifest translation: ${key}`).toBeTruthy();
			expect(japanese[key], `Missing Japanese manifest translation: ${key}`).toBeTruthy();
		}
	});

	it('has a Japanese translation for every literal vscode.l10n message', () => {
		const catalog = JSON.parse(readFileSync(join(process.cwd(), 'l10n', 'bundle.l10n.ja.json'), 'utf8')) as Record<string, string>;
		const messages = new Set<string>();
		for (const file of sourceFiles(join(process.cwd(), 'src'))) {
			const source = readFileSync(file, 'utf8');
			for (const match of source.matchAll(/vscode\.l10n\.t\(\s*'((?:\\'|[^'])+)'/g)) {
				messages.add(match[1].replace(/\\'/g, "'"));
			}
		}
		const missing = [...messages].filter((message) => !catalog[message]);
		expect(missing, `Missing Japanese runtime translations: ${missing.join(' | ')}`).toEqual([]);
	});

	it('routes vault validation and transaction errors through the localized allowlist', () => {
		const source = readFileSync(join(process.cwd(), 'src', 'vault', 'registerVault.ts'), 'utf8');
		expect(source).not.toContain('validateInput: validateVaultEntryName');
		expect(source.match(/validateInput: \(value\) => localizeVaultValidation/g)).toHaveLength(3);
		expect(source).toMatch(/function safeError[\s\S]*return localizeVaultError\(message\) \?\? fallback;/);
		expect(source).toContain('default: return undefined;');
	});

	it('derives every webview document language from the escaped VS Code locale', () => {
		const webviewHosts = sourceFiles(join(process.cwd(), 'src')).filter((file) =>
			!file.endsWith('.test.ts') && readFileSync(file, 'utf8').includes('<html lang='),
		);
		expect(webviewHosts.length).toBeGreaterThan(0);
		for (const file of webviewHosts) {
			const source = readFileSync(file, 'utf8');
			expect(source, `${file} hard-codes a webview locale`).not.toMatch(/<html\s+lang=["'][^$]/);
			expect(source, `${file} does not escape the host locale`).toContain('<html lang="${escapeAttribute(vscode.env.language)}">');
		}
	});
});

function sourceFiles(directory: string): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name);
		return entry.isDirectory() ? sourceFiles(path) : entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
	});
}
