import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { CompletionContext } from '@codemirror/autocomplete';
import { markdown } from '@codemirror/lang-markdown';
import { GFM } from './gfmTableFix';
import type { VaultNoteSummary } from '../shared/messages';
import { fragmentCompletionOptions, noteCompletionOptions, parseWikiImageSize, setVaultNotes, wikilinkCompletions } from './wikilinks';
import { resolveWikiLinkSummary } from '../vault/LinkResolver';

const notes: VaultNoteSummary[] = [
	{ path: 'Note.md', basename: 'Note', aliases: ['Primary'], headings: [], blockIds: [] },
	{ path: 'Folder/Other.md', basename: 'Other', aliases: ['Secondary'], headings: [], blockIds: [] },
	{ path: 'Archive/Note.md', basename: 'Note', aliases: ['Old Note'], headings: [], blockIds: [] },
];

describe('wikilink completion context', () => {
	function complete(doc: string) {
		setVaultNotes(notes);
		const state = EditorState.create({ doc, extensions: [markdown({ extensions: GFM })] });
		return wikilinkCompletions(new CompletionContext(state, doc.indexOf('[[No') + 4, true));
	}

	it.each(['```python\nvalue = [[No\n```', '`[[No`', '    [[No', '[link](https://example.test/[[No)', '[link](https://example.test/[[No]])', '![image [[No]]](image.png)', '![[No]](image.png)', '<div title="[[No">'])('keeps literal bracketed text out of note completion: %s', (doc) => {
		expect(complete(doc)).toBeNull();
	});

	it('still offers notes in paragraphs, lists, and quoted callouts', () => {
		for (const doc of ['See [[No', '- See [[No', '> [!note]\n> See [[No', 'Start [[No]]', 'Start ![[No]]', '- [[No]]', '> [!note]\n> [[No]]']) {
			expect(complete(doc)?.options.map(option => option.label)).toContain('Note');
		}
	});
});

describe('wikilink note completion options', () => {
	it('finds aliases and inserts the shortest unambiguous target with the alias', () => {
		const options = noteCompletionOptions('Prim', notes);
		expect(options[0]?.label).toBe('Primary');
		expect(options[0]?.detail).toContain('Note.md');
		expect(options[0]?.apply).toBeTypeOf('function');
		expect(resolveWikiLinkSummary('Note', notes)).toEqual({ kind: 'resolved', note: notes[0] });
	});

	it('finds a unique note by its folder path and offers the authored path', () => {
		const options = noteCompletionOptions('Folder/', notes);
		expect(options).toEqual(expect.arrayContaining([
			expect.objectContaining({ label: 'Folder/Other', displayLabel: 'Other' }),
		]));
	});

	it('uses paths for ambiguous basenames and rejects unsafe aliases', () => {
		const unsafe: VaultNoteSummary = {
			path: 'Unsafe.md', basename: 'Unsafe', aliases: ['bad|alias', 'bad\nline', 'Safe alias'], headings: [], blockIds: [],
		};
		expect(noteCompletionOptions('Note', notes).map((option) => option.label)).toEqual(expect.arrayContaining(['Note', 'Archive/Note', 'Old Note']));
		expect(noteCompletionOptions('Safe', [unsafe]).map((option) => option.label)).toContain('Safe alias');
		expect(noteCompletionOptions('bad', [unsafe])).toEqual([]);
	});

	it('bounds empty-query work for large vaults', () => {
		const many = Array.from({ length: 1_000 }, (_, index): VaultNoteSummary => ({
			path: `N${index}.md`, basename: `N${index}`, aliases: [], headings: [], blockIds: [],
		}));
		expect(noteCompletionOptions('', many)).toHaveLength(200);
		expect(noteCompletionOptions('N999', many).map((option) => option.label)).toContain('N999');
	});
});

describe('wikilink fragment completion options', () => {
	const largeNote: VaultNoteSummary = {
		path: 'Large.md', basename: 'Large', aliases: [],
		headings: Array.from({ length: 1_000 }, (_, index) => ({ text: `Heading ${index}`, line: index + 1 })),
		blockIds: Array.from({ length: 1_000 }, (_, index) => `block-${index}`),
	};

	it('bounds an empty heading or block query', () => {
		expect(fragmentCompletionOptions('heading', '', largeNote)).toHaveLength(200);
		expect(fragmentCompletionOptions('block', '', largeNote)).toHaveLength(200);
	});

	it('re-filters the full note so a later fragment remains discoverable', () => {
		expect(fragmentCompletionOptions('heading', '999', largeNote)).toEqual([
			expect.objectContaining({ label: 'Heading 999', detail: 'Line 1000' }),
		]);
		expect(fragmentCompletionOptions('block', '999', largeNote)).toEqual([
			expect.objectContaining({ label: 'block-999' }),
		]);
	});
});

describe('Obsidian wiki image dimensions', () => {
	it('accepts bounded width and width-by-height suffixes', () => {
		expect(parseWikiImageSize('320')).toEqual({ width: 320 });
		expect(parseWikiImageSize(' 320x180 ')).toEqual({ width: 320, height: 180 });
		expect(parseWikiImageSize('20X40')).toEqual({ width: 20, height: 40 });
	});

	it('rejects zero, excessive, fractional, signed, and non-dimension aliases', () => {
		for (const value of ['0', '4097', '20x0', '20x4097', '1.5', '-20', 'cover', '20x']) {
			expect(parseWikiImageSize(value)).toBeUndefined();
		}
	});
});
