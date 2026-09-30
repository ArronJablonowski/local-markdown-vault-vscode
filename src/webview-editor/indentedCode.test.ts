import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { parser } from '@lezer/markdown';
import type { SyntaxNode } from '@lezer/common';
import { indentedCodeText } from './indentedCode';

describe('indented code clipboard text', () => {
	it.each([
		['    one();', 'one();'],
		['    one();\n        nested();\n\n    three();', 'one();\n    nested();\n\nthree();'],
		['\tone();\n\t\tnested();', 'one();\n\tnested();'],
		['>     one();\n>         nested();\n>\n>     three();', 'one();\n    nested();\n\nthree();'],
		['- Item\n\n      one();\n          nested();', 'one();\n    nested();'],
		['    <script>neverExecute()</script>\n    **literal** 😀', '<script>neverExecute()</script>\n**literal** 😀'],
	])('copies only code from %s', (source, expected) => {
		const state = EditorState.create({ doc: source });
		let code: SyntaxNode | undefined;
		parser.parse(source).iterate({ enter(node) { if (node.name === 'CodeBlock') code = node.node; } });
		expect(code).toBeDefined();
		expect(indentedCodeText(state, code!)).toBe(expected);
	});
});
