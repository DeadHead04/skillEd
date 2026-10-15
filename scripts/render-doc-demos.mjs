// Render recorded production CLI output. This never simulates an engine or host UI.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const out = resolve('docs/public/demos');
const evidence = JSON.parse(await readFile(`${out}/evidence.json`, 'utf8'));
const records = Object.fromEntries(evidence.commands.map(record => [record.id, record]));
const esc = text => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const wrap = (text, limit = 75) => {
  const result = [];
  for (const line of text.split('\n')) {
    let rest = line;
    while (rest.length > limit) {
      const at = rest.lastIndexOf(' ', limit);
      const cut = at > limit / 2 ? at : limit;
      result.push(rest.slice(0, cut)); rest = rest.slice(cut).trimStart();
    }
    result.push(rest);
  }
  return result;
};
function command(record, output = record.stdout.trimEnd(), error = record.stderr.trimEnd()) {
  return [{ text: '$ ' + record.command, color: '#a6f0d2' },
    { text: output, color: '#e6ece9' }, ...(error ? [{ text: error, color: '#ffb6a4' }] : []),
    { text: `exit ${record.exitCode}`, color: record.exitCode ? '#ffb6a4' : '#a6f0d2' }];
}
async function render(name, title, description, sections, note) {
  const rows = sections.flatMap((section, index) => [...(index ? [{ text: '', color: '' }] : []), ...wrap(section.text).map(text => ({ text, color: section.color }))]);
  const height = 126 + rows.length * 31 + 52;
  const lines = rows.map((row, index) => `<text x="36" y="${115 + index * 31}" fill="${row.color || '#e6ece9'}">${esc(row.text)}</text>`).join('\n');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1040" height="${height}" viewBox="0 0 1040 ${height}" role="img" aria-labelledby="title desc">
<title id="title">${esc(title)}</title><desc id="desc">${esc(description)}</desc>
<rect x="1" y="1" width="1038" height="${height - 2}" rx="18" fill="#101817" stroke="#344b44"/>
<path d="M1 66h1038" stroke="#344b44"/>
<text x="36" y="42" fill="#b1c6bd" font-family="system-ui,sans-serif" font-size="17">${esc(title)}</text>
<text x="1004" y="42" text-anchor="end" fill="#91a99e" font-family="system-ui,sans-serif" font-size="13" letter-spacing="1">RECORDED CLI OUTPUT</text>
<g font-family="SFMono-Regular,Consolas,Liberation Mono,monospace" font-size="20">${lines}</g>
<text x="36" y="${height - 24}" fill="#91a99e" font-family="system-ui,sans-serif" font-size="14">${esc(note)}</text>
</svg>\n`;
  await writeFile(`${out}/${name}.svg`, svg);
}
await render('setup', '01 / Activate in your project', 'Real skilled setup and validation output. Existing evaluation suite loads 18 cases.', [
  ...command(records.setup), ...command(records.validate)
], 'Typeset transcript · absolute workspace path shortened to <project> · no model call');
const improvement = records.improvement.stdout.trim().split('\n');
await render('improvement', '02 / Verify the improvement', 'Real comparison: 18 matched cases, five improvements, zero regressions. Two changed cases shown.', command(records.improvement, [...improvement.slice(0, 2), '', ...improvement.filter(line => line.includes(' changed:')).slice(0, 2)].join('\n'), ''), 'Output excerpt · full case list and provenance warning in the linked transcript');
const regression = records.regression.stdout.trim().split('\n');
await render('regression', '03 / Catch a regression', 'Real comparison of a passing case against an intentionally broken Skill: one regression and exit code 1.', command(records.regression, [...regression.slice(0, 2), '', ...regression.filter(line => line.includes(' changed:'))].join('\n')), 'Replay of real reports · provenance warning omitted here; full transcript linked');
