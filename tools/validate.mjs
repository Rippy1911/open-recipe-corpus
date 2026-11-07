// Checks what people add to this repository, and the release itself. Node 22, no install. CI runs it on every pull
// request; run it yourself before you open one.
//
//   node tools/validate.mjs        photos/, contrib/ and data/
//
// Errors fail the check. Warnings are for the reviewer: a translation made from text that has changed since, a number
// that differs from the source, a translation that replaces a released one.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { dirs, filesIn, idToName, loadRelease, readJson, sha256 } from './data.mjs';

export const PHOTO_LICENSES = ['CC0-1.0', 'CC-BY-4.0', 'CC-BY-SA-4.0', 'public-domain']; // as api/scripts/build.mjs serves them
const IMAGE = /\.(webp|jpe?g|png)$/i;
const URL_RE = /https?:\/\/|www\./i;
const MB = 1024 * 1024;
// Polish and English are translated and checked in the maintainers' pipeline; contributions go to every other language.
export const PIPELINE_LANGS = ['pl', 'en'];

// Languages whose text is mostly in one non-Latin script. A translation into one of them must be, too.
const SCRIPT = {
  Cyrillic: ['ru', 'uk', 'bg', 'be', 'mk', 'sr', 'kk', 'ky', 'mn', 'tg'], Greek: ['el'], Hebrew: ['he', 'yi'],
  Arabic: ['ar', 'fa', 'ur', 'ps'], Devanagari: ['hi', 'mr', 'ne'], Bengali: ['bn'], Tamil: ['ta'], Telugu: ['te'],
  Thai: ['th'], Georgian: ['ka'], Armenian: ['hy'], Hangul: ['ko'], Han: ['zh'], Ethiopic: ['am'],
};
const scriptOf = (lang) => Object.entries(SCRIPT).find(([, ls]) => ls.includes(lang))?.[0] ?? (lang === 'ja' ? 'Japanese' : null);
const SCRIPT_RE = { Japanese: /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u };
/** Share of the letters in `s` that are in the script of `lang` (null when the language has no single non-Latin script listed). */
export function scriptShare(s, lang) {
  const sc = scriptOf(lang);
  if (!sc) return null;
  const letters = [...s].filter((ch) => /\p{L}/u.test(ch));
  if (!letters.length) return 0;
  const re = SCRIPT_RE[sc] ?? new RegExp(`\\p{Script=${sc}}`, 'u');
  return letters.filter((ch) => re.test(ch)).length / letters.length;
}
const digits = (s) => (String(s).match(/\d+(?:[.,]\d+)?/g) ?? []).map((d) => d.replace(',', '.')).sort().join(' ');

/** Whether a JPEG carries a GPS block in its EXIF (a photo's location, often the photographer's home). */
export function jpegHasGps(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return false;
  let p = 2;
  while (p + 4 <= buf.length && buf[p] === 0xff) {
    const marker = buf[p + 1], len = buf.readUInt16BE(p + 2);
    if (marker === 0xe1 && buf.toString('latin1', p + 4, p + 10) === 'Exif\0\0') {
      const t = p + 10, le = buf.toString('latin1', t, t + 2) === 'II';
      const u16 = (o) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o)), u32 = (o) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
      const ifd = t + u32(t + 4), n = u16(ifd);
      for (let i = 0; i < n; i++) if (u16(ifd + 2 + i * 12) === 0x8825) return true;
      return false;
    }
    if (marker === 0xda) return false; // start of scan: no more metadata segments
    p += 2 + len;
  }
  return false;
}
const magicOk = (buf, ext) => ({
  jpg: buf[0] === 0xff && buf[1] === 0xd8, jpeg: buf[0] === 0xff && buf[1] === 0xd8,
  png: buf.toString('latin1', 1, 4) === 'PNG', webp: buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP',
})[ext.toLowerCase()];

