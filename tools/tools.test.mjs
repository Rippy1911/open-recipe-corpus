// node --test tools/*.test.mjs
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadContribTranslations, loadRelease, sha256 } from './data.mjs';
import { jpegHasGps, validate } from './validate.mjs';
import { photoQueue, translateQueue, writeStatus } from './work.mjs';

const R = (id, n, qid = null) => ({ id, source_lang: 'pl', canon_qid: qid, ingredients: [{ qty: 200, unit: 'g' }, { qty: null, unit: 'to_taste' }], step_count: n,
  provenance: { source: 'pl-wikibooks' } });
const T = (id, name, n) => ({ id, name, summary: `${name}.`, ingredients: [{ name: 'mąka' }, { name: 'sól', note: 'do smaku' }],
  steps: Array.from({ length: n }, (_, i) => `Krok ${i + 1}: gotuj 10 minut.`) });

/** A small release: three recipes in Polish, one of them in English; one AI dish image matched by QID. */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'orc-'));
  const w = (f, s) => { mkdirSync(join(root, f, '..'), { recursive: true }); writeFileSync(join(root, f), s); };
  const recipes = [R('plwb:1', 3), R('plwb:2', 2, 'Q100'), R('plwb:3', 4, 'Q200')];
  w('data/recipes.jsonl', recipes.map((r) => JSON.stringify(r)).join('\n') + '\n');
  w('data/text/pl.jsonl', [T('plwb:1', 'Zupa', 3), T('plwb:2', 'Placki', 2), T('plwb:3', 'Bigos', 4)].map((t) => JSON.stringify(t)).join('\n') + '\n');
  w('data/text/en.jsonl', JSON.stringify({ ...T('plwb:2', 'Pancakes', 2), steps: ['Step 1: cook 10 minutes.', 'Step 2: cook 10 minutes.'], machine_translated: true }) + '\n');
  w('data/sources.json', '[{"id":"pl-wikibooks"}]\n');
  w('manifest.json', JSON.stringify({ version: '0.1.0', corpus_revision: 'abc1234', generated_at: '2026-11-07T00:00:00Z' }));
  w('ai-images/bigos/1.json', JSON.stringify({ dish: 'Bigos', qid: 'Q200', ai_generated: true }));
  w('README.md', '# x\n<!-- status:start -->\nold\n<!-- status:end -->\nrest\n');
  return { root, w };
}
const line = (root, lang, id) => readFileSync(join(root, 'data', 'text', `${lang}.jsonl`), 'utf8').split('\n').find((l) => l.includes(`"${id}"`));
const translation = (root, over = {}) => ({
  id: 'plwb:2', lang: 'de', based_on: { lang: 'en', sha256: sha256(line(root, 'en', 'plwb:2')) },
  name: 'Pfannkuchen', summary: 'Pfannkuchen.', ingredients: [{ name: 'Mehl' }, { name: 'Salz', note: 'nach Geschmack' }],
  steps: ['Schritt 1: 10 Minuten kochen.', 'Schritt 2: 10 Minuten kochen.'], translator: { github: 'someone', model: null }, license: 'CC-BY-SA-4.0', ...over,
});

test('the current shape of a release validates clean', () => {
  const { root } = fixture();
  assert.deepEqual(validate(root), { errors: [], warnings: [] });
});

test('a good contributed translation passes; the queue then skips it', () => {
  const { root, w } = fixture();
  w('contrib/translations/de/plwb-2.json', JSON.stringify(translation(root)));
  assert.deepEqual(validate(root).errors, []);
  const q = translateQueue(loadRelease(root), loadContribTranslations(root), 'de');
  assert.deepEqual(q.map((x) => x.id), ['plwb:3', 'plwb:1']); // Wikidata-linked first, then fewer steps
  assert.equal(q[0].based_on.lang, 'pl'); // no English text, so from the source language
  assert.equal(q[0].based_on.sha256, sha256(line(root, 'pl', 'plwb:3')));
  assert.equal(q[0].file, 'contrib/translations/de/plwb-3.json');
});

test('a translation is checked against its recipe: lengths, names, licence, translator, file name', () => {
  const { root, w } = fixture();
  w('contrib/translations/de/plwb-2.json', JSON.stringify(translation(root, { steps: ['nur einer'], license: 'CC0-1.0', translator: { github: '' } })));
  w('contrib/translations/de/wrong.json', JSON.stringify(translation(root)));
  w('contrib/translations/deutsch/plwb-1.json', '{}');
  w('contrib/translations/en/plwb-1.json', '{}');
  const e = validate(root).errors.join('\n');
  for (const m of ['steps: 2 expected', 'license must be', 'translator.github', 'translator.model', 'is named plwb-2.json', 'ISO 639 language code', "en text comes from the maintainers' pipeline"]) assert.match(e, new RegExp(m));
});

