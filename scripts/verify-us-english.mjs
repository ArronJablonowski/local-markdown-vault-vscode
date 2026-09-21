import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname } from 'node:path';

const textExtensions = new Set([
	'.css', '.html', '.js', '.json', '.md', '.mjs', '.svg', '.ts', '.txt', '.yaml', '.yml',
]);

const nonEnglishScripts = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af\u0400-\u04ff\u0590-\u05ff\u0600-\u06ff\u0900-\u097f\u0e00-\u0e7f]/u;
const reversedNonUsSpellings = [
	'ruoloc', 'sruoloc', 'ruoivaheb', 'sruoivaheb', 'noitasilacol', 'desilacol', 'esilacol',
	'ertnec', 'dertnec', 'ecnecil', 'eugolatac', 'yerg', 'dellecnac', 'gnillecnac', 'dellebal',
	'gnilledom', 'noitasimitpo', 'noitasirohtua', 'noitasitinas', 'noitasilamron',
	'noitasilaitini', 'noitasilaires', 'noitasilausiv', 'esingocer', 'esinagro', 'esylana',
];
const nonUsSpellings = new RegExp(`\\b(?:${reversedNonUsSpellings.map((word) => [...word].reverse().join('')).join('|')})\\b`, 'iu');

const listed = execFileSync('git', [
	'ls-files', '--cached', '--others', '--exclude-standard', '-z',
], { encoding: 'utf8' });

const paths = listed.split('\0').filter((path) => path && existsSync(path) && statSync(path).isFile());
const failures = [];

for (const path of paths) {
	if (/[^\x20-\x7e]/u.test(path)) {
		failures.push(`${path}: tracked and release-bound paths must use printable ASCII`);
	}
	if (!textExtensions.has(extname(path).toLowerCase())) continue;

	const lines = readFileSync(path, 'utf8').split(/\r?\n/u);
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];
		if (nonEnglishScripts.test(line)) {
			failures.push(`${path}:${index + 1}: contains a non-English script; use US English prose or escaped code points in Unicode tests`);
		}
		const spelling = nonUsSpellings.exec(line);
		if (spelling) {
			failures.push(`${path}:${index + 1}: use the US English spelling instead of "${spelling[0]}"`);
		}
	}
}

if (failures.length > 0) {
	console.error('US English repository verification failed:\n');
	for (const failure of failures) console.error(`- ${failure}`);
	process.exitCode = 1;
} else {
	console.log(`US English repository verification passed for ${paths.length} files.`);
}
