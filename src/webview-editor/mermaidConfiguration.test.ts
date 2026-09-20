import { describe, expect, it } from 'vitest';
import { mermaidConfiguration } from './mermaidConfiguration';

describe('Mermaid configuration', () => {
	it('protects strict, bounded, network-inert rendering settings', () => {
		const config = mermaidConfiguration(false);
		expect(config).toMatchObject({
			securityLevel: 'strict',
			startOnLoad: false,
			maxTextSize: 100 * 1024,
			maxEdges: 500,
			htmlLabels: false,
			theme: 'default',
		});
		expect(config.secure).toEqual(expect.arrayContaining([
			'secure', 'securityLevel', 'startOnLoad', 'maxTextSize', 'maxEdges', 'htmlLabels',
		]));
	});

	it('changes only the bundled color theme for dark surfaces', () => {
		expect(mermaidConfiguration(true)).toEqual({ ...mermaidConfiguration(false), theme: 'dark' });
	});
});
