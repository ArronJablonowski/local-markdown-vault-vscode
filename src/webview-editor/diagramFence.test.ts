import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { parser } from '@lezer/markdown';
import type { SyntaxNode } from '@lezer/common';
import { diagramFenceRange, diagramFenceText } from './diagramFence';

describe('nested diagram fences', () => {
	for (const prefix of ['', '  ', '> ', '> > ']) {
		it(`keeps code and blank lines without container prefixes ${JSON.stringify(prefix)}`, () => {
			const body = 'flowchart LR\n\n  A[Start] --> B[End]';
			const doc = (prefix === '  ' ? '- item\n\n' : '')
				+ ['```mermaid', ...body.split('\n'), '```'].map(line => prefix + line).join('\n');
			const state = EditorState.create({ doc });
			let fence: SyntaxNode | undefined;
			parser.parse(doc).iterate({ enter(node) { if (node.name === 'FencedCode') fence = node.node; } });
			expect(fence).toBeDefined();
			expect(diagramFenceText(state, fence!)).toBe(body);
			expect(diagramFenceRange(state, fence!)).toEqual({ from: doc.indexOf(prefix + '```'), to: doc.length });
		});
	}

	it('does not swallow a list marker sharing the opening fence line', () => {
		const doc = '- ```mermaid\n  flowchart LR\n  ```';
		const state = EditorState.create({ doc });
		const fence = parser.parse(doc).topNode.getChild('BulletList')!.getChild('ListItem')!.getChild('FencedCode')!;
		expect(diagramFenceRange(state, fence)).toBeNull();
	});
});
