import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { ensureSyntaxTree } from '@codemirror/language';
import type { EditorView } from '@codemirror/view';
import { escapeFencedCode, exitFencedCodeOnBlankLine } from './codeFenceEditing';
import { setCodeFenceParseWarning } from './codeFenceParseWarning';

vi.mock('@codemirror/language', async importOriginal => ({
	...await importOriginal<typeof import('@codemirror/language')>(),
	ensureSyntaxTree: vi.fn(() => null),
}));

function view(doc: string, cursor = doc.length, readOnly = false): EditorView {
	return { state: EditorState.create({ doc, selection: { anchor: cursor }, extensions: [markdown(), EditorState.readOnly.of(readOnly)] }), dispatch: vi.fn() } as unknown as EditorView;
}

afterEach(() => vi.clearAllMocks());

describe('bounded fenced-code parsing', () => {
	it('consumes an exhausted explicit escape without inserting a newline or scheduling a later jump', () => {
		const editor = view('```text\nkeep\n```', 12);
		const state = editor.state;
		expect(escapeFencedCode(editor)).toBe(true);
		expect(ensureSyntaxTree).toHaveBeenCalledWith(state, state.doc.length, 250);
		expect(editor.dispatch).not.toHaveBeenCalled();
		expect(editor.state).toBe(state);
		// The next normal insertion remains intact at the unchanged, announced caret.
		const next = state.update({ changes: { from: state.selection.main.head, insert: 'Typed afterward' } }).state;
		expect(next.doc.toString()).toBe('```text\nkeepTyped afterward\n```');
	});

	it.each(['```text\nkeep\n', '```text\nkeep\n\n```'])('does not fabricate a closing fence or swallow normal Enter after timeout: %j', doc => {
		const cursor = doc.endsWith('```') ? doc.lastIndexOf('\n```') : doc.length;
		const editor = view(doc, cursor);
		expect(exitFencedCodeOnBlankLine(editor)).toBe(false);
		expect(editor.dispatch).not.toHaveBeenCalled();
	});

	it('does not parse ordinary blank prose when its next nonempty line is not a fence', () => {
		expect(exitFencedCodeOnBlankLine(view('First\n\nSecond', 6))).toBe(false);
		expect(ensureSyntaxTree).not.toHaveBeenCalled();
	});

	it('does not mutate or parse a read-only editor', () => {
		const editor = view('```text\nkeep\n\n```', 13, true);
		expect(escapeFencedCode(editor)).toBe(false);
		expect(exitFencedCodeOnBlankLine(editor)).toBe(false);
		expect(ensureSyntaxTree).not.toHaveBeenCalled();
		expect(editor.dispatch).not.toHaveBeenCalled();
	});
});

describe('code escape warning', () => {
	it('uses inert accessible text and dismisses only its own notice on the next action', () => {
		class Element extends EventTarget {
			className = '';
			textContent = '';
			attributes = new Map<string, string>();
			children: Element[] = [];
			parent?: Element;
			ownerDocument: { createElement: () => Element } = { createElement: () => new Element() };
			setAttribute(name: string, value: string) { this.attributes.set(name, value); }
			appendChild(child: Element) { child.parent = this; this.children.push(child); }
			remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
		}
		const dom = new Element();
		const other = new Element(); other.textContent = 'Other status'; dom.appendChild(other);
		const editor = { dom } as unknown as EditorView;
		setCodeFenceParseWarning(editor, true);
		const warning = dom.children[1];
		expect(warning.attributes.get('role')).toBe('alert');
		expect(warning.textContent).toContain('The cursor has not moved');
		dom.dispatchEvent(new Event('keydown'));
		expect(dom.children).toEqual([other]);
		setCodeFenceParseWarning(editor, true);
		setCodeFenceParseWarning(editor, false);
		expect(dom.children).toEqual([other]);
	});
});
