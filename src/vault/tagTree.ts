export interface TagTreeNode {
	segment: string;
	path: string;
	count: number;
	children: TagTreeNode[];
}

/** Builds an Obsidian-style nested tag tree with de-duplicated per-note counts. */
export function buildTagTree(records: ReadonlyArray<{ tags: readonly string[] }>): TagTreeNode[] {
	type MutableNode = { segment: string; path: string; notes: Set<number>; children: Map<string, MutableNode> };
	const roots = new Map<string, MutableNode>();
	for (let note = 0; note < records.length; note++) {
		for (const raw of new Set(records[note].tags)) {
			const parts = raw.split('/').map((part) => part.trim()).filter(Boolean);
			let children = roots;
			let path = '';
			for (const segment of parts) {
				path = path ? `${path}/${segment}` : segment;
				let node = children.get(segment);
				if (!node) {
					node = { segment, path, notes: new Set(), children: new Map() };
					children.set(segment, node);
				}
				node.notes.add(note);
				children = node.children;
			}
		}
	}
	const freeze = (nodes: Map<string, MutableNode>): TagTreeNode[] => [...nodes.values()]
		.sort((a, b) => a.segment.localeCompare(b.segment))
		.map((node) => ({ segment: node.segment, path: node.path, count: node.notes.size, children: freeze(node.children) }));
	return freeze(roots);
}
