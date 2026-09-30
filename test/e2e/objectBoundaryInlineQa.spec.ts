import { test, expect, type Locator, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mountEditor } from './harness';

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
const obsidian = readFileSync(join(__dirname, '../../media/sample-styles/obsidian-dark.css'), 'utf8');
const before = 'Boundary before: retained observations stay separate from the following object.';
const after = 'Boundary after: rewrite this paragraph without changing neighboring evidence.';
const rewritten = 'Boundary after: reviewed **evidence** with independent *follow-up*.';
test.use({ screenshot: 'only-on-failure' });

// Seed large notes once; every subsequent content change comes from real keys.
function supportingText(minimumBytes: number): string {
	const sections: string[] = [];
	for (let i = 0, length = 0; length < minimumBytes; i++) {
		const section = `\n## Archive ${i}\n\nArchived finding ${i}: preserve **emphasis**, ==highlighting==, and $x^2$ while editing another section. `
			+ 'This long retained paragraph wraps while keeping all source bytes and unrelated evidence unchanged. '.repeat(7)
			+ `\n\n- Retained observation ${i}\n  - Supporting detail ${i}\n- [ ] Pending review ${i}\n\n`;
		sections.push(section); length += section.length;
	}
	return sections.join('');
}

async function source(page: Page, original: string): Promise<string> {
	return page.evaluate(initial => {
		for (const message of (window as any).__posted) if (message.type === 'edit') {
			for (const change of [...message.changes].reverse()) initial = initial.slice(0, change.from) + change.insert + initial.slice(change.to);
		}
		return initial;
	}, original);
}

async function find(page: Page, text: string): Promise<void> {
	await page.locator('.cm-content').focus();
	await page.keyboard.press(`${mod}+f`);
	await page.locator('.cm-search input[name="search"]').click();
	await page.keyboard.press(`${mod}+a`);
	await page.keyboard.type(text, { delay: 1 });
	await page.keyboard.press('Enter');
	await page.keyboard.press('Escape');
}

async function mouseSelect(page: Page, line: Locator, text: string): Promise<void> {
	await line.scrollIntoViewIfNeeded();
	const points = await line.evaluate((element, value) => {
		const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
		let node: Node | null;
		while ((node = walker.nextNode())) {
			const start = node.textContent!.indexOf(value);
			if (start < 0) continue;
			const range = document.createRange();
			range.setStart(node, start); range.setEnd(node, start + 1);
			const a = range.getBoundingClientRect();
			range.setStart(node, start + value.length - 1); range.setEnd(node, start + value.length);
			const b = range.getBoundingClientRect();
			return { x1: a.left, y1: a.top + a.height / 2, x2: b.right, y2: b.top + b.height / 2 };
		}
		throw new Error('Requested plain-text mouse target is not rendered');
	}, text);
	await page.mouse.move(points.x1, points.y1);
	await page.mouse.down();
	await page.mouse.move(points.x2, points.y2, { steps: 15 });
	await page.mouse.up();
	await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe(text);
}

async function watchLayout(page: Page): Promise<void> {
	await page.evaluate(() => {
		const frames: Array<{ top: number; height: number; width: number; overflow: number; className: string }> = [];
		(window as any).__boundaryFrames = frames;
		const sample = () => {
			const line = Array.from(document.querySelectorAll('.cm-line')).find(el => el.textContent?.startsWith('Boundary before:'));
			const scroller = document.querySelector('.cm-scroller')!;
			if (line) {
				const rect = line.getBoundingClientRect();
				frames.push({ top: rect.top, height: rect.height, width: rect.width, overflow: scroller.scrollWidth - scroller.clientWidth, className: line.className });
			}
			if (frames.length < 1000) requestAnimationFrame(sample);
		};
		requestAnimationFrame(sample);
	});
}

const longList = Array.from({ length: 45 }, (_, i) => `Detail${i}`).join(' ');
const cases = [
	{ name: 'nested callout', object: '> [!warning]+ Boundary review\n> Preserve the warning.\n>\n> > [!note]+ Inner review\n> > - [ ] Verify retained evidence', selector: '.mlp-callout-header', count: 2 },
	{ name: 'nested task list', object: `- Parent evidence\n  - ${longList}\n    - [ ] Boundary task\n- [x] Completed boundary task`, selector: '.cm-line:has-text("boundary task") .mlp-checkbox', count: 2 },
	{ name: 'heading', object: '### Boundary object heading', selector: '.mlp-line-h3', count: 1 },
	{ name: 'display math', object: '$$\na^2 + b^2 = c^2\n$$', selector: '.mlp-math-block', count: 1 },
	{ name: 'horizontal rule', object: '***', selector: '.mlp-hr', count: 1 },
] as const;

