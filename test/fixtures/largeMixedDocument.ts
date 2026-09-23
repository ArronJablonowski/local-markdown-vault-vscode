/** Deterministic large notes: new combinations, without external resources. */
export function largeMixedDocument(sections: number): string {
	const parts = ['---\ntitle: Large mixed QA\napproved: false\npriority: 3\ntags: [qa, local]\n---\n\n# Large mixed QA\n'];
	for (let n = 0; n < sections; n++) {
		const id = String(n).padStart(4, '0');
		parts.push(`\n## Checkpoint ${id}\n\nParagraph ${id}: **bold** and *italic*, ~~old~~, ==marked==, \\*literal\\*, \`x|y\`, $x^2 + y^2$, prices $20 to $50, emoji \u{1F642}. [reference][qa-target]\n`);
		parts.push(Array.from({ length: 8 }, (_, j) => `\nParagraph ${id}.${j}: local notes combine **nested *emphasis*** with [local links](Target.md#details), [[Target|an alias]], #qa/mixed and ordinary punctuation. Nothing should change just from scrolling.\n`).join(''));
		parts.push(`\n- [ ] Task ${id}\n  - Child with **bold** text\n    - Grandchild\n- [x] Completed ${id}\n\n1. Ordered ${id}\n   1. Nested ordered\n2. Next item\n`);
		parts.push(`\n> [!warning]+ Review ${id}\n> Text and **formatting**.\n> - [ ] Nested task ${id}\n>\n> | Name | Value |\n> | --- | ---: |\n> | Cell ${id} | 42 |\n> | \`a\\|b\` | Line<br>Break |\n>\n> > [!tip] Inner note\n> > Keep this inside the callout.\n`);
		parts.push(`\n\`\`\`${n % 2 ? 'python' : 'typescript'}\n${Array.from({ length: n % 3 ? 9 : 40 }, (_, j) => `// Code ${id}, line ${j}: <b>literal text</b>`).join('\n')}\n\`\`\`\n`);
		if (n % 8 === 0) {
			parts.push('\n| ' + Array.from({ length: 12 }, (_, j) => `Column ${j}`).join(' | ') + ' |\n| ' + Array(12).fill('---').join(' | ') + ' |\n');
			parts.push(Array.from({ length: 20 }, (_, row) => '| ' + Array.from({ length: 12 }, (_, col) => `Wide ${id}-${row}-${col} readable content`).join(' | ') + ' |').join('\n') + '\n');
		}
		if (n % 16 === 0) parts.push(`\n\`\`\`mermaid\nflowchart LR\n A[Input ${id}] --> B{Valid?}\n B -->|Yes| C[Local save]\n B -->|No| D[Warning]\n\`\`\`\n\n\`\`\`drawio\n<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" value="Diagram ${id}" vertex="1" parent="1"><mxGeometry x="20" y="20" width="150" height="60" as="geometry"/></mxCell></root></mxGraphModel>\n\`\`\`\n`);
		parts.push(`\nFootnote ${id}.[^f${id}]\n\n[^f${id}]: Definition ${id} with **bold text**.\n\n---\n`);
	}
	parts.push('\n[qa-target]: Target.md\n\n## Final checkpoint\n\nFinal editable paragraph.\n');
	return parts.join('');
}
