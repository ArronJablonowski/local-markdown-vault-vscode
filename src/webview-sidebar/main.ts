import type { HostToSidebarMessage, SidebarSettings, SidebarToHostMessage, StyleEntry, ThemeKind } from '../shared/messages';
import { t } from '../shared/i18n';
import { validateHostToSidebarMessage } from '../shared/auxMessageValidation';
import { prepareSidebarPreviewCss } from '../shared/sidebarCss';

interface VsCodeApi {
	postMessage(message: unknown): void;
}
declare function acquireVsCodeApi(): VsCodeApi;
const api = acquireVsCodeApi();

function post(message: SidebarToHostMessage): void {
	api.postMessage(message);
}

const root = document.getElementById('mlp-sidebar-root')!;

// Small markdown-ish sample rendered (as real HTML) inside each preview's shadow
// root, so a theme's element selectors (h1, p, code, blockquote, …) apply to it
// exactly as they would in VS Code's Markdown preview.
const PREVIEW_SAMPLE = `
<h1>${t('sample.h1')}</h1>
<h2>${t('sample.h2')}</h2>
<p>${t(
	'sample.body',
	`<strong>${t('sample.bold')}</strong>`,
	`<em>${t('sample.italic')}</em>`,
	`<del>${t('sample.strike')}</del>`,
	'<code>inline code</code>',
	`<a href="#">${t('sample.link')}</a>`,
)}</p>
<ul><li>${t('sample.bullet1')}</li><li>${t('sample.bullet2')}</li></ul>
<blockquote>${t('sample.quote')}</blockquote>
<pre><code>function hello() {
  return 42;
}</code></pre>
<table><thead><tr><th>${t('sample.colA')}</th><th>${t('sample.colB')}</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>
`;

// A theme's CSS is authored for VS Code's Markdown preview, i.e. against a real
// `<body>` with `body.vscode-dark`/`.vscode-light` gates. In a shadow root there
// is no <body>, so remap `body` selectors to `:host` (the preview element),
// keeping their theme-class gates as `:host(.vscode-dark)` etc. Only the selector
// preludes at brace depth 0 are touched, so declaration values are left intact.
const ICONS: Record<string, string> = {
	edit: '<path d="M13.23 1.77a1.5 1.5 0 0 0-2.12 0l-8.9 8.9L1.5 14.5l3.83-.71 8.9-8.9a1.5 1.5 0 0 0 0-2.12l-1-1zM4.7 12.7l-1.4.26.26-1.4 6.16-6.16 1.14 1.14L4.7 12.7z"/>',
	duplicate: '<path d="M10 1H3a1 1 0 0 0-1 1v8h1.5V2.5H10V1zm3 3H6a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1zm-.5 9.5h-6v-8h6v8z"/>',
	rename: '<path d="M2 7h9v2H2V7zm0-4h12v2H2V3zm0 8h12v2H2v-2z"/>',
	delete: '<path d="M6 2h4v1h4v1.5H2V3h4V2zM3.5 5h9l-.7 9.1a1 1 0 0 1-1 .9H5.2a1 1 0 0 1-1-.9L3.5 5zm2.5 2v6h1V7H6zm3 0v6h1V7H9z"/>',
};

function iconButton(kind: keyof typeof ICONS, title: string, onClick: () => void): HTMLButtonElement {
	const btn = document.createElement('button');
	btn.className = 'mlp-action';
	btn.title = title;
	btn.setAttribute('aria-label', title);
	btn.innerHTML = `<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true">${ICONS[kind]}</svg>`;
	btn.addEventListener('click', (e) => {
		e.stopPropagation();
		onClick();
	});
	return btn;
}

