// Add missing translations to a locale file: node scripts/i18n-add.mjs <locale.js> <entries.json>
// entries.json: { "Texto en español": ["english", "中文"], ... }. Keys already present are left as they are.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
const [file, entriesFile] = process.argv.slice(2);
const entries = JSON.parse(fs.readFileSync(entriesFile, 'utf8'));
const cur = (await import(pathToFileURL(file).href + '?t=' + Date.now())).default;
let src = fs.readFileSync(file, 'utf8');
const q = s => "'" + s.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
for (const [lang, idx] of [['en', 0], ['zh', 1]]) {
  const add = Object.entries(entries).filter(([k]) => !(cur[lang] && cur[lang][k])).map(([k, v]) => '    ' + q(k) + ': ' + q(v[idx]) + ',');
  if (!add.length) continue;
  const m = src.match(new RegExp('\\n  ' + lang + ': \\{\\r?\\n'));
  if (!m) throw new Error('no ' + lang + ' block in ' + file);
  const at = m.index + m[0].length;
  src = src.slice(0, at) + add.join('\n') + '\n' + src.slice(at);
  console.log(lang, '+', add.length);
}
fs.writeFileSync(file, src);
