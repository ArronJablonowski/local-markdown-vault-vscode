import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'test', 'fixtures', 'obsidian-comparison-100');
rmSync(root, { recursive: true, force: true });
mkdirSync(root, { recursive: true });

const categories = [
	'basic-formatting',
	'lists-and-tasks',
	'links-and-wikilinks',
	'tables',
	'callouts-and-quotes',
	'properties-and-tags',
	'code-and-literals',
	'math-and-footnotes',
	'embeds-and-navigation',
	'unicode-stress-and-security',
];

const records = [];
const repeatedParagraph = (count, seed) => Array.from({ length: count }, (_, index) =>
	`Paragraph ${index + 1} for fixture ${seed} contains **bold**, *emphasis*, ~~deleted text~~, ==highlighted text==, and \`inline code\`.`,
).join('\n\n');

function documentFor(categoryIndex, variant, id, path) {
	const title = `Compatibility ${String(id).padStart(3, '0')}`;
	const common = `# ${title}\n\nFixture path: \`${path}\`.\n\n`;
	const growth = [0, 1, 2, 4, 8, 12, 20, 32, 48, 72][variant - 1];
	let body;
	let assertions;
	let interactions = ['select-text', 'copy', 'paste', 'undo', 'redo'];

	switch (categoryIndex) {
		case 0:
			body = `## Inline formatting\n\nPlain text with **strong text**, *emphasized text*, ***combined text***, ~~struck text~~, ==marked text==, and escaped \\*markers\\*.\n\n> A quotation with a [safe link](https://example.com) and a hard  \n> line break.\n\n---\n\n${repeatedParagraph(growth, id)}`;
			assertions = ['heading', 'strong', 'emphasis', 'strikethrough', 'highlight', 'blockquote'];
			interactions.push('source-reveal');
			break;
		case 1:
			body = `## Lists and tasks\n\n- First bullet\n  - Second-level bullet\n    - Third-level bullet\n- Final bullet\n\n${variant}. Ordered item\n${variant + 1}. Next ordered item\n\n- [ ] Open task ${variant}\n- [x] Completed task ${variant}\n- [?] Nonstandard completed state\n\n${repeatedParagraph(growth, id)}`;
			assertions = ['nested-bullets', 'ordered-list', 'tasks', 'completed-task-strikethrough'];
			interactions.push('enter-continues-list', 'tab-indents-list', 'checkbox-toggle');
			break;
		case 2: {
			const target = String(((id + 9) % 100) + 1).padStart(3, '0');
			body = `## Links\n\n[[${target}-compatibility-${target}|Neighbor note]] and [[${target}-compatibility-${target}#Compatibility ${target}]].\n\n[Relative neighbor](../${categories[(categoryIndex + 1) % categories.length]}/${target}-compatibility-${target}.md)\n\n[[Missing Note ${variant}]]\n\nAutolink: <https://example.com/path?q=${variant}>\n\n${repeatedParagraph(growth, id)}`;
			assertions = ['wikilink', 'alias', 'heading-fragment', 'markdown-link', 'unresolved-wikilink'];
			interactions.push('wikilink-navigation', 'wikilink-completion');
			break;
		}
		case 3: {
			const rows = Array.from({ length: Math.max(2, variant) }, (_, row) => `| Row ${row + 1} | ${row + variant} | ${row % 2 ? 'Odd' : 'Even'} |`).join('\n');
			body = `## Table\n\n| Name | Value | Group |\n| :--- | ---: | :---: |\n${rows}\n\nEscaped pipe outside table: A \\| B.\n\n${repeatedParagraph(Math.min(growth, 8), id)}`;
			assertions = ['table', 'alignment', 'escaped-pipe'];
			interactions.push('table-cell-edit', 'table-keyboard-navigation');
			break;
		}
		case 4:
			body = `## Callouts and quotations\n\n> [!note] Note ${variant}\n> A standard note callout.\n>\n> - Nested list item\n> - [x] Nested completed task\n\n> [!warning] Warning\n> Important warning text.\n\n> [!tip]- Folded tip\n> Hidden until expanded.\n\n> Ordinary quotation\n> with a second line.\n\n${repeatedParagraph(growth, id)}`;
			assertions = ['callout-note', 'callout-warning', 'folded-callout', 'nested-task', 'blockquote'];
			interactions.push('callout-fold-toggle', 'checkbox-toggle');
			break;
		case 5:
			body = `---\nname: ${title}\naliases:\n  - Alias ${id}\ntags: [compatibility/category-${categoryIndex + 1}, test/variant-${variant}]\npriority: ${variant}\ncomplete: ${variant % 2 === 0}\ndue: 2026-09-${String(variant + 10).padStart(2, '0')}\n---\n\n# ${title}\n\nFixture path: \`${path}\`.\n\n## Properties and tags\n\nInline tags: #compatibility/category-${categoryIndex + 1} and #test/variant-${variant}.\n\nA heading is not a tag: # Not-a-tag\n\n${repeatedParagraph(growth, id)}`;
			assertions = ['typed-properties', 'aliases', 'yaml-tags', 'inline-tags'];
			interactions.push('property-edit');
			break;
		case 6:
			body = `## Code and literals\n\nInline \`const value = ${variant};\` and escaped punctuation.\n\n\`\`\`javascript\nfunction fixture${id}(value) {\n  return value * ${variant};\n}\n\`\`\`\n\n\`\`\`text\nsingle line ${variant}\n\`\`\`\n\n    indented code ${variant}\n\n${repeatedParagraph(growth, id)}`;
			assertions = ['inline-code', 'fenced-code', 'single-line-fence', 'indented-code', 'copy-buttons'];
			interactions.push('copy-code', 'enter-in-code', 'exit-code-block');
			break;
		case 7:
			body = `## Math and footnotes\n\nInline math $E = mc^${variant}$ and $\\alpha + \\beta = \\gamma$.\n\n$$\n\\sum_{n=1}^{${variant + 2}} n = \\frac{(${variant + 2})(${variant + 3})}{2}\n$$\n\nA statement with a named footnote.[^named-${id}] Another with an inline footnote.^[Inline note ${variant}.]\n\n[^named-${id}]: Footnote definition ${id} with **formatting**.\n\n${repeatedParagraph(growth, id)}`;
			assertions = ['inline-math', 'block-math', 'named-footnote', 'inline-footnote'];
			interactions.push('footnote-navigation');
			break;
		case 8: {
			const targetId = Math.max(1, id - 10);
			const target = String(targetId).padStart(3, '0');
			body = `## Embeds and navigation\n\n![[${target}-compatibility-${target}]]\n\n![[${target}-compatibility-${target}#Compatibility ${target}]]\n\nA block that can be linked. ^block-${id}\n\n[[#^block-${id}|Block link]]\n\n![Blocked remote tracking image](https://tracker.invalid/pixel-${variant}.png)\n\n${repeatedParagraph(Math.min(growth, 8), id)}`;
			assertions = ['note-embed', 'heading-embed', 'block-id', 'block-link', 'remote-image-blocked'];
			interactions.push('embed-open-source', 'block-navigation');
			break;
		}
		default: {
			const unicode = ['Résumé', 'naïve', 'coöperate', 'façade', 'jalapeño', 'smörgåsbord', '😀', '👩🏽‍💻', 'e\u0301', '𝄞'].join(' · ');
			const stress = repeatedParagraph(growth * 3, id);
			body = `## Unicode, stress, and security\n\n${unicode}\n\nVery long token: \`${'segment-'.repeat(variant * 20)}end\`.\n\nRaw HTML must stay inert: <button onclick="alert('blocked')">Do not run</button>.\n\nUnsafe links must stay inert: [script](javascript:alert(1)) and [command](command:workbench.action.openSettings).\n\nEncoded traversal image: ![blocked](%2e%2e/%2e%2e/secret.png)\n\n\`\`\`mermaid\ngraph TD\n  A[Start] --> B[Safe node ${variant}]\n  B --> C[End]\n\`\`\`\n\n${stress}`;
			assertions = ['unicode', 'long-line', 'raw-html-inert', 'unsafe-links-inert', 'traversal-blocked', 'bounded-mermaid'];
			interactions.push('large-selection', 'scroll-stability');
			break;
		}
	}

	return { text: `${categoryIndex === 5 ? '' : common}${body.trim()}\n`, assertions, interactions };
}