for (const themed of [false, true]) for (const scenario of cases) {
	test(`repeated boundary deletion and mouse redrafting around ${scenario.name}, theme=${themed}`, async ({ page }, info) => {
		test.setTimeout(120000);
		const errors: string[] = [];
		page.on('pageerror', error => errors.push(error.message));
		await page.setViewportSize({ width: 740, height: 1100 });
		const prefix = supportingText(themed ? 320_000 : 110_000);
		const original = prefix + before + '\n\n' + scenario.object + '\n\n' + after;
		await mountEditor(page, original, { css: themed ? obsidian : '' });
		await find(page, before);
		await page.keyboard.press('ArrowRight');
		await watchLayout(page);
		for (let cycle = 0; cycle < 3; cycle++) {
			// Delete each separator individually: the second press temporarily
			// turns the next block's opening syntax into ordinary paragraph text.
			await find(page, before);
			await page.keyboard.press('ArrowRight');
			await page.keyboard.press('Delete');
			await expect.poll(() => source(page, original)).toBe(prefix + before + '\n' + scenario.object + '\n\n' + after);
			await page.keyboard.press('Delete');
			await expect.poll(() => source(page, original)).toBe(prefix + before + scenario.object + '\n\n' + after);
			if (scenario.name === 'nested callout') {
				await expect(page.getByRole('button', { name: 'Boundary review callout', exact: true })).toHaveCount(0);
			} else if (scenario.name !== 'nested task list') {
				await expect(page.locator(scenario.selector)).toHaveCount(0);
			}
			await page.keyboard.press('Enter');
			await page.keyboard.press('Enter');
			await expect.poll(() => source(page, original)).toBe(original);
			await find(page, after);
			await page.keyboard.press('ArrowRight');
			await expect(page.locator(scenario.selector)).toHaveCount(scenario.count);
			await expect(page.locator('.cm-line', { hasText: before })).not.toHaveClass(/mlp-line-callout|mlp-line-list|mlp-line-h[1-6]|mlp-line-code/);
			await expect(page.locator('.cm-line', { hasText: after })).not.toHaveClass(/mlp-line-callout|mlp-line-list|mlp-line-h[1-6]|mlp-line-code/);
			await find(page, after);
			await page.keyboard.press('ArrowLeft');
			await page.keyboard.press('Backspace');
			await expect.poll(() => source(page, original)).toBe(prefix + before + '\n\n' + scenario.object + '\n' + after);
			await page.keyboard.press('Enter');
			await expect.poll(() => source(page, original)).toBe(original);
		}
		if (scenario.name === 'nested callout') {
			const button = page.getByRole('button', { name: 'Boundary review callout', exact: true });
			await button.click();
			await expect(button).toHaveAttribute('aria-expanded', 'false');
			await expect(page.getByRole('button', { name: 'Inner review callout', exact: true })).toHaveCount(0);
			await button.focus(); await page.keyboard.press('Enter');
			await expect(button).toHaveAttribute('aria-expanded', 'true');
		}
		if (scenario.name === 'nested task list') {
			const taskLine = page.locator('.cm-line', { hasText: /Boundary task$/ });
			const task = taskLine.locator('.mlp-checkbox');
			await task.click();
			await expect.poll(() => source(page, original)).toBe(original.replace('[ ] Boundary task', '[x] Boundary task'));
			await expect(taskLine).toHaveClass(/mlp-line-task-complete/);
			await task.click();
			await expect.poll(() => source(page, original)).toBe(original);
			const frames = await page.locator('.cm-line', { hasText: 'Detail0' }).evaluate(async element => {
				const measure = () => {
					const rows = new Map<number, number>();
					const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
					let node: Node | null;
					while ((node = walker.nextNode())) for (const token of node.textContent!.matchAll(/Detail\d+/g)) {
						const range = document.createRange();
						range.setStart(node, token.index!); range.setEnd(node, token.index! + 1);
						const rect = range.getBoundingClientRect(), top = Math.round(rect.top);
						rows.set(top, Math.min(rows.get(top) ?? Infinity, rect.left));
					}
					return { edges: [...rows.values()], indent: (element as HTMLElement).style.textIndent, padding: getComputedStyle(element).paddingLeft };
				};
				const result = [measure()];
				for (let frame = 0; frame < 12; frame++) {
					await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
					result.push(measure());
				}
				return result;
			});
			await info.attach('list-wrap-frames.json', { body: JSON.stringify(frames), contentType: 'application/json' });
			// Hanging-indent measurements write before paint, not synchronously
			// inside the checkbox transaction. Inspect every subsequent frame.
			for (const frame of frames.slice(1)) {
				expect(frame.edges.length).toBeGreaterThan(2);
				expect(Math.max(...frame.edges) - Math.min(...frame.edges), JSON.stringify(frames)).toBeLessThan(1.5);
			}
		}
		await find(page, after);
		await mouseSelect(page, page.locator('.cm-line', { hasText: after }), after);
		await page.keyboard.type(rewritten, { delay: 6 });
		await page.keyboard.type(' temporary', { delay: 6 });
		for (let i = 0; i < ' temporary'.length; i++) await page.keyboard.press('Backspace');
		await expect.poll(() => source(page, original)).toBe(original.replace(after, rewritten));
		await find(page, before);
		await expect(page.locator('.cm-line', { hasText: 'Boundary after:' }).locator('.mlp-strong')).toHaveText('evidence');
		await expect(page.locator('.cm-scroller')).toBeVisible();
		const frames = await page.evaluate(() => (window as any).__boundaryFrames as Array<{ top: number; width: number; height: number; overflow: number }>);
		expect(frames.length).toBeGreaterThan(10);
		expect(frames.every(frame => frame.width > 0 && frame.height > 0 && frame.overflow <= 2)).toBe(true);
		expect(frames.every(frame => frame.top > -1100 && frame.top < 2200)).toBe(true);
		await info.attach('boundary-frames.json', { body: JSON.stringify(frames), contentType: 'application/json' });
		await page.screenshot({ path: info.outputPath('boundary-redraft.png') });
		// Exercise host history routing; the browser harness records requests,
		// while the native QA owns real disk-backed Undo/Redo restoration.
		await page.keyboard.press(`${mod}+z`);
		await page.keyboard.press(`${mod}+Shift+z`);
		expect(await page.evaluate(() => (window as any).__posted.filter((m: any) => m.type === 'undo' || m.type === 'redo').map((m: any) => m.type))).toEqual(['undo', 'redo']);
		expect(errors).toEqual([]);
	});
}

