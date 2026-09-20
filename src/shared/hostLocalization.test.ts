import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { catalogFor, t, type MessageKey } from './i18n';

describe('extension-host localization', () => {
	it('localizes every user-facing manifest field in both catalogs', () => {
		const manifest = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
			displayName: string;
			description: string;
			capabilities?: Record<string, unknown>;
			contributes: {
				customEditors: Array<{ displayName: string }>;
				viewsContainers: { activitybar: Array<{ title: string }> };
				views: Record<string, Array<{ name: string }>>;
				commands: Array<{ title: string; category?: string }>;
				configuration: { title: string; properties: Record<string, unknown> };
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
			...Object.values(manifest.contributes.views).flat().map((view) => view.name),
			...manifest.contributes.commands.flatMap((command) => [command.title, command.category].filter(isString)),
			manifest.contributes.configuration.title,
			...localizedManifestStrings(manifest.contributes.configuration.properties),
			...localizedManifestStrings(manifest.capabilities ?? {}),
		];
		for (const field of fields) {
			const match = /^%([^%]+)%$/.exec(field);
			expect(match, `Unlocalized manifest field: ${field}`).not.toBeNull();
			const key = match![1];
			expect(english[key], `Missing English manifest translation: ${key}`).toBeTruthy();
			expect(japanese[key], `Missing Japanese manifest translation: ${key}`).toBeTruthy();
		}
	});

	it('keeps runtime translation placeholders complete and symmetric', () => {
		const catalog = JSON.parse(readFileSync(join(process.cwd(), 'l10n', 'bundle.l10n.ja.json'), 'utf8')) as Record<string, string>;
		let callCount = 0;
		for (const file of sourceFiles(join(process.cwd(), 'src')).filter((path) => !path.endsWith('.test.ts'))) {
			const source = readFileSync(file, 'utf8');
			const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
			const visit = (node: ts.Node): void => {
				if (ts.isCallExpression(node) && isVscodeTranslationCall(node)) {
					const firstArgument = node.arguments[0];
					if (!ts.isStringLiteral(firstArgument)) return;
					const sourceMessage = firstArgument.text;
					const translated = catalog[sourceMessage];
					expect(translated, `Missing Japanese runtime translation in ${file}: ${sourceMessage}`).toBeTruthy();
					expect(placeholders(translated), `Japanese placeholders differ in ${file}: ${sourceMessage}`)
						.toEqual(placeholders(sourceMessage));
					const suppliedArguments = node.arguments.length - 1;
					for (const index of placeholders(sourceMessage)) {
						expect(index, `Unresolved runtime placeholder {${index}} in ${file}: ${sourceMessage}`)
							.toBeLessThan(suppliedArguments);
					}
					callCount += 1;
				}
				ts.forEachChild(node, visit);
			};
			visit(sourceFile);
		}
		expect(callCount).toBeGreaterThan(50);
	});

	it('supplies every webview translation placeholder in English and Japanese', () => {
		const japanese = catalogFor('ja');
		let callCount = 0;
		for (const file of sourceFiles(join(process.cwd(), 'src')).filter((path) => !path.endsWith('.test.ts'))) {
			const source = readFileSync(file, 'utf8');
			if (!/import\s*\{[^}]*\bt\b[^}]*\}\s*from\s*['"][^'"]*i18n['"]/.test(source)) continue;
			const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
			const visit = (node: ts.Node): void => {
				if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 't') {
					const firstArgument = node.arguments[0];
					if (firstArgument && ts.isStringLiteral(firstArgument)) {
						const key = firstArgument.text as MessageKey;
						const englishTemplate = t(key);
						const translated = japanese[key];
						expect(translated, `Missing Japanese webview translation in ${file}: ${key}`).toBeTruthy();
						expect(placeholders(translated!), `Japanese webview placeholders differ in ${file}: ${key}`)
							.toEqual(placeholders(englishTemplate));
						const suppliedArguments = node.arguments.length - 1;
						for (const index of placeholders(englishTemplate)) {
							expect(index, `Unresolved webview placeholder {${index}} in ${file}: ${key}`)
								.toBeLessThan(suppliedArguments);
						}
						callCount += 1;
					}
				}
				ts.forEachChild(node, visit);
			};
			visit(sourceFile);
		}
		expect(callCount).toBeGreaterThan(100);
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

function localizedManifestStrings(value: unknown): string[] {
	if (typeof value === 'string') return /^%[^%]+%$/.test(value) ? [value] : [];
	if (Array.isArray(value)) return value.flatMap(localizedManifestStrings);
	if (!value || typeof value !== 'object') return [];
	return Object.entries(value).flatMap(([key, nested]) =>
		/^(?:description|markdownDescription|enumDescriptions|markdownEnumDescriptions)$/i.test(key)
			? allStrings(nested)
			: localizedManifestStrings(nested));
}

function allStrings(value: unknown): string[] {
	if (typeof value === 'string') return [value];
	if (Array.isArray(value)) return value.flatMap(allStrings);
	if (!value || typeof value !== 'object') return [];
	return Object.values(value).flatMap(allStrings);
}

function isString(value: string | undefined): value is string {
	return typeof value === 'string';
}

function isVscodeTranslationCall(node: ts.CallExpression): boolean {
	const expression = node.expression;
	return ts.isPropertyAccessExpression(expression)
		&& expression.name.text === 't'
		&& ts.isPropertyAccessExpression(expression.expression)
		&& expression.expression.name.text === 'l10n'
		&& ts.isIdentifier(expression.expression.expression)
		&& expression.expression.expression.text === 'vscode'
		&& node.arguments.length > 0
		&& ts.isStringLiteral(node.arguments[0]);
}

function placeholders(message: string): number[] {
	return [...message.matchAll(/\{(\d+)\}/g)]
		.map((match) => Number(match[1]))
		.filter((value, index, values) => values.indexOf(value) === index)
		.sort((left, right) => left - right);
}
