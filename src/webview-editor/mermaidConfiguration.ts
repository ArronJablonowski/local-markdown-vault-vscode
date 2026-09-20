import type { MermaidConfig } from 'mermaid';

const PROTECTED_MERMAID_KEYS = [
	'secure',
	'securityLevel',
	'startOnLoad',
	'maxTextSize',
	'maxEdges',
	'htmlLabels',
] as const;

/**
 * Returns the non-negotiable Mermaid policy applied before every render.
 *
 * HTML labels are disabled because Mermaid constructs a temporary live DOM
 * while rendering. Sanitizing only the returned SVG is too late to prevent an
 * attacker-controlled `<img>` label from starting a request during that
 * temporary render, particularly when HTTPS note images are enabled.
 */
export function mermaidConfiguration(isDark: boolean): MermaidConfig {
	return {
		startOnLoad: false,
		securityLevel: 'strict',
		secure: [...PROTECTED_MERMAID_KEYS],
		maxTextSize: 100 * 1024,
		maxEdges: 500,
		htmlLabels: false,
		theme: isDark ? 'dark' : 'default',
		flowchart: { useMaxWidth: false },
		sequence: { useMaxWidth: false },
		class: { useMaxWidth: false },
		state: { useMaxWidth: false },
		er: { useMaxWidth: false },
		gantt: { useMaxWidth: false },
		journey: { useMaxWidth: false },
		pie: { useMaxWidth: false },
	};
}
