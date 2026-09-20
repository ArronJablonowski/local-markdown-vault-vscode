import { describe, expect, it } from 'vitest';
import {
	assertDiagramInputWithinLimits,
	DiagramLimitError,
	MAX_DRAWIO_XML_CHARACTERS,
	MAX_MERMAID_CHARACTERS,
	MAX_MERMAID_EDGES,
} from './diagramSecurity';

describe('diagram input limits', () => {
	it('accepts ordinary Mermaid and draw.io diagrams', () => {
		expect(() => assertDiagramInputWithinLimits('mermaid', 'graph TD; A-->B')).not.toThrow();
		expect(() => assertDiagramInputWithinLimits('drawio', '<mxGraphModel/>')).not.toThrow();
	});

	it('rejects oversized Mermaid source', () => {
		expect(() => assertDiagramInputWithinLimits('mermaid', 'x'.repeat(MAX_MERMAID_CHARACTERS + 1))).toThrow(
			DiagramLimitError,
		);
	});

	it('rejects generated Mermaid edge bombs', () => {
		expect(() =>
			assertDiagramInputWithinLimits('mermaid', `graph TD;\n${'A-->B\n'.repeat(MAX_MERMAID_EDGES + 1)}`),
		).toThrow(DiagramLimitError);
	});

	it('rejects oversized draw.io XML', () => {
		expect(() => assertDiagramInputWithinLimits('drawio', 'x'.repeat(MAX_DRAWIO_XML_CHARACTERS + 1))).toThrow(
			DiagramLimitError,
		);
	});
});
