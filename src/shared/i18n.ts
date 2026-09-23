/**
 * Tiny message catalog for the webviews.
 *
 * Webview bundles run in their own documents without access to the extension
 * host's localization API, so this module owns their US English strings.
 */

/** Every user-visible webview string, keyed by a stable identifier. */
const en = {
	'code.toggle.title': 'Code mode: show the Markdown source and edit it directly',
	'code.toggle.aria': 'Switch to code mode',
	'code.copy.title': 'Copy this code block',
	'code.copy.aria': 'Copy code block',
	'code.collapse.title': 'Collapse this code block ({0} lines)',
	'code.collapse.aria': 'Collapse code block',
	'code.expand.title': 'Expand this code block ({0} lines)',
	'code.expand.aria': 'Expand code block',

	'zoom.in': 'Zoom in (Ctrl+wheel also works)',
	'zoom.out': 'Zoom out',
	'zoom.reset': 'Reset the view (fit to width)',
	'zoom.toActual': 'Switch to actual size (drag to pan, Ctrl+wheel to zoom)',
	'zoom.toFit': 'Back to fitted view (scaled to the available width, no scrolling)',

	'page.prev': 'Previous page',
	'page.next': 'Next page',

	'drawio.loading': 'Loading {0}…',
	'drawio.loadFailed': 'Failed to load the draw.io file: {0}',
	'drawio.parseFailed': 'Could not parse the XML. Check the contents of the draw.io file.',
	'drawio.emptyXml': 'The XML is empty.',
	'drawio.readFailed': 'Could not read the file.',
	'drawio.compressed':
		'Compressed draw.io files are not supported. Turn off "Compress XML" in draw.io and save the file again.',
	'drawio.noDiagram': 'No draw.io diagram was found.',
	'drawio.parentDepthLimit': 'The draw.io parent chain exceeds the 100-level limit.',
	'drawio.pageLimit': 'The draw.io file exceeds the 100-page limit.',
	'drawio.cellLimit': 'A draw.io page exceeds the 20,000-cell limit.',
	'drawio.edgeLimit': 'A draw.io page exceeds the 10,000-edge limit.',
	'drawio.renderFailed': 'The draw.io diagram could not be rendered. Edit its source to correct it.',
	'drawio.noConnection': 'The connection to the host is not established yet.',
	'drawio.tooMany': 'Too many draw.io files are loading at once.',
	'drawio.timeout': 'The draw.io file request timed out.',
	'diagram.rendering': 'Rendering diagram…',
	'diagram.error': 'Diagram error: {0}',
	'diagram.renderFailed': 'The Mermaid diagram could not be rendered. Edit its source to correct it.',
	'math.invalid': 'Invalid math',
	'diagram.drawioInputLimit': 'draw.io diagram exceeds the 5 MiB text limit.',
	'diagram.drawioUnsafeXml': 'The draw.io diagram contains an unsafe XML declaration.',
	'diagram.mermaidInputLimit': 'Mermaid diagram exceeds the 100 KiB text limit.',
	'diagram.mermaidLineLimit': 'Mermaid diagram exceeds the 5,000 line limit.',
	'diagram.mermaidEdgeLimit': 'Mermaid diagram exceeds the 500 edge limit.',
	'diagram.svgSizeLimit': 'Rendered diagram exceeds the 2 MiB SVG limit.',
	'diagram.svgElementLimit': 'Rendered diagram exceeds the 50,000 element limit.',
	'diagram.invalidSvg': 'Diagram renderer returned invalid SVG.',
	'diagram.renderTimeout': 'rendering exceeded the 2 second limit',
	'diagram.tooMany': 'Too many Mermaid diagrams are waiting to render.',
	'drawio.xmlElementLimit': 'The draw.io diagram contains too many XML elements.',
	'drawio.xmlDepthLimit': 'The draw.io XML exceeds the 100-level nesting limit.',
	'mermaid.chunkMissing': 'Mermaid chunk URI was not provided by the host',
	'mermaid.registrationMissing': 'Mermaid chunk loaded but did not register itself',
	'mermaid.loadFailed': 'Failed to load the Mermaid bundle',
	'aws.uriMissing': 'AWS shape table URI was not provided by the host',
	'aws.loadFailed': 'Failed to load the AWS shape table ({0})',
	'yaml.depthLimit': 'YAML nesting exceeds the 32-level limit.',
	'yaml.nodeLimit': 'YAML exceeds the 5,000-node limit.',
	'yaml.inputLimit': 'YAML exceeds the 64 KiB input limit.',
	'yaml.invalid': 'YAML syntax is invalid.',
	'yaml.circularReference': 'YAML aliases must not form a circular reference.',
	'yaml.mappingRequired': 'YAML properties must use a key-value mapping.',
	'embed.renderLimit': 'Embedded Markdown exceeds the render limit.',
	'completion.line': 'Line {0}',
	'completion.aliases': 'Aliases: {0}',
	'completion.aliasFor': 'Alias for {0}',
	'footnote.goto': 'Go to footnote {0}',
	'footnote.return': 'Return to footnote reference {0}',

	'frontmatter.parseFailed': 'Could not parse the front matter',
	'property.true': 'True',
	'property.false': 'False',
	'property.edit': 'Edit {0}',
	'property.editHint': 'Press Enter or double-click to edit',
	'property.numberInvalid': 'Enter a valid number.',
	'property.listInvalid': 'Use commas between values and close every quote and wikilink.',
	'embed.loading': 'Loading embedded note…',
	'embed.cycle': 'Embedded note cycle blocked.',
	'embed.nestingLimit': 'Embed nesting limit reached.',
	'embed.readFailed': 'The embedded note could not be read.',
	'embed.openSource': 'Open embedded note {0}',
	'embed.hoverNested': 'Nested embeds are not expanded in hover previews.',
	'embed.noConnection': 'The connection to the host is not established yet.',
	'embed.tooMany': 'Too many embeds are loading at once.',
	'embed.timeout': 'The embedded note request timed out.',
	'image.noConnection': 'The connection to the host is not established yet.',
	'image.tooMany': 'Too many local images are loading at once.',
	'image.unavailable': 'The local image could not be loaded securely.',
	'image.timeout': 'The local image request timed out.',
	'imagePaste.unsupported': 'Only PNG, JPEG, GIF, WebP, and BMP images can be pasted or dropped.',
	'imagePaste.empty': 'The image is empty and was not added.',
	'imagePaste.tooMany': 'At most 32 images can be added in one operation.',
	'imagePaste.tooLarge': 'Images are limited to 20 MiB each and 40 MiB per operation.',
	'imagePaste.unreadable': 'The image data could not be read safely.',

	'table.addRow': 'Add a row',
	'table.addColumn': 'Add a column',
	'table.toolbar': 'Table editing controls',
	'table.scrollRegion': 'Markdown table; scroll horizontally for more columns',
	'table.options': 'Table options',
	'table.source': 'Show Markdown source',
	'table.optionsHint': 'Select a table cell to enable row and column actions.',
	'table.select': 'Select entire table',
	'table.insertRowAbove': 'Insert row above selected row',
	'table.insertRowBelow': 'Insert row below selected row',
	'table.deleteRow': 'Delete selected row',
	'table.moveRowUp': 'Move selected row up',
	'table.moveRowDown': 'Move selected row down',
	'table.deleteColumn': 'Delete selected column',
	'table.insertColumnLeft': 'Insert column left of selected column',
	'table.insertColumnRight': 'Insert column right of selected column',
	'table.moveColumnLeft': 'Move selected column left',
	'table.moveColumnRight': 'Move selected column right',
	'table.sortAscending': 'Sort rows ascending by selected column',
	'table.sortDescending': 'Sort rows descending by selected column',
	'table.cycleAlignment': 'Cycle selected column alignment',
	'task.markComplete': 'Mark task complete',
	'task.markIncomplete': 'Mark task incomplete',
	'callout.label': '{0} callout',

	'outline.empty': 'No headings.',
	'outline.untitled': '(untitled heading)',
	'outline.noDocument': 'Open a Markdown Live Preview document to see its headings here.',

	'sidebar.applied': 'Applied',
	'sidebar.editCss': 'Edit CSS',
	'sidebar.duplicate': 'Duplicate',
	'sidebar.rename': 'Rename',
	'sidebar.delete': 'Delete',
	'sidebar.settings': 'Settings',
	'sidebar.showWhitespace': 'Show spaces and line breaks (Live Preview)',
	'sidebar.showWhitespace.off': 'Off',
	'sidebar.showWhitespace.on': 'On',
	'sidebar.defaultEditor': 'Default viewing mode',
	'sidebar.defaultEditor.prompt': 'VS Code default',
	'sidebar.defaultEditor.textEditor': 'Text Editor',
	'sidebar.defaultEditor.markdownPreview': 'Markdown Preview',
	'sidebar.defaultEditor.vscodeMarkdownEditor': 'VS Code Markdown Editor',
	'sidebar.defaultEditor.markdownEditor': 'Markdown Editor',
	'sidebar.defaultEditor.livePreview': 'Markdown Live Preview',
	'sidebar.vaultOpenBehavior': 'Vault file tabs',
	'sidebar.vaultOpenBehavior.reuseTab': 'Reuse one preview tab',
	'sidebar.vaultOpenBehavior.newTab': 'Open each file in a new tab',
	'sidebar.defaultEditingMode': 'Default Live Preview mode',
	'sidebar.defaultEditingMode.editing': 'Editing',
	'sidebar.defaultEditingMode.locked': 'Locked',
	'editor.mode.editing': 'Editing: select to lock the editor',
	'editor.mode.locked': 'Locked: select to edit the document',
	'sidebar.codeTheme': 'Code palette',
	'sidebar.codeTheme.auto': 'Auto (follow VS Code)',
	'sidebar.cssThemes': 'CSS Themes',
	'sidebar.noStyles': 'No styles yet.',
	'sidebar.pickHint': 'Select a theme to apply it (only one can be active).',
	'sidebar.applyStyle': 'Apply CSS theme {0}',
	'sidebar.restrictedStyles': 'CSS themes are disabled in Restricted Mode. Trust this workspace to preview or change them.',
	'sidebar.newStyle': '+ New style',
	'css.unsafeIgnored': 'Unsafe CSS theme rules were ignored. Remove network, positioning, or extension-control rules to apply this theme.',

	// Sample copy shown inside the CSS-theme previews. It is translated so the
	// preview reads naturally, and because line height and letter spacing look
	// different in a script the reader actually uses.
	'sample.h1': 'Heading 1',
	'sample.h2': 'Heading 2',
	'sample.h3': 'Heading 3',
	'sample.body': 'Body text with {0}, {1}, {2}, {3} and a {4}.',
	'sample.bold': 'bold',
	'sample.italic': 'italic',
	'sample.strike': 'strikethrough',
	'sample.link': 'link',
	'sample.bullet1': 'Bullet 1',
	'sample.bullet2': 'Bullet 2',
	'sample.nested': 'Nested item',
	'sample.ordered1': 'Ordered 1',
	'sample.ordered2': 'Ordered 2',
	'sample.quote': 'An example blockquote.',
	'sample.quoteLong': 'An example blockquote — how a citation or a note looks.',
	'sample.paragraph2': 'Another paragraph, so you can judge line height and letter spacing.',
	'sample.taskDone': 'Completed task',
	'sample.taskTodo': 'Unfinished task',
	'sample.tableHeading': 'Table',
	'sample.codeHeading': 'Code block',
	'sample.colA': 'Column A',
	'sample.colB': 'Column B',
	'sample.colC': 'Column C',
	'sample.cell1': 'alpha',
	'sample.cell2': 'beta',
	'sample.belowRule': 'A paragraph below the horizontal rule.',
	'sample.comment': 'a comment',

	// Labels inside @codemirror/search's own panel, fed to it through
	// CodeMirror's `phrases` facet so the widget matches the rest of the UI.
	'search.find': 'Find',
	'search.replace': 'Replace',
	// The panel uses a capitalized "Replace" for the field's placeholder and a
	// lowercase "replace" for the button, so both are mapped.
	'search.replaceButton': 'replace',
	'search.next': 'next',
	'search.previous': 'previous',
	'search.all': 'all',
	'search.matchCase': 'match case',
	'search.regexp': 'regexp',
	'search.byWord': 'by word',
	'search.replaceAll': 'replace all',
	'search.close': 'close',
	'search.currentMatch': 'current match',
	'search.gotoLine': 'Go to line',
	'search.go': 'go',
	'search.onLine': 'on line',
	'search.toggleReplace': 'Toggle Replace',
};

/** A message key checked against the English catalog at compile time. */
export type MessageKey = keyof typeof en;

/**
 * Looks up `key`, substituting `{0}`, `{1}`, … with `args`.
 */
export function t(key: MessageKey, ...args: string[]): string {
	const template = en[key];
	return args.length === 0
		? template
		: template.replace(/\{(\d+)\}/g, (whole, index: string) => args[Number(index)] ?? whole);
}

/**
 * Escapes a value for interpolation into a double-quoted HTML attribute.
 *
 * Titles and host-generated values remain untrusted even in an English-only
 * interface, so they are escaped before entering HTML.
 */
export function escapeAttribute(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}