export function validate(root = '.') {
  const errors = [], warnings = [];
  const err = (f, m) => errors.push(`${f}: ${m}`), warn = (f, m) => warnings.push(`${f}: ${m}`);
  const rel = loadRelease(root);
  const byName = new Map([...rel.recipes.keys()].map((id) => [idToName(id), id]));

  // data/: what a release must hold together.
  for (const [lang, m] of Object.entries(rel.text)) {
    for (const [id, t] of m) {
      const r = rel.recipes.get(id), f = `data/text/${lang}.jsonl ${id}`;
      if (!r) { err(f, 'no such recipe in data/recipes.jsonl'); continue; }
      if (t.ingredients?.length !== r.ingredients.length) err(f, `${t.ingredients?.length} ingredients, the recipe has ${r.ingredients.length}`);
      if (t.steps?.length !== r.step_count) err(f, `${t.steps?.length} steps, the recipe has ${r.step_count}`);
    }
  }
  for (const r of rel.recipes.values()) if (!rel.text[r.source_lang]?.has(r.id)) err(`data/recipes.jsonl ${r.id}`, `no text in its source language ${r.source_lang}`);

  // photos/<recipe id, ":" as "-">/<n>.json + <n>.<webp|jpg|png>
  for (const d of dirs(join(root, 'photos'))) {
    const dir = `photos/${d}`;
    if (!byName.has(d)) err(dir, 'no recipe with this id in data/recipes.jsonl (the folder is the id with ":" as "-", e.g. plwb-9356)');
    const files = filesIn(join(root, 'photos', d), /./);
    for (const f of files) if (!/^\d+\.json$/.test(f) && !/^\d+\.(webp|jpe?g|png)$/i.test(f)) err(`${dir}/${f}`, 'only <n>.json and <n>.webp|jpg|png belong here');
    for (const f of files.filter((x) => /^\d+\.json$/.test(x))) {
      const n = f.slice(0, -5), img = files.find((x) => x.startsWith(`${n}.`) && IMAGE.test(x)), p = `${dir}/${f}`;
      let s;
      try { s = readJson(join(root, 'photos', d, f)); } catch (e) { err(p, `not JSON: ${e.message}`); continue; }
      if (!img) err(p, `no image ${n}.webp, ${n}.jpg or ${n}.png next to it`);
      if (typeof s.author !== 'string' || !s.author.trim()) err(p, 'author: who took the photo');
      if (!PHOTO_LICENSES.includes(s.license)) err(p, `license must be one of ${PHOTO_LICENSES.join(', ')}`);
      if (s.ai_generated !== undefined && s.ai_generated !== false) err(p, 'only real photographs go in photos/ (ai_generated must be false or absent)');
      if (s.source_url !== undefined && !/^https?:\/\//.test(s.source_url)) err(p, 'source_url must be an http(s) link');
      if (!img) continue;
      const file = join(root, 'photos', d, img), size = statSync(file).size, buf = readFileSync(file);
      if (!magicOk(buf, img.split('.').pop())) err(`${dir}/${img}`, 'the file is not the image type its name says');
      if (size > 5 * MB) err(`${dir}/${img}`, `${(size / MB).toFixed(1)} MB; keep it under about 1 MB`);
      else if (size > 1.5 * MB) warn(`${dir}/${img}`, `${(size / MB).toFixed(1)} MB; about 1 MB is enough`);
      if (jpegHasGps(buf)) err(`${dir}/${img}`, 'the photo carries a GPS location in its EXIF data; remove it (e.g. exiftool -gps:all= file.jpg)');
    }
    for (const f of files.filter((x) => IMAGE.test(x))) if (!files.includes(`${f.split('.')[0]}.json`)) err(`${dir}/${f}`, `no ${f.split('.')[0]}.json with its author and licence`);
  }

  // contrib/: translations waiting for a maintainer's check (CONTRIBUTING.md § Translate).
  for (const f of filesIn(join(root, 'contrib'), /./)) if (f !== 'README.md' && !dirs(join(root, 'contrib')).includes(f)) err(`contrib/${f}`, 'unexpected file');
  for (const d of dirs(join(root, 'contrib'))) if (d !== 'translations') err(`contrib/${d}`, 'only contrib/translations/ exists so far');
  for (const lang of dirs(join(root, 'contrib', 'translations'))) {
    const dir = `contrib/translations/${lang}`;
    if (!/^[a-z]{2,3}$/.test(lang)) { err(dir, 'the folder is an ISO 639 language code: 2 letters (de), or 3 when the language has no 2-letter code'); continue; }
    if (PIPELINE_LANGS.includes(lang)) { err(dir, `${lang} text comes from the maintainers' pipeline; report a mistake in it as an issue instead`); continue; }
    for (const f of filesIn(join(root, 'contrib', 'translations', lang), /./)) {
      const p = `${dir}/${f}`;
      if (!f.endsWith('.json')) { err(p, 'only <recipe id, ":" as "-">.json files belong here'); continue; }
      let t;
      try { t = readJson(join(root, 'contrib', 'translations', lang, f)); } catch (e) { err(p, `not JSON: ${e.message}`); continue; }
      const r = rel.recipes.get(t.id);
      if (!r) { err(p, `id ${JSON.stringify(t.id)}: no such recipe in data/recipes.jsonl`); continue; }
      if (f !== `${idToName(t.id)}.json`) err(p, `the file for ${t.id} is named ${idToName(t.id)}.json`);
      if (t.lang !== lang) err(p, `lang ${JSON.stringify(t.lang)} differs from its folder ${lang}`);
      const b = t.based_on ?? {}, src = rel.text[b.lang]?.get(t.id);
      if (!src) err(p, `based_on.lang: no released ${b.lang} text for ${t.id} to translate from`);
      else if (b.lang === lang) err(p, 'based_on.lang is the language you translate into');
      else if (b.sha256 !== sha256(rel.line[b.lang].get(t.id))) warn(p, `the ${b.lang} text changed after this was translated (based_on.sha256); check it against the current text`);
      if (rel.text[lang]?.has(t.id)) warn(p, `${t.id} is already released in ${lang}; this would replace that text`);
      if (typeof t.name !== 'string' || !t.name.trim()) err(p, 'name');
      if (src?.summary && (typeof t.summary !== 'string' || !t.summary.trim())) err(p, 'summary: the source has one');
      if (!Array.isArray(t.ingredients) || t.ingredients.length !== r.ingredients.length) err(p, `ingredients: ${r.ingredients.length} expected, in the source's order`);
      else t.ingredients.forEach((g, j) => {
        if (typeof g?.name !== 'string' || !g.name.trim()) err(p, `ingredients[${j}].name`);
        if (g?.note != null && typeof g.note !== 'string') err(p, `ingredients[${j}].note must be text or absent`);
      });
      if (!Array.isArray(t.steps) || t.steps.length !== r.step_count) err(p, `steps: ${r.step_count} expected, in the source's order`);
      else t.steps.forEach((s, j) => {
        if (typeof s !== 'string' || !s.trim()) return err(p, `steps[${j}] is empty`);
        if (URL_RE.test(s)) err(p, `steps[${j}] has a link`);
        if (src?.steps?.[j] != null && digits(s) !== digits(src.steps[j])) warn(p, `steps[${j}] numbers differ from the ${b.lang} text (${digits(src.steps[j]) || 'none'} vs ${digits(s) || 'none'})`);
      });
      const tr = t.translator ?? {};
      if (typeof tr.github !== 'string' || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(tr.github)) err(p, 'translator.github: your GitHub login');
      if (!(tr.model === null || (typeof tr.model === 'string' && tr.model.trim()))) err(p, 'translator.model: the exact model id that wrote it, or null when you wrote it yourself');
      if (t.license !== 'CC-BY-SA-4.0') err(p, 'license must be "CC-BY-SA-4.0", the licence of the data');
      if (src && Array.isArray(t.steps) && t.name === src.name && t.steps.every((s, j) => s === src.steps[j])) err(p, `this is the ${b.lang} text unchanged, not a translation`);
      const share = scriptShare([t.name, ...(Array.isArray(t.steps) ? t.steps : [])].join(' '), lang);
      if (share !== null && share < 0.6) err(p, `only ${Math.round(share * 100)} % of the letters are in the script ${lang} is written in`);
    }
  }
  return { errors, warnings };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!existsSync('data/recipes.jsonl')) { console.error('run from the repository root'); process.exit(2); }
  const { errors, warnings } = validate('.');
  for (const w of warnings) console.log(`warning ${w}`);
  for (const e of errors) console.log(`ERROR   ${e}`);
  console.log(`validate: ${errors.length} error(s), ${warnings.length} warning(s)`);
  process.exit(errors.length ? 1 : 0);
}
