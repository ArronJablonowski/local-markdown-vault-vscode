import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { t, type MessageKey } from './i18n';

describe('US English interface catalogs', () => {
	it('supplies US English text for every localized manifest field', () => {
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
		const compatibilityCatalog = JSON.parse(readFileSync(join(process.cwd(), 'package.nls.ja.json'), 'utf8')) as Record<string, string>;
		expect(compatibilityCatalog).toEqual(english);
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
			expect(english[match![1]], `Missing US English manifest text: ${match![1]}`).toBeTruthy();
		}
	});

	it('supplies every extension-host placeholder argument', () => {
		let callCount = 0;
		for (const file of productionSourceFiles()) {
			const source = readFileSync(file, 'utf8');
			const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
			const visit = (node: ts.Node): void => {
				if (ts.isCallExpression(node) && isVscodeTranslationCall(node)) {
					const firstArgument = node.arguments[0];
					if (!ts.isStringLiteral(firstArgument)) return;
					const suppliedArguments = node.arguments.length - 1;
					for (const index of placeholders(firstArgument.text)) {
						expect(index, `Unresolved host placeholder {${index}} in ${file}: ${firstArgument.text}`)
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

	it('supplies every webview message placeholder argument', () => {
		let callCount = 0;
		for (const file of productionSourceFiles()) {
			const source = readFileSync(file, 'utf8');
			if (!/import\s*\{[^}]*\bt\b[^}]*\}\s*from\s*['"][^'"]*i18n['"]/.test(source)) continue;
			const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
			const visit = (node: ts.Node): void => {
				if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 't') {
					const firstArgument = node.arguments[0];
					if (firstArgument && ts.isStringLiteral(firstArgument)) {
						const template = t(firstArgument.text as MessageKey);
						const suppliedArguments = node.arguments.length - 1;
						for (const index of placeholders(template)) {
							expect(index, `Unresolved webview placeholder {${index}} in ${file}: ${firstArgument.text}`)
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

	it('declares every webview document as US English', () => {
		const webviewHosts = productionSourceFiles().filter((file) => readFileSync(file, 'utf8').includes('<html lang='));
		expect(webviewHosts.length).toBeGreaterThan(0);
		for (const file of webviewHosts) {
			expect(readFileSync(file, 'utf8'), `${file} does not declare US English`).toContain('<html lang="en-US">');
		}
	});
});

function productionSourceFiles(directory = join(process.cwd(), 'src')): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name);
		return entry.isDirectory()
			? productionSourceFiles(path)
			: entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : [];
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