test('text changed since, and numbers that differ, are warnings; a copy of the source is an error', () => {
  const { root, w } = fixture();
  w('contrib/translations/de/plwb-2.json', JSON.stringify(translation(root, { based_on: { lang: 'en', sha256: 'old' }, steps: ['Schritt 1: 12 Minuten kochen.', 'Schritt 2: 10 Minuten kochen.'] })));
  const v = validate(root);
  assert.deepEqual(v.errors, []);
  assert.match(v.warnings.join('\n'), /changed after this was translated/);
  assert.match(v.warnings.join('\n'), /steps\[0\] numbers differ/);
  w('contrib/translations/de/plwb-2.json', JSON.stringify(translation(root, { name: 'Pancakes', steps: ['Step 1: cook 10 minutes.', 'Step 2: cook 10 minutes.'] })));
  assert.match(validate(root).errors.join('\n'), /text unchanged, not a translation/);
});

test('a translation into a non-Latin language must be written in its script', () => {
  const { root, w } = fixture();
  w('contrib/translations/ru/plwb-2.json', JSON.stringify(translation(root, { lang: 'ru', name: 'Blinchiki' })));
  assert.match(validate(root).errors.join('\n'), /script ru is written in/);
  w('contrib/translations/ru/plwb-2.json', JSON.stringify(translation(root, { lang: 'ru', name: 'Блинчики', steps: ['Шаг 1: варить 10 минут.', 'Шаг 2: варить 10 минут.'] })));
  assert.deepEqual(validate(root).errors, []);
});

// A JPEG whose EXIF IFD0 has one entry: the GPS IFD pointer (tag 0x8825).
const gpsJpeg = () => {
  const tiff = Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0, 0, 0, 1, 0, 0x25, 0x88, 4, 0, 1, 0, 0, 0, 0x1a, 0, 0, 0, 0, 0, 0, 0]);
  const app1 = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const len = Buffer.alloc(2); len.writeUInt16BE(app1.length + 2);
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe1]), len, app1, Buffer.from([0xff, 0xd9])]);
};

test('photos: real, credited, licensed, for a recipe that exists, and without a GPS location', () => {
  const { root, w } = fixture();
  assert.equal(jpegHasGps(gpsJpeg()), true);
  assert.equal(jpegHasGps(Buffer.from([0xff, 0xd8, 0xff, 0xd9])), false);
  w('photos/plwb-1/1.jpg', gpsJpeg());
  w('photos/plwb-1/1.json', JSON.stringify({ author: 'A', license: 'CC-BY-4.0', ai_generated: true }));
  w('photos/plwb-9/1.json', JSON.stringify({ author: '', license: 'all rights reserved' }));
  w('photos/plwb-3/1.png', Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  w('photos/plwb-3/1.json', JSON.stringify({ author: 'B', license: 'CC0-1.0' }));
  w('photos/plwb-2/2.webp', Buffer.from('RIFF0000WEBP'));
  const e = validate(root).errors.join('\n');
  for (const m of ['GPS location', 'only real photographs', 'photos/plwb-9: no recipe', 'author', 'license must be', 'no image 1.webp', 'not the image type', 'no 2.json']) assert.match(e, new RegExp(m));
});

test('the photo queue leaves out recipes with a contributed photo or a matching AI image', () => {
  const { root, w } = fixture();
  w('photos/plwb-1/1.json', JSON.stringify({ author: 'A', license: 'CC0-1.0' }));
  assert.deepEqual(photoQueue(loadRelease(root), root).map((r) => r.id), ['plwb:2']); // plwb:3 matches the Bigos image by QID
});

test('status --write rewrites STATUS.md and only the marked README block', () => {
  const { root } = fixture();
  const n = writeStatus(root);
  assert.equal(n.recipes, 3);
  assert.deepEqual(n.languages.map((l) => [l.lang, l.released, l.machine]), [['pl', 3, 0], ['en', 1, 1]]);
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  assert.match(readme, /^# x\n<!-- status:start -->\n- \*\*3 recipes\*\* with 9 steps: \*\*3\*\* in `pl`, \*\*1\*\* in `en`\.[\s\S]*\n<!-- status:end -->\nrest\n$/);
  assert.match(readFileSync(join(root, 'STATUS.md'), 'utf8'), /\| `en` \| 1 \| 33 % \| 1 \|/);
});

test('status --write names the release in CITATION.cff, the same on every run', () => {
  const { root, w } = fixture();
  w('CITATION.cff', 'cff-version: 1.2.0\ntitle: x\nlicense: CC-BY-SA-4.0\nversion: "0.0.1"\nkeywords:\n  - a\n');
  writeStatus(root);
  const once = readFileSync(join(root, 'CITATION.cff'), 'utf8');
  assert.equal(once, 'cff-version: 1.2.0\ntitle: x\nlicense: CC-BY-SA-4.0\nversion: "0.1.0"\ndate-released: 2026-11-07\nkeywords:\n  - a\n');
  writeStatus(root);
  assert.equal(readFileSync(join(root, 'CITATION.cff'), 'utf8'), once);
});