function buildPreview(style: StyleEntry, themeKind: ThemeKind): HTMLElement {
	const preview = document.createElement('div');
	preview.className = `mlp-preview ${themeKind}`;
	// Inline-important host properties outrank any `:host(...) !important` rule
	// inside the theme's shadow stylesheet. This makes paint containment a real
	// boundary rather than one a high-specificity user selector can undo.
	preview.style.setProperty('overflow', 'hidden', 'important');
	preview.style.setProperty('contain', 'paint', 'important');
	preview.style.setProperty('isolation', 'isolate', 'important');
	const shadow = preview.attachShadow({ mode: 'open' });
	// `all:initial` on the host stops the sidebar's own font/color from leaking in,
	// so the theme has full control (the shadow tree still gets normal UA element
	// styles, giving unstyled tags sensible defaults). The doc wrapper only adds
	// padding — never font/color — so the theme's inherited text styles win.
	// `zoom` shrinks the whole sample so more than just the big <h1> is visible in
	// the short thumbnail, while keeping the theme's proportions intact. The
	// first child's top margin is dropped so the heading doesn't waste the top of
	// the thumbnail.
	const reset =
		':host{all:initial;display:block;}' +
		'.mlp-preview-doc{padding:8px 12px;box-sizing:border-box;zoom:0.6;}' +
		'.mlp-preview-doc>:first-child{margin-top:0 !important;}';
	const styleElement = document.createElement('style');
	// textContent is essential here: user CSS containing `</style>` must remain
	// CSS text rather than breaking out into attacker-controlled shadow DOM.
	styleElement.textContent = reset + prepareSidebarPreviewCss(style.css);
	const template = document.createElement('template');
	template.innerHTML = `<div class="mlp-preview-doc">${PREVIEW_SAMPLE}</div>`;
	shadow.append(styleElement, template.content.cloneNode(true));
	return preview;
}

function buildCard(style: StyleEntry, themeKind: ThemeKind): HTMLElement {
	const card = document.createElement('div');
	card.className = 'mlp-card' + (style.enabled ? ' mlp-card-selected' : '');

	const head = document.createElement('div');
	head.className = 'mlp-card-head';

	const radio = document.createElement('input');
	radio.type = 'radio';
	radio.name = 'mlp-css-theme';
	radio.className = 'mlp-radio';
	radio.checked = style.enabled;
	radio.setAttribute('aria-label', t('sidebar.applyStyle', style.name));
	const apply = (): void => {
		if (style.enabled) return;
		radio.checked = true;
		post({ type: 'toggle', id: style.id, enabled: true });
	};
	radio.addEventListener('click', (event) => event.stopPropagation());
	radio.addEventListener('change', () => { if (radio.checked) apply(); });

	const name = document.createElement('span');
	name.className = 'mlp-name';
	name.textContent = style.name;

	head.append(radio, name);

	if (style.enabled) {
		const badge = document.createElement('span');
		badge.className = 'mlp-badge';
		badge.textContent = t('sidebar.applied');
		head.appendChild(badge);
	}

	const actions = document.createElement('div');
	actions.className = 'mlp-actions';
	actions.append(
		iconButton('edit', t('sidebar.editCss'), () => post({ type: 'openStyle', id: style.id })),
		iconButton('duplicate', t('sidebar.duplicate'), () => post({ type: 'duplicateStyle', id: style.id })),
		iconButton('rename', t('sidebar.rename'), () => post({ type: 'renameStyle', id: style.id })),
		iconButton('delete', t('sidebar.delete'), () => post({ type: 'deleteStyle', id: style.id })),
	);
	head.appendChild(actions);

	card.appendChild(head);
	card.appendChild(buildPreview(style, themeKind));

	// Clicking a card applies this theme; clicking the already-applied one is a
	// no-op (there must always be exactly one theme active, so selection can't be
	// cleared this way — exclusive selection among the others is enforced by the host).
	card.addEventListener('click', () => {
		apply();
	});

	return card;
}

function buildSelect(
	label: string,
	value: string,
	options: Array<[string, string]>,
	onChange: (v: string) => void,
): HTMLElement {
	const wrap = document.createElement('label');
	wrap.className = 'mlp-field';
	const span = document.createElement('span');
	span.className = 'mlp-field-label';
	span.textContent = label;
	const select = document.createElement('select');
	select.className = 'mlp-select';
	for (const [val, text] of options) {
		const opt = document.createElement('option');
		opt.value = val;
		opt.textContent = text;
		if (val === value) opt.selected = true;
		select.appendChild(opt);
	}
	select.addEventListener('change', () => onChange(select.value));
	wrap.append(span, select);
	return wrap;
}

