import { describe, expect, it } from 'vitest';
import { parseCalloutHeader } from './callouts';

describe('Obsidian callout headers', () => {
	it('parses titles and collapsed state', () => {
		expect(parseCalloutHeader('> [!note]- Details', 1)).toMatchObject({
			type: 'note', title: 'Details', collapsed: true,
		});
	});

	it('normalizes documented aliases', () => {
		expect(parseCalloutHeader('> [!faq]', 1)).toMatchObject({ type: 'question', title: 'Question' });
		expect(parseCalloutHeader('> [!caution]+ Watch', 1)).toMatchObject({ type: 'warning', title: 'Watch' });
		expect(parseCalloutHeader('> [!cite]', 1)).toMatchObject({ type: 'quote', title: 'Quote' });
	});

	it('assigns nested markers only to their matching blockquote depth', () => {
		expect(parseCalloutHeader('> > [!tip] Nested', 1)).toBeUndefined();
		expect(parseCalloutHeader('> > [!tip] Nested', 2)).toMatchObject({ type: 'tip', title: 'Nested' });
	});

	it('rejects malformed and excessively long types', () => {
		expect(parseCalloutHeader('> [!]', 1)).toBeUndefined();
		expect(parseCalloutHeader(`> [!${'a'.repeat(33)}]`, 1)).toBeUndefined();
	});
});
