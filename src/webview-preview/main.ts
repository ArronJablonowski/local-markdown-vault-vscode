import type { HostToPreviewMessage, PreviewToHostMessage } from '../shared/messages';
import { t } from '../shared/i18n';
import { validateHostToPreviewMessage } from '../shared/auxMessageValidation';
import { stripNetworkedCss } from '../shared/cssAdapter';

interface VsCodeApi {
	postMessage(message: unknown): void;
}
declare function acquireVsCodeApi(): VsCodeApi;
const api = acquireVsCodeApi();

function post(message: PreviewToHostMessage): void {
	api.postMessage(message);
}

// A representative Markdown document (as real HTML) covering the elements a theme
// styles, so the author sees the full effect of their CSS as they type. Theme CSS
// is authored for VS Code's Markdown preview, i.e. against real <body>/<h1>/… —
// so it applies here directly, no adaptation needed.
const SAMPLE_HTML = `
<h1>${t('sample.h1')}</h1>
<p>${t(
	'sample.body',
	`<strong>${t('sample.bold')}</strong>`,
	`<em>${t('sample.italic')}</em>`,
	`<del>${t('sample.strike')}</del>`,
	`<code>inline code</code>`,
	`<a href="#">${t('sample.link')}</a>`,
)}</p>

<h2>${t('sample.h2')}</h2>
<p>${t('sample.paragraph2')}</p>

<blockquote>
	<p>${t('sample.quoteLong')}</p>
</blockquote>

<h3>${t('sample.h3')}</h3>
<ul>
	<li>${t('sample.bullet1')}</li>
	<li>${t('sample.bullet2')}
		<ul><li>${t('sample.nested')}</li></ul>
	</li>
</ul>
<ol>
	<li>${t('sample.ordered1')}</li>
	<li>${t('sample.ordered2')}</li>
</ol>

<ul class="contains-task-list">
	<li><input type="checkbox" checked disabled> ${t('sample.taskDone')}</li>
	<li><input type="checkbox" disabled> ${t('sample.taskTodo')}</li>
</ul>

<h3>${t('sample.tableHeading')}</h3>
<table>
	<thead><tr><th>${t('sample.colA')}</th><th>${t('sample.colB')}</th><th>${t('sample.colC')}</th></tr></thead>
	<tbody>
		<tr><td>1</td><td>${t('sample.cell1')}</td><td>x</td></tr>
		<tr><td>2</td><td>${t('sample.cell2')}</td><td>y</td></tr>
	</tbody>
</table>

<h3>${t('sample.codeHeading')}</h3>
<pre><code>function greet(name) {
  // ${t('sample.comment')}
  return \`Hello, \${name}!\`;
}
</code></pre>

<hr />
<p>${t('sample.belowRule')}</p>
`;

const themeStyle = document.getElementById('mlp-theme-style') as HTMLStyleElement;
const content = document.getElementById('mlp-preview-content')!;
content.innerHTML = SAMPLE_HTML;

const HL_CLASS = 'mlp-hl';
const THEME_KINDS = ['vscode-light', 'vscode-dark', 'vscode-high-contrast'];

function setThemeKind(kind: string): void {
	// Swap only the theme-kind class so a highlight on <body> (from a `body` rule)
	// isn't wiped when the CSS is re-pushed.
	document.body.classList.remove(...THEME_KINDS);
	document.body.classList.add(kind);
}

function clearHighlight(): void {
	document.querySelectorAll('.' + HL_CLASS).forEach((el) => el.classList.remove(HL_CLASS));
}

function tryQuery(selector: string): Element[] {
	try {
		// Query the whole document so `body`, `body.vscode-dark h1`, etc. resolve
		// against the real <body> (which carries the theme-kind class).
		return Array.from(document.querySelectorAll(selector));
	} catch {
		return []; // invalid/unsupported selector
	}
}

function applyHighlight(selector: string | null): void {
	clearHighlight();
	if (!selector) return;
	const sel = selector.trim();
	if (!sel || sel.startsWith('@')) return; // at-rule prelude — nothing to point at

	let els = tryQuery(sel);
	if (els.length === 0) {
		// The rule may be gated on the *other* theme mode (e.g. `body.vscode-dark h1`
		// while the preview is light). Retry with the `body.vscode-*` gate removed so
		// the author still sees which element the rule targets.
		const stripped = sel
			.split(',')
			.map((s) => s.replace(/\bbody(?:\.[-\w]+)*\s*/g, '').trim())
			.filter(Boolean)
			.join(', ');
		els = stripped ? tryQuery(stripped) : [document.body];
	}
	els.forEach((el) => el.classList.add(HL_CLASS));
}

window.addEventListener('message', (event: MessageEvent<unknown>) => {
	const parsed = validateHostToPreviewMessage(event.data);
	if (!parsed.ok) return;
	const message = parsed.value;
	if (message.type === 'update') {
		themeStyle.textContent = stripNetworkedCss(message.css);
		// The theme's `body.vscode-dark` / `.vscode-light` gates key off this class.
		setThemeKind(message.themeKind);
	} else if (message.type === 'highlight') {
		applyHighlight(message.selector);
	}
});

post({ type: 'ready' });
