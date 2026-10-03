// Synthetic notes for native QA; hostile samples use inert text and a reserved
// .invalid image URL that the default local-only policy must block.
const drawio = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" value="Review" vertex="1" parent="1"><mxGeometry x="20" y="20" width="140" height="60" as="geometry"/></mxCell></root></mxGraphModel>';
const table = rows => ['| Item | Status | Owner | Notes |', '| --- | --- | --- | --- |', ...Array.from({ length: rows }, (_, i) => `| Item ${i + 1} | ${i % 2 ? 'Ready' : 'Draft'} | Team ${i % 4} | <ul><li>First step</li><li>Second step</li></ul> |`)].join('\n');
const code = ['```javascript', 'function summarize(items) {', '  const active = items.filter(item => item.active);', '  const names = active.map(item => item.name);', '  const total = names.length;', '  if (total === 0) {', '    return "No active items";', '  }', '  return names.join(", ");', '}', 'console.log(summarize([]));', '```'].join('\n');
const objects = [
  '## Planning', 'A **bold** decision, *italic* note, ~~old text~~, ==highlight==, `inline code`, :smile:, and $x^2 + y^2 = z^2$.',
  '- Parent task\n  - Nested detail that wraps across a narrow editor and must retain its hanging indentation while it is edited.\n    - Third level\n- [ ] Review draft\n- [x] Confirm baseline',
  '> [!warning]+ Review gate\n> Keep all edits in this disposable vault.\n> - [ ] Approve the report\n>\n> > [!note]- Nested detail\n> > A hidden explanation.',
  '## Budget', table(14), '## Implementation', code,
  '```mermaid\nflowchart LR\nA[Draft] --> B{Review}\nB -->|Approved| C[Publish]\nB -->|Revise| A\n```',
  `\`\`\`drawio\n${drawio}\n\`\`\``,
  '## References', '[[Linked Note]] and [ordinary link](Linked%20Note.md). #qa/session\n\nA footnote[^evidence].\n\n[^evidence]: Local evidence only.',
  '$$\n\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}\n$$',
  '## Final notes', 'Final editing sentinel.'
].join('\n\n');

export const extensiveUiFixtures = {
  'Blank.md': '',
  'Properties.md': '---\ntitle: Property preservation\nsummary: |-\n  First line\n  Second line\noptional: null\nitems: ["first\\nsecond", simple]\n---\n\n# Properties\n\nKeep this body unchanged.\n',
  'Mixed Report.md': '---\ntitle: UI Review\nstatus: draft\npriority: 3\napproved: false\ntags: [qa, review]\n---\n\n# Mixed Report\n\n' + objects,
  'Linked Note.md': '# Linked Note\n\nA unique searchable keyword: cobalt-checkpoint.\n\n[[Mixed Report]]\n',
  'Large Report.md': '# Large Report\n\n' + Array.from({ length: 24 }, (_, i) => `# Review section ${i + 1}\n\n${objects.replaceAll('Final editing sentinel.', `Section ${i + 1} ending sentinel.`)}`).join('\n\n'),
  'Wide Tables.md': '# Wide Tables\n\n' + ['| ' + Array.from({ length: 16 }, (_, i) => `Column ${i + 1}`).join(' | ') + ' |', '| ' + Array(16).fill('---').join(' | ') + ' |', ...Array.from({ length: 60 }, (_, row) => '| ' + Array.from({ length: 16 }, (_, col) => `Row ${row + 1} value ${col + 1} — detailed information`).join(' | ') + ' |')].join('\n') + '\n\nAfter wide table.\n',
  'Safety Samples.md': '# Inert examples\n\n<script>alert("inert")</script>\n\n[Unsafe](javascript:alert(1))\n\n![Blocked tracking image](https://qa.invalid/pixel.png)\n\n```mermaid\nnot a valid graph\n```\n\n```drawio\n<broken\n```\n\nAfter rejected objects.\n',
  'Nested Search.md': Array.from({ length: 100 }, (_, i) => `## Earlier section ${i}\n\nA paragraph with **bold**, *emphasis*, a [local link](Other.md), and enough prose to wrap on a narrow screen.\n\n- Earlier entry ${i}\n  - Nested entry\n\n`).join('') + 'BEFORE_ANCHOR\n\n> [!warning]- Closed outer\n> Retained paragraph\n>\n> > [!tip]- Closed inner\n> > INNER_NEEDLE\n> > - [ ] Keep task\n>\n> Kept outer tail\n\nEND_ANCHOR',
};
