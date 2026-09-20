import { describe, expect, it } from 'vitest';
import {
	FrontmatterLimitError,
	MAX_YAML_BYTES,
	MAX_YAML_DEPTH,
	parseFrontmatterYaml,
} from './frontmatterSecurity';

describe('bounded frontmatter parsing', () => {
	it('parses normal property values', () => {
		expect(parseFrontmatterYaml('title: Note\ntags: [one, two]')).toEqual({ title: 'Note', tags: ['one', 'two'] });
	});

	it('accepts an empty properties block', () => {
		expect(parseFrontmatterYaml('')).toEqual({});
		expect(parseFrontmatterYaml('  \n')).toEqual({});
	});

	it('rejects oversized input before parsing', () => {
		expect(() => parseFrontmatterYaml(`value: ${'x'.repeat(MAX_YAML_BYTES)}`)).toThrow(FrontmatterLimitError);
	});

	it('rejects deeply nested data', () => {
		const source = `value: { ${'next: { '.repeat(MAX_YAML_DEPTH + 2)}leaf: null${' }'.repeat(MAX_YAML_DEPTH + 2)} }`;
		expect(() => parseFrontmatterYaml(source)).toThrow(FrontmatterLimitError);
	});

	it('counts scalar sequence nodes rather than only container objects', () => {
		const source = `values:\n${'- x\n'.repeat(5_001)}`;
		expect(() => parseFrontmatterYaml(source)).toThrow(FrontmatterLimitError);
	});

	it('rejects cyclic aliases before widgets can stringify them', () => {
		expect(() => parseFrontmatterYaml('value: &self [*self]')).toThrow('YAML aliases must not form a circular reference.');
	});

	it('counts expanded aliases against the node limit', () => {
		const anchor = `[${Array.from({ length: 200 }, (_, index) => index).join(',')}]`;
		const aliases = Array.from({ length: 30 }, () => '*base').join(',');
		expect(() => parseFrontmatterYaml(`base: &base ${anchor}\nvalues: [${aliases}]`)).toThrow(FrontmatterLimitError);
	});

	it('requires a mapping root for typed properties', () => {
		expect(() => parseFrontmatterYaml('- one\n- two')).toThrow('YAML properties must use a key-value mapping.');
		expect(() => parseFrontmatterYaml('plain scalar')).toThrow('YAML properties must use a key-value mapping.');
	});

	it('rejects duplicate property keys without echoing their values', () => {
		const hostile = '<img src=x onerror=alert(1)>';
		expect(() => parseFrontmatterYaml(`value: safe\nvalue: "${hostile}"`)).toThrow('YAML syntax is invalid.');
		try {
			parseFrontmatterYaml(`value: safe\nvalue: "${hostile}"`);
		} catch (error) {
			expect(String(error)).not.toContain(hostile);
		}
	});

	it('does not echo hostile source in syntax errors', () => {
		const hostile = '<img src=x onerror=alert(1)>';
		expect(() => parseFrontmatterYaml(`[${hostile}`)).toThrow('YAML syntax is invalid.');
		try {
			parseFrontmatterYaml(`[${hostile}`);
		} catch (error) {
			expect(String(error)).not.toContain(hostile);
		}
	});
});
