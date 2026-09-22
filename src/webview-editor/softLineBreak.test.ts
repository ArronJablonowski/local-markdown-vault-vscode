import { describe, expect, it } from 'vitest';
import { softLineBreakPrefix } from './softLineBreak';

describe('softLineBreakPrefix', () => {
	it('creates a plain continuation line outside lists', () => {
		expect(softLineBreakPrefix('Paragraph')).toBe('');
		expect(softLineBreakPrefix('    indented text')).toBe('    ');
	});

	it('aligns bullet continuations under their item text', () => {
		expect(softLineBreakPrefix('- Bullet item')).toBe('  ');
		expect(softLineBreakPrefix('  * Nested item')).toBe('    ');
	});

	it('aligns numbered continuations for the actual marker width', () => {
		expect(softLineBreakPrefix('1. Numbered item')).toBe('   ');
		expect(softLineBreakPrefix('12) Numbered item')).toBe('    ');
	});

	it('aligns task continuations without creating another checkbox', () => {
		expect(softLineBreakPrefix('- [ ] Task item')).toBe('      ');
		expect(softLineBreakPrefix('  - [x] Nested task')).toBe('        ');
	});

	it('keeps a blockquote continuation inside its quote', () => {
		expect(softLineBreakPrefix('> Quoted text')).toBe('> ');
		expect(softLineBreakPrefix('> - Quoted list item')).toBe('>   ');
	});
});