function buildSettings(settings: SidebarSettings): HTMLElement {
	const section = document.createElement('div');
	section.className = 'mlp-settings';

	const title = document.createElement('div');
	title.className = 'mlp-section-title';
	title.textContent = t('sidebar.settings');
	section.appendChild(title);
	section.appendChild(buildSelect(
		t('sidebar.showWhitespace'), settings.showWhitespace,
		[['off', t('sidebar.showWhitespace.off')], ['on', t('sidebar.showWhitespace.on')]],
		(value) => post({ type: 'setSetting', key: 'showWhitespace', value }),
	));

	section.appendChild(
		buildSelect(
			t('sidebar.defaultEditor'),
			settings.defaultEditor,
			[
				['prompt', t('sidebar.defaultEditor.prompt')],
				['textEditor', t('sidebar.defaultEditor.textEditor')],
				['markdownPreview', t('sidebar.defaultEditor.markdownPreview')],
				['vscodeMarkdownEditor', t('sidebar.defaultEditor.vscodeMarkdownEditor')],
				['markdownEditor', t('sidebar.defaultEditor.markdownEditor')],
				['livePreview', t('sidebar.defaultEditor.livePreview')],
			],
			(v) => post({ type: 'setSetting', key: 'defaultEditor', value: v }),
		),
	);
	section.appendChild(
		buildSelect(
			t('sidebar.vaultOpenBehavior'),
			settings.vaultOpenBehavior,
			[
				['reuseTab', t('sidebar.vaultOpenBehavior.reuseTab')],
				['newTab', t('sidebar.vaultOpenBehavior.newTab')],
			],
			(v) => post({ type: 'setSetting', key: 'vaultOpenBehavior', value: v }),
		),
	);
	section.appendChild(
		buildSelect(
			t('sidebar.defaultEditingMode'),
			settings.defaultEditingMode,
			[
				['editing', t('sidebar.defaultEditingMode.editing')],
				['locked', t('sidebar.defaultEditingMode.locked')],
			],
			(v) => post({ type: 'setSetting', key: 'defaultEditingMode', value: v }),
		),
	);
	section.appendChild(
		buildSelect(
			t('sidebar.codeTheme'),
			settings.codeTheme,
			[
				['auto', t('sidebar.codeTheme.auto')],
				['dark-plus', 'VS Code Dark+'],
				['light-plus', 'VS Code Light+'],
				['github-dark', 'GitHub Dark'],
				['github-light', 'GitHub Light'],
			],
			(v) => post({ type: 'setSetting', key: 'codeTheme', value: v }),
		),
	);

	return section;
}

function render(styles: StyleEntry[], settings: SidebarSettings, themeKind: ThemeKind, workspaceTrusted: boolean): void {
	root.innerHTML = '';

	const themesSection = document.createElement('div');
	themesSection.className = 'mlp-themes';

	const title = document.createElement('div');
	title.className = 'mlp-section-title';
	title.textContent = t('sidebar.cssThemes');
	themesSection.appendChild(title);

	if (!workspaceTrusted) {
		const restricted = document.createElement('p');
		restricted.className = 'mlp-hint';
		restricted.setAttribute('role', 'status');
		restricted.textContent = t('sidebar.restrictedStyles');
		themesSection.appendChild(restricted);
	} else if (styles.length === 0) {
		const empty = document.createElement('p');
		empty.className = 'mlp-empty';
		empty.textContent = t('sidebar.noStyles');
		themesSection.appendChild(empty);
	} else {
		const hint = document.createElement('p');
		hint.className = 'mlp-hint';
		hint.textContent = t('sidebar.pickHint');
		themesSection.appendChild(hint);

		const list = document.createElement('div');
		list.className = 'mlp-card-list';
		list.setAttribute('role', 'radiogroup');
		list.setAttribute('aria-label', t('sidebar.cssThemes'));
		for (const style of styles) {
			list.appendChild(buildCard(style, themeKind));
		}
		themesSection.appendChild(list);
	}

	if (workspaceTrusted) {
		const newButton = document.createElement('button');
		newButton.className = 'mlp-new-style';
		newButton.textContent = t('sidebar.newStyle');
		newButton.addEventListener('click', () => post({ type: 'newStyle' }));
		themesSection.appendChild(newButton);
	}

	// Settings on top, CSS themes at the bottom.
	root.appendChild(buildSettings(settings));
	root.appendChild(themesSection);
}

window.addEventListener('message', (event: MessageEvent<unknown>) => {
	const parsed = validateHostToSidebarMessage(event.data);
	if (parsed.ok && parsed.value.type === 'init') {
		render(parsed.value.styles, parsed.value.settings, parsed.value.themeKind, parsed.value.workspaceTrusted);
	}
});

post({ type: 'ready' });