for (const themed of [false, true]) test(`frontmatter closing boundary survives Delete and typed reconstruction, theme=${themed}`, async ({ page }, info) => {
	test.setTimeout(90000);
	const frontmatter = '---\ntitle: Boundary properties\napproved: false\npriority: 2\n---';
	const lead = 'First editable paragraph after the properties.';
	const original = frontmatter + '\n\n' + lead + '\n\n' + supportingText(themed ? 320_000 : 110_000);
	await mountEditor(page, original, { css: themed ? obsidian : '' });
	await find(page, lead);
	await page.keyboard.press('ArrowLeft');
	await page.keyboard.press('Backspace');
	await expect.poll(() => source(page, original)).toBe(original.replace(frontmatter + '\n\n', frontmatter + '\n'));
	await page.keyboard.press('Backspace');
	await expect.poll(() => source(page, original)).toBe(original.replace(frontmatter + '\n\n', frontmatter));
	await page.keyboard.press('Enter');
	await page.keyboard.press('Enter');
	await expect.poll(() => source(page, original)).toBe(original);
	await find(page, lead);
	await page.keyboard.press('ArrowRight');
	await expect(page.locator('.mlp-frontmatter')).toHaveCount(1);
	await mouseSelect(page, page.locator('.cm-line', { hasText: lead }), lead);
	await page.keyboard.type('New paragraph after retained properties.', { delay: 5 });
	await expect.poll(() => source(page, original)).toBe(original.replace(lead, 'New paragraph after retained properties.'));
	await page.screenshot({ path: info.outputPath('properties-boundary.png') });
});
