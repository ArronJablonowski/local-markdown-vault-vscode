# Test Infrastructure — Original Detailed Design

Vitest ran `src/**/*.test.ts` in Node.js. Table tests created an `EditorState` with the production Markdown/GFM parser, completed the syntax tree synchronously, collected table row nodes, and passed them to the parsing helpers.

The original property checks covered:

- known CSS element-to-class conversions and preservation of unsupported content;
- front matter detection only at the document start with exact body extraction; and
- table-cell parse round trips, including empty cells and escaped pipes.

Syntax-tree timeouts failed tests explicitly, and fast-check shrinking remained enabled to report minimal failures and reproducible seeds.
