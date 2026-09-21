/**
 * Tiny message catalog for the webviews.
 *
 * `package.nls.*.json` localizes the manifest, but it cannot reach strings that
 * live inside a webview bundle — those run in their own document, with no
 * access to the extension host's l10n API. So the host stamps its locale onto
 * `window.mlpLocale` (see the webview HTML), and this module picks the matching
 * catalog at import time.
 *
 * English is the source language and the fallback: a key missing from a
 * translation falls back to its English text rather than rendering blank.
 */

/** Every user-visible webview string, keyed by a stable identifier. */
const en = {
	'code.toggle.title': 'Code mode: show the Markdown source and edit it directly',
	'code.toggle.aria': 'Switch to code mode',
	'code.copy.title': 'Copy this code block',
	'code.copy.aria': 'Copy code block',

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
	'sidebar.defaultEditor': 'Default editor',
	'sidebar.defaultEditor.prompt': 'Normal editor (preview manually)',
	'sidebar.defaultEditor.livePreview': 'Always Live Preview',
	'sidebar.defaultEditor.default': 'Always the normal editor',
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

/** A message key. Translations are checked against this at compile time. */
export type MessageKey = keyof typeof en;

const ja: Record<MessageKey, string> = {
	'code.toggle.title': 'コードモード：Markdown ソースを表示して直接編集します',
	'code.toggle.aria': 'コードモードに切り替え',
	'code.copy.title': 'このコードブロックをコピーします',
	'code.copy.aria': 'コードブロックをコピー',

	'zoom.in': '拡大 (Ctrl+ホイールでも可)',
	'zoom.out': '縮小',
	'zoom.reset': '元の表示に戻す（縮小表示）',
	'zoom.toActual': '原寸大表示に切り替え（ドラッグでパン、Ctrl+ホイールでズームできます）',
	'zoom.toFit': '自動縮小表示に戻す（表示幅に合わせて縮小し、スクロールなしで全体を表示します）',

	'page.prev': '前のページ',
	'page.next': '次のページ',

	'drawio.loading': '{0} を読み込んでいます…',
	'drawio.loadFailed': 'draw.io の読み込みに失敗しました: {0}',
	'drawio.parseFailed': 'XML を解析できませんでした。draw.io ファイルの内容を確認してください。',
	'drawio.emptyXml': 'XML が空です。',
	'drawio.readFailed': 'ファイルを読み込めませんでした。',
	'drawio.compressed':
		'圧縮された draw.io ファイルには対応していません。draw.io で「XML を圧縮」を無効にして保存し直してください。',
	'drawio.noDiagram': 'draw.io の図が見つかりませんでした。',
	'drawio.parentDepthLimit': 'draw.io の親階層が 100 階層の上限を超えています。',
	'drawio.pageLimit': 'draw.io ファイルが 100 ページの上限を超えています。',
	'drawio.cellLimit': 'draw.io ページが 20,000 セルの上限を超えています。',
	'drawio.edgeLimit': 'draw.io ページが 10,000 エッジの上限を超えています。',
	'drawio.renderFailed': 'draw.io 図を描画できませんでした。ソースを編集して修正してください。',
	'drawio.noConnection': 'ホストへの接続がまだ確立していません。',
	'drawio.tooMany': '同時に読み込んでいる draw.io ファイルが多すぎます。',
	'drawio.timeout': 'draw.io ファイルの要求がタイムアウトしました。',
	'diagram.rendering': '図を描画しています…',
	'diagram.error': '図のエラー: {0}',
	'diagram.renderFailed': 'Mermaid 図を描画できませんでした。ソースを編集して修正してください。',
	'math.invalid': '数式が無効です',
	'diagram.drawioInputLimit': 'draw.io 図が 5 MiB のテキスト上限を超えています。',
	'diagram.drawioUnsafeXml': 'draw.io 図に安全でない XML 宣言が含まれています。',
	'diagram.mermaidInputLimit': 'Mermaid 図が 100 KiB のテキスト上限を超えています。',
	'diagram.mermaidLineLimit': 'Mermaid 図が 5,000 行の上限を超えています。',
	'diagram.mermaidEdgeLimit': 'Mermaid 図が 500 エッジの上限を超えています。',
	'diagram.svgSizeLimit': '描画された図が 2 MiB の SVG 上限を超えています。',
	'diagram.svgElementLimit': '描画された図が 50,000 要素の上限を超えています。',
	'diagram.invalidSvg': '図のレンダラーが無効な SVG を返しました。',
	'diagram.renderTimeout': '描画が 2 秒の制限時間を超えました',
	'diagram.tooMany': '描画待ちの Mermaid 図が多すぎます。',
	'drawio.xmlElementLimit': 'draw.io 図の XML 要素が多すぎます。',
	'drawio.xmlDepthLimit': 'draw.io XML が 100 階層の上限を超えています。',
	'mermaid.chunkMissing': 'ホストから Mermaid チャンク URI が提供されていません',
	'mermaid.registrationMissing': 'Mermaid チャンクは読み込まれましたが登録されませんでした',
	'mermaid.loadFailed': 'Mermaid バンドルを読み込めませんでした',
	'aws.uriMissing': 'ホストから AWS 図形テーブル URI が提供されていません',
	'aws.loadFailed': 'AWS 図形テーブルを読み込めませんでした（{0}）',
	'yaml.depthLimit': 'YAML が 32 階層の上限を超えています。',
	'yaml.nodeLimit': 'YAML が 5,000 ノードの上限を超えています。',
	'yaml.inputLimit': 'YAML が 64 KiB の入力上限を超えています。',
	'yaml.invalid': 'YAML の構文が無効です。',
	'yaml.circularReference': 'YAML エイリアスで循環参照を作ることはできません。',
	'yaml.mappingRequired': 'YAML プロパティはキーと値のマッピングで記述してください。',
	'embed.renderLimit': '埋め込み Markdown が描画上限を超えています。',
	'completion.line': '行 {0}',
	'completion.aliases': '別名: {0}',
	'completion.aliasFor': '{0} の別名',
	'footnote.goto': '脚注 {0} へ移動',
	'footnote.return': '脚注参照 {0} に戻る',

	'frontmatter.parseFailed': 'フロントマターの解析に失敗しました',
	'property.true': '真',
	'property.false': '偽',
	'property.edit': '{0} を編集',
	'property.editHint': 'Enter キーまたはダブルクリックで編集',
	'property.numberInvalid': '有効な数値を入力してください。',
	'property.listInvalid': '値をカンマで区切り、引用符と Wiki リンクをすべて閉じてください。',
	'embed.loading': '埋め込みノートを読み込んでいます…',
	'embed.cycle': '埋め込みノートの循環参照をブロックしました。',
	'embed.nestingLimit': '埋め込みの階層上限に達しました。',
	'embed.readFailed': '埋め込みノートを読み込めませんでした。',
	'embed.openSource': '埋め込みノート {0} を開く',
	'embed.hoverNested': 'ホバープレビューでは入れ子の埋め込みを展開しません。',
	'embed.noConnection': 'ホストへの接続がまだ確立されていません。',
	'embed.tooMany': '同時に読み込んでいる埋め込みが多すぎます。',
	'embed.timeout': '埋め込みノートの要求がタイムアウトしました。',
	'image.noConnection': 'ホストへの接続がまだ確立されていません。',
	'image.tooMany': '同時に読み込んでいるローカル画像が多すぎます。',
	'image.unavailable': 'ローカル画像を安全に読み込めませんでした。',
	'image.timeout': 'ローカル画像の要求がタイムアウトしました。',
	'imagePaste.unsupported': '貼り付けまたはドロップできる画像は PNG、JPEG、GIF、WebP、BMP のみです。',
	'imagePaste.empty': '画像が空のため追加されませんでした。',
	'imagePaste.tooMany': '一度に追加できる画像は最大 32 件です。',
	'imagePaste.tooLarge': '画像は1件あたり20 MiB、一度の操作全体で40 MiBまでです。',
	'imagePaste.unreadable': '画像データを安全に読み取れませんでした。',

	'table.addRow': '行を追加',
	'table.addColumn': '列を追加',
	'table.toolbar': '表編集コントロール',
	'table.insertRowAbove': '選択した行の上に行を挿入',
	'table.insertRowBelow': '選択した行の下に行を挿入',
	'table.deleteRow': '選択した行を削除',
	'table.moveRowUp': '選択した行を上へ移動',
	'table.moveRowDown': '選択した行を下へ移動',
	'table.deleteColumn': '選択した列を削除',
	'table.insertColumnLeft': '選択した列の左に列を挿入',
	'table.insertColumnRight': '選択した列の右に列を挿入',
	'table.moveColumnLeft': '選択した列を左へ移動',
	'table.moveColumnRight': '選択した列を右へ移動',
	'table.sortAscending': '選択した列で行を昇順に並べ替え',
	'table.sortDescending': '選択した列で行を降順に並べ替え',
	'table.cycleAlignment': '選択した列の配置を切り替え',
	'task.markComplete': 'タスクを完了にする',
	'task.markIncomplete': 'タスクを未完了にする',
	'callout.label': '{0} コールアウト',

	'outline.empty': '見出しがありません。',
	'outline.untitled': '(無題の見出し)',
	'outline.noDocument': 'Markdown Live Preview を開くと、ここに見出し一覧が表示されます。',

	'sidebar.applied': '適用中',
	'sidebar.editCss': 'CSSを編集',
	'sidebar.duplicate': '複製',
	'sidebar.rename': '名前を変更',
	'sidebar.delete': '削除',
	'sidebar.settings': '設定',
	'sidebar.defaultEditor': '既定エディタ',
	'sidebar.defaultEditor.prompt': '通常エディタ（手動でプレビュー）',
	'sidebar.defaultEditor.livePreview': '常にライブプレビュー',
	'sidebar.defaultEditor.default': '常に通常エディタ',
	'sidebar.codeTheme': 'コード配色',
	'sidebar.codeTheme.auto': '自動（VS Codeに追従）',
	'sidebar.cssThemes': 'CSSテーマ',
	'sidebar.noStyles': 'スタイルがまだありません。',
	'sidebar.pickHint': 'テーマを選択して適用（1つだけ選べます）。',
	'sidebar.applyStyle': 'CSSテーマ「{0}」を適用',
	'sidebar.restrictedStyles': '制限モードではCSSテーマは無効です。プレビューまたは変更するには、このワークスペースを信頼してください。',
	'sidebar.newStyle': '+ 新しいスタイル',
	'css.unsafeIgnored': '安全でないCSSテーマ規則は無視されました。このテーマを適用するには、ネットワーク、配置、または拡張機能コントロールの規則を削除してください。',

	'sample.h1': '見出し 1',
	'sample.h2': '見出し 2',
	'sample.h3': '見出し 3',
	'sample.body': '本文と{0}、{1}、{2}、{3}、そして{4}。',
	'sample.bold': '太字',
	'sample.italic': '斜体',
	'sample.strike': '取り消し線',
	'sample.link': 'リンク',
	'sample.bullet1': '箇条書き 1',
	'sample.bullet2': '箇条書き 2',
	'sample.nested': 'ネストした項目',
	'sample.ordered1': '番号付きリスト 1',
	'sample.ordered2': '番号付きリスト 2',
	'sample.quote': '引用ブロックの例。',
	'sample.quoteLong': '引用ブロックの例。出典やメモを引用するときの見た目です。',
	'sample.paragraph2': 'もう一つの段落。行間や字間の見え方を確認できます。',
	'sample.taskDone': '完了したタスク',
	'sample.taskTodo': '未完了のタスク',
	'sample.tableHeading': 'テーブル',
	'sample.codeHeading': 'コードブロック',
	'sample.colA': '列 A',
	'sample.colB': '列 B',
	'sample.colC': '列 C',
	'sample.cell1': 'あいうえお',
	'sample.cell2': 'かきくけこ',
	'sample.belowRule': '水平線の下の段落。',
	'sample.comment': 'コメント',

	'search.find': '検索',
	'search.replace': '置換',
	'search.replaceButton': '置換',
	'search.next': '次へ',
	'search.previous': '前へ',
	'search.all': 'すべて',
	'search.matchCase': '大文字と小文字を区別',
	'search.regexp': '正規表現',
	'search.byWord': '単語単位',
	'search.replaceAll': 'すべて置換',
	'search.close': '閉じる',
	'search.currentMatch': '現在の一致',
	'search.gotoLine': '行へ移動',
	'search.go': '移動',
	'search.onLine': '行',
	'search.toggleReplace': '置換の表示を切り替え',
};

const catalogs: Record<string, Partial<Record<MessageKey, string>>> = { ja };

/**
 * Resolves the catalog for a VS Code locale tag. Only the primary subtag is
 * significant, so "ja-JP" and "ja" pick the same catalog; anything without a
 * translation falls through to English.
 */
export function catalogFor(locale: string | undefined): Partial<Record<MessageKey, string>> {
	const primary = (locale ?? '').toLowerCase().split(/[-_]/)[0];
	return catalogs[primary] ?? {};
}

/** The locale the host stamped onto the webview document, if any. */
function hostLocale(): string | undefined {
	return typeof globalThis === 'undefined'
		? undefined
		: (globalThis as { mlpLocale?: string }).mlpLocale ??
		  (typeof document !== 'undefined' ? document.documentElement?.lang : undefined);
}

const active = catalogFor(hostLocale());

/**
 * Looks up `key`, substituting `{0}`, `{1}`, … with `args`.
 *
 * Falls back to the English text when the active catalog has no entry, so a
 * partial translation degrades to mixed language rather than to blanks.
 */
export function t(key: MessageKey, ...args: string[]): string {
	const template = active[key] ?? en[key];
	return args.length === 0
		? template
		: template.replace(/\{(\d+)\}/g, (whole, index: string) => args[Number(index)] ?? whole);
}

/**
 * Escapes a value for interpolation into a double-quoted HTML attribute.
 *
 * `vscode.env.language` is a well-formed tag in practice, but it reaches the
 * webview's `<html lang>` as untrusted input, so it is escaped rather than
 * trusted.
 */
export function escapeAttribute(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}