let id = 0;
for (let categoryIndex = 0; categoryIndex < categories.length; categoryIndex += 1) {
	const category = categories[categoryIndex];
	const directory = join(root, category);
	mkdirSync(directory, { recursive: true });
	for (let variant = 1; variant <= 10; variant += 1) {
		id += 1;
		const serial = String(id).padStart(3, '0');
		const relativePath = `${category}/${serial}-compatibility-${serial}.md`;
		const generated = documentFor(categoryIndex, variant, id, relativePath);
		writeFileSync(join(root, relativePath), generated.text, 'utf8');
		records.push({
			id,
			path: relativePath,
			category,
			variant,
			bytes: Buffer.byteLength(generated.text),
			assertions: generated.assertions,
			interactions: generated.interactions,
		});
	}
}

writeFileSync(join(root, 'manifest.json'), `${JSON.stringify({ schemaVersion: 1, fileCount: records.length, records }, null, 2)}\n`);
writeFileSync(join(root, 'README.txt'), [
	'Obsidian comparison vault',
	'',
	'This directory contains exactly 100 generated Markdown notes. Do not edit generated notes by hand.',
	'Run npm run fixtures:obsidian to reproduce the corpus and manifest deterministically.',
	'The corpus contains no secrets. Remote and active-content examples are inert security fixtures.',
	'',
].join('\n'));

console.log(`Generated ${records.length} Markdown fixtures in ${root}`);
