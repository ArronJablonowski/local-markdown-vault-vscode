import { parse as parseYaml } from 'yaml';
import { t } from '../shared/i18n';

export const MAX_YAML_BYTES = 64 * 1024;
export const MAX_YAML_ALIASES = 50;
export const MAX_YAML_NODES = 5_000;
export const MAX_YAML_DEPTH = 32;

export class FrontmatterLimitError extends Error {}

function countNode(counter: { nodes: number }): void {
	counter.nodes++;
	if (counter.nodes > MAX_YAML_NODES) throw new FrontmatterLimitError(t('yaml.nodeLimit'));
}

function inspectValue(value: unknown, depth: number, visiting: Set<unknown>, counter: { nodes: number }): void {
	countNode(counter);
	if (value === null || typeof value !== 'object') return;
	if (depth > MAX_YAML_DEPTH) throw new FrontmatterLimitError(t('yaml.depthLimit'));
	if (visiting.has(value)) throw new FrontmatterLimitError(t('yaml.circularReference'));
	visiting.add(value);
	if (Array.isArray(value)) {
		for (const item of value) inspectValue(item, depth + 1, visiting, counter);
		visiting.delete(value);
		return;
	}
	for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
		countNode(counter); // mapping keys are YAML nodes too
		inspectValue(item, depth + 1, visiting, counter);
	}
	visiting.delete(value);
}

/** Parses frontmatter with explicit anti-bomb limits and safe error messages. */
export function parseFrontmatterYaml(source: string): Readonly<Record<string, unknown>> {
	// UTF-8 is never shorter than the JavaScript code-unit count. Reject that
	// cheap lower bound first so a multi-megabyte frontmatter block cannot force
	// a second multi-megabyte allocation merely to discover that it is too large.
	if (source.length > MAX_YAML_BYTES || new TextEncoder().encode(source).byteLength > MAX_YAML_BYTES) {
		throw new FrontmatterLimitError(t('yaml.inputLimit'));
	}
	let value: unknown;
	try {
		value = parseYaml(source, { maxAliasCount: MAX_YAML_ALIASES });
	} catch (error) {
		if (error instanceof FrontmatterLimitError) throw error;
		// Parser diagnostics commonly include the source line. Do not reflect
		// attacker-controlled note text into an error widget.
		throw new Error(t('yaml.invalid'));
	}
	// An empty frontmatter block is valid and intentionally renders no rows.
	if (value === null && source.trim() === '') return {};
	inspectValue(value, 0, new Set(), { nodes: 0 });
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new FrontmatterLimitError(t('yaml.mappingRequired'));
	}
	return value as Readonly<Record<string, unknown>>;
}
