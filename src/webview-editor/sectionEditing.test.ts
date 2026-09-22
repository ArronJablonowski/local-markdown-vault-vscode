import { describe, expect, it } from 'vitest';
import { isEmptySectionContinuation } from './sectionEditing';

describe('isEmptySectionContinuation', () => {
	it.each([
		'  ',
		'   ',
		'- ',
		'    - ',
		'2. ',
		'> ',
		'> > ',
		'> - ',
		'> - [ ] ',
		'- [x] ',
		'- [!] ',
	])('recognizes an empty structured continuation: %j', (line) => {
		expect(isEmptySectionContinuation(line)).toBe(true);
	});

	it.each(['', ' ', 'text', '- text', '> quoted text', '- [ ] task'])('preserves ordinary content: %j', (line) => {
		expect(isEmptySectionContinuation(line)).toBe(false);
	});
});
