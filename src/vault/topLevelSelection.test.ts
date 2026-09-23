import { describe, expect, it } from 'vitest';
import { topLevelSelection } from './topLevelSelection';
describe('drag selection normalization', () => {
	it.each([
		[['Folder/', 'Folder/note.md'], ['Folder/']],
		[['Folder/note.md', 'Folder/'], ['Folder/']],
		[['Folder/', 'Folder/Child/', 'Folder/Child/note.md'], ['Folder/']],
		[['Folder/', 'Folderish/note.md'], ['Folder/', 'Folderish/note.md']],
		[['one.md', 'two.md'], ['one.md', 'two.md']],
		[['Space folder/', 'Space folder/child.md', 'Other/'], ['Space folder/', 'Other/']],
	])('does not flatten selected descendants: %j', (input, expected) => {
		expect(topLevelSelection(input, value => value.replace(/\/$/, ''), value => value.endsWith('/'))).toEqual(expected);
	});
});
