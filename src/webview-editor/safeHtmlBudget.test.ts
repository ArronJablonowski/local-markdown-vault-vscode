import { expect, it } from 'vitest';
import { htmlExceedsParseBudget } from './safeHtml';

it.each([
	'<ul><li>One<li>Two</ul>',
	'<ul><li>Outer<ul><li>Inner<li>More</ul><li>Next</ul>',
	'<div><p>One<p>Two</div>',
	'<div><p>One<h2>Next</h2></div>',
	'<table><tr><th>A<th>B<tr><td>C<td>D</table>',
	'<table><thead><tr><th>A<tbody><tr><td>B<tfoot><tr><td>C</table>',
])('allows bounded optional-end-tag HTML: %s', html => {
	expect(htmlExceedsParseBudget(html)).toBe(false);
});

it.each([
	'<div>'.repeat(65) + '</div>'.repeat(65),
	'<span>'.repeat(65) + '</span>'.repeat(65),
	'<div><p>'.repeat(65) + '</div>'.repeat(65),
	'<ul><li>'.repeat(65) + '</ul>'.repeat(65),
	'<div><span>Wrong close</div>',
	'<br>'.repeat(4_001),
])('retains nesting, mismatch, and token budgets: %s', html => {
	expect(htmlExceedsParseBudget(html)).toBe(true);
});
