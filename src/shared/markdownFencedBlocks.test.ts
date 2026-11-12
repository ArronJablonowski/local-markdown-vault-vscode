import { describe, expect, it } from 'vitest';
import { markdownFencedBlocks } from './markdownCodeRanges';

const contexts = [
	['', ''], ['> [!note] Configuration\n>\n', '> '],
	['> [!note] Outer\n>\n> > [!tip] Configuration\n> >\n', '> > '],
	['- Item\n\n', '  '], ['1. Item\n\n', '   '],
	['> - > [!note] Configuration\n>   >\n', '>   > '],
];
describe('parser-owned syntax-highlighting fence boundaries', () => {
	for (const prefix of ['', '> ', '> > ', '   > ']) for (const ending of ['\n', '\r\n']) for (const fence of ['````', '~~~~']) {
		it(`retains Markdown inside YAML scalars: ${JSON.stringify({ prefix, ending, fence })}`, () => {
			const code = ['description: |', '  > [!note] Literal', '  - [ ] Literal task', '  ```text', '  literal code', '  ```', 'enabled: true'];
			const intro = prefix === '   > ' ? '1. > [!tip] Configuration\n' : prefix ? prefix + '[!note] Configuration\n' : '';
			const source = (intro + [fence + 'yaml', ...code, fence].map(line => prefix + line).join('\n')).replace(/\n/g, ending);
			const blocks = markdownFencedBlocks(source);
			expect(blocks).toHaveLength(1);
			expect(blocks[0].lines.map(line => line.text)).toEqual(code);
			for (const line of blocks[0].lines) expect(source.slice(line.from, line.from + line.text.length)).toBe(line.text);
		});
	}
	for (const [intro, prefix] of contexts) for (const ending of ['\n', '\r\n']) for (const marker of ['```', '~~~']) for (const lang of ['yaml', 'yml']) {
		it(`retains literal code and native offsets: ${JSON.stringify({ prefix, ending, marker, lang })}`, () => {
			const code = ['service:', '  name: "local \u{1f642}"', '  enabled: true', '', 'tags:', '  - notes', '  - "> literal"'];
			const source = (intro + [marker + lang, ...code, marker].map(line => prefix + line).join('\n') + '\n\nAfter').replace(/\n/g, ending);
			const blocks = markdownFencedBlocks(source);
			expect(blocks).toHaveLength(1);
			expect(blocks[0].lang).toBe(lang);
			expect(blocks[0].lines.map(line => line.text)).toEqual(code);
			for (const line of blocks[0].lines) {
				expect(source.slice(line.from, line.from + line.text.length)).toBe(line.text);
				if (line.text) expect(line.from).toBe(source.indexOf(prefix + line.text) + prefix.length);
			}
			expect(source.slice(blocks[0].from, blocks[0].to)).toContain(marker + lang);
		});
	}
	it.each(['    ```yaml\n    key: value\n    ```', '<pre>\n```yaml\nkey: value\n```\n</pre>', '```yaml\nkey: value', '`literal ```yaml`'])('does not highlight a non-fence or unfinished block: %s', source => {
		expect(markdownFencedBlocks(source)).toEqual([]);
	});
	it('does not mistake shorter fences inside a longer block for new YAML', () => {
		const source = '````markdown\n```yaml\nkey: value\n```\n````';
		const blocks = markdownFencedBlocks(source);
		expect(blocks).toHaveLength(1); expect(blocks[0].lang).toBe('markdown');
		expect(blocks[0].lines.map(line => line.text).join('\n')).toBe('```yaml\nkey: value\n```');
	});
	it('keeps separate blocks distinct in a large mixed note', () => {
		const source = Array.from({ length: 1000 }, (_, n) => `## Section ${n}\n\n> [!note] Configuration\n>\n> \`\`\`yaml\n> key: value${n}\n> \`\`\`\n\n- [ ] Review\n`).join('\n');
		const blocks = markdownFencedBlocks(source);
		expect(blocks).toHaveLength(1000);
		expect(blocks[999].lines[0].text).toBe('key: value999');
	});
});
