import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { EditorState } from '@codemirror/state';
import {
	detectFrontmatter,
	formatPropertyListInput,
	parsePropertyListInput,
	updateFrontmatterProperty,
} from './frontmatterWidget';
import { MAX_YAML_BYTES } from './frontmatterSecurity';

function stateFor(text: string): EditorState {
	// Production forces LF as CodeMirror's separator so CRLF occupies the same
	// two UTF-16 offsets used by VS Code's TextDocument protocol.
	return EditorState.create({ doc: text, extensions: [EditorState.lineSeparator.of('\n')] });
}

// Domain generator (PBT-07): plain YAML-like body lines that never equal the
// closing "---" marker themselves — otherwise the property below would find
// a different (earlier) close than the one it constructed.
const bodyLine = fc.stringMatching(/^[a-zA-Z0-9_: ]*$/).filter((s) => s.trim() !== '---');

describe('detectFrontmatter', () => {
	it('returns null when the document does not start with a "---" line', () => {
		expect(detectFrontmatter(stateFor('# Hello\n\nBody text'))).toBeNull();
	});

	it('returns null for a single-line document (no closing marker possible)', () => {
		expect(detectFrontmatter(stateFor('---'))).toBeNull();
	});

	it('detects a minimal empty frontmatter block', () => {
		const range = detectFrontmatter(stateFor('---\n---\nbody'));
		expect(range).not.toBeNull();
		expect(range?.from).toBe(0);
		expect(range?.yamlText).toBe('');
		expect(range?.lineEnding).toBe('\n');
	});

	it('detects and updates CRLF properties without changing their line endings', () => {
		const state = stateFor('---\r\npublished: true\r\n---\r\nbody');
		const range = detectFrontmatter(state);
		expect(range?.lineEnding).toBe('\r\n');
		expect(range?.yamlText).toBe('published: true');
		expect(range?.rawText).toBe('---\r\npublished: true\r\n---\r');
		expect(updateFrontmatterProperty(range!.yamlText, 'published', false, range!.lineEnding))
			.toBe('---\r\npublished: false\r\n---');
	});

	it('stops detecting an oversized or unterminated properties block', () => {
		const oversized = EditorState.create({ doc: `---\nvalue: ${'x'.repeat(MAX_YAML_BYTES)}\n---\nbody` });
		expect(detectFrontmatter(oversized)).toBeNull();

		const unterminated = EditorState.create({ doc: `---\n${'\n'.repeat(MAX_YAML_BYTES)}body` });
		expect(detectFrontmatter(unterminated)).toBeNull();
	});

	it('extracts the exact YAML text between the markers (PBT-03 invariant)', () => {
		fc.assert(
			fc.property(fc.array(bodyLine, { minLength: 0, maxLength: 5 }), fc.string(), (lines, tail) => {
				const yaml = lines.join('\n');
				const doc = ['---', ...lines, '---', tail].join('\n');
				const state = stateFor(doc);
				const range = detectFrontmatter(state);
				expect(range).not.toBeNull();
				expect(range!.from).toBe(0);
				expect(range!.yamlText).toBe(yaml);
				// The detected range always ends exactly at the closing "---" line.
				const lastLineOfRange = state.doc.sliceString(range!.from, range!.to).split('\n').pop();
				expect(lastLineOfRange).toBe('---');
			}),
		);
	});

	it('returns null whenever the first line is not exactly "---" (PBT-03 invariant)', () => {
		fc.assert(
			fc.property(
				fc.string().filter((s) => s.trim() !== '---' && !s.includes('\n')),
				fc.array(bodyLine, { minLength: 1, maxLength: 3 }),
				(firstLine, rest) => {
					const doc = [firstLine, '---', ...rest, '---'].join('\n');
					expect(detectFrontmatter(stateFor(doc))).toBeNull();
				},
			),
		);
	});
});

describe('updateFrontmatterProperty', () => {
	it('updates a typed value while retaining ordinary YAML and comments', () => {
		const updated = updateFrontmatterProperty('# visible comment\npublished: true\npriority: 3', 'published', false);
		expect(updated).toContain('# visible comment');
		expect(updated).toContain('published: false');
		expect(updated).toContain('priority: 3');
		expect(updated.startsWith('---\n')).toBe(true);
		expect(updated.endsWith('\n---')).toBe(true);
	});
});

describe('typed property list editing', () => {
	it('round-trips commas inside wikilink aliases and quoted scalar values', () => {
		const original = ['[[Project|Plan, 2026]]', 'alpha,beta', 'plain'];
		const input = formatPropertyListInput(original);
		expect(input).toBe('[[Project|Plan, 2026]], "alpha,beta", plain');
		expect(parsePropertyListInput(input, original)).toEqual(original);
		expect(parsePropertyListInput('[[People/Bob|Bob\'s "plan", 2026]], next', ['old', 'next']))
			.toEqual(['[[People/Bob|Bob\'s "plan", 2026]]', 'next']);
	});

	it('preserves homogeneous numeric and boolean list types, including appended values', () => {
		expect(parsePropertyListInput('1, 2, 3', [1, 2])).toEqual([1, 2, 3]);
		expect(parsePropertyListInput('true, false, true', [true, false])).toEqual([true, false, true]);
		expect(parsePropertyListInput(formatPropertyListInput([null, 1]), [null, 1])).toEqual([null, 1]);
	});

	it('rejects malformed, unbounded, or type-changing input instead of corrupting YAML', () => {
		expect(parsePropertyListInput('[[Open, other', ['[[Old]]'])).toBeUndefined();
		expect(parsePropertyListInput('"open, other', ['old'])).toBeUndefined();
		expect(parsePropertyListInput('one, nope', [1, 2])).toBeUndefined();
		expect(parsePropertyListInput('x'.repeat(MAX_YAML_BYTES + 1), ['x'])).toBeUndefined();
	});
});
