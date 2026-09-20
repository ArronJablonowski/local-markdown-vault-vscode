import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { GFM } from '@lezer/markdown';
import { ensureSyntaxTree } from '@codemirror/language';
import { escapeTable, selectDroppedImageFiles } from './imagePasteHandler';
import { MAX_PASTED_IMAGE_BYTES, MAX_PASTED_IMAGE_COUNT } from '../shared/messageValidation';

function stateFor(text: string): EditorState {
	const state = EditorState.create({ doc: text, extensions: [markdown({ extensions: GFM })] });
	const tree = ensureSyntaxTree(state, state.doc.length, 5000);
	if (!tree) throw new Error('syntax tree did not finish parsing in time');
	return state;
}

describe('escapeTable', () => {
	it('leaves a position inside a normal paragraph unchanged', () => {
		const text = 'Hello world.\n\nMore text.';
		const state = stateFor(text);
		const pos = text.indexOf('world');
		expect(escapeTable(state, pos)).toEqual({ pos, needsOwnParagraph: false });
	});

	it('relocates a position inside a table cell to just after the table (regression: pasting an image into a table cell)', () => {
		const text = '| a | b |\n| --- | --- |\n| 1 | 2 |\n\nAfter.';
		const state = stateFor(text);
		const tableEnd = text.indexOf('\n\nAfter.');
		const posInsideCell = text.indexOf('2');
		expect(escapeTable(state, posInsideCell)).toEqual({ pos: tableEnd, needsOwnParagraph: true });
	});

	it('relocates a position in the table header row too', () => {
		const text = '| a | b |\n| --- | --- |\n| 1 | 2 |\n\nAfter.';
		const state = stateFor(text);
		const tableEnd = text.indexOf('\n\nAfter.');
		const posInHeader = text.indexOf('a');
		expect(escapeTable(state, posInHeader)).toEqual({ pos: tableEnd, needsOwnParagraph: true });
	});

	it('leaves a position right after a table unchanged', () => {
		const text = '| a | b |\n| --- | --- |\n| 1 | 2 |\n\nAfter.';
		const state = stateFor(text);
		const pos = text.indexOf('After');
		expect(escapeTable(state, pos)).toEqual({ pos, needsOwnParagraph: false });
	});
});

function fileList(files: File[]): FileList {
	return Object.assign([...files], { item: (index: number) => files[index] ?? null }) as unknown as FileList;
}

function file(type: string, size: number): File {
	return { type, size } as File;
}

describe('selectDroppedImageFiles', () => {
	it('keeps every supported image in source order and ignores non-images', () => {
		const first = file('image/png', 10);
		const second = file('image/jpeg', 20);
		expect(selectDroppedImageFiles(fileList([first, file('text/plain', 5), second]))).toEqual({
			kind: 'valid',
			files: [first, second],
		});
	});

	it('distinguishes a non-image drop from an invalid image batch', () => {
		expect(selectDroppedImageFiles(fileList([file('text/plain', 5)]))).toEqual({ kind: 'none' });
		expect(selectDroppedImageFiles(fileList([file('image/svg+xml', 5)]))).toEqual({
			kind: 'invalid',
			reason: 'unsupported',
		});
		expect(selectDroppedImageFiles(fileList([file('image/png', 0)]))).toEqual({
			kind: 'invalid',
			reason: 'empty',
		});
		expect(selectDroppedImageFiles(fileList([file('image/png', MAX_PASTED_IMAGE_BYTES + 1)]))).toEqual({
			kind: 'invalid',
			reason: 'tooLarge',
		});
		expect(selectDroppedImageFiles(fileList(
			Array.from({ length: MAX_PASTED_IMAGE_COUNT + 1 }, () => file('image/png', 1)),
		))).toEqual({ kind: 'invalid', reason: 'tooMany' });
	});

	it('rejects unsafe file-size metadata before attempting to read it', () => {
		expect(selectDroppedImageFiles(fileList([file('image/png', Number.NaN)]))).toEqual({
			kind: 'invalid',
			reason: 'unreadable',
		});
		expect(selectDroppedImageFiles(fileList([file('image/png', -1)]))).toEqual({
			kind: 'invalid',
			reason: 'unreadable',
		});
	});
});
