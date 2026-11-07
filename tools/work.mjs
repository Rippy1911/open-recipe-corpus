// What needs doing, read from the files in this repository. Node 22, no install. WORK.md explains each track.
//
//   node tools/work.mjs                                  a summary of every track
//   node tools/work.mjs translate <lang> [--from en|pl]  the next recipes to translate into <lang>
//   node tools/work.mjs photos                           recipes with no picture at all
//   node tools/work.mjs status [--write]                 the numbers; --write rewrites STATUS.md and the README block
//
// Lists take --n <count> (default 25), --offset <k> (skip k, to take a different slice from someone else) and --json.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PIPELINE_LANGS } from './validate.mjs';
import { aiDishes, dirs, filesIn, hasPicture, idToName, loadContribTranslations, loadRelease, photoIds, readJson, sha256 } from './data.mjs';

const fmt = (n) => n.toLocaleString('en-US');
const pct = (a, b) => (b ? `${Math.round((100 * a) / b)} %` : '–');

/** Recipes in work order: linked to a Wikidata dish first (the dishes people look for), then fewer steps, then id. */
export function workOrder(recipes) {
  return [...recipes].sort((a, b) => (b.canon_qid ? 1 : 0) - (a.canon_qid ? 1 : 0) || a.step_count - b.step_count || a.id.localeCompare(b.id));
}

/** The next recipes to translate into `lang`: not released in it, not already waiting in contrib/. */
export function translateQueue(rel, contrib, lang, from = null) {
  const done = rel.text[lang] ?? new Map(), waiting = contrib[lang] ?? new Map();
  const out = [];
  for (const r of workOrder(rel.recipes.values())) {
    if (done.has(r.id) || waiting.has(r.id)) continue;
    // From the language asked for, else English when the recipe has it, else its source language.
    const f = from ?? (rel.text.en?.has(r.id) ? 'en' : r.source_lang);
    if (f === lang || !rel.text[f]?.has(r.id)) continue;
    out.push({ id: r.id, file: `contrib/translations/${lang}/${idToName(r.id)}.json`, steps: r.step_count,
      based_on: { lang: f, sha256: sha256(rel.line[f].get(r.id)) }, source: rel.text[f].get(r.id) });
  }
  return out;
}

/** Recipes with no contributed photo and no AI dish image. */
export function photoQueue(rel, root) {
  const photos = photoIds(root), ai = aiDishes(root);
  return workOrder(rel.recipes.values()).filter((r) => !hasPicture(r, rel, photos, ai));
}

const nameOf = (rel, id) => rel.text.en?.get(id)?.name ?? Object.values(rel.text).find((m) => m.has(id))?.get(id).name ?? '';

/** Every number the summary, STATUS.md and the README block show. */
export function numbers(root = '.') {
  const rel = loadRelease(root), contrib = loadContribTranslations(root);
  const recipes = [...rel.recipes.values()];
  const photos = photoIds(root), ai = aiDishes(root);
  const stepSets = dirs(join(root, 'ai-recipe-images'));
  const langs = [...new Set([...Object.keys(rel.text), ...Object.keys(contrib)])]
    .sort((a, b) => (rel.text[b]?.size ?? 0) - (rel.text[a]?.size ?? 0) || a.localeCompare(b));
  return {
    version: rel.manifest.version, corpus_revision: rel.manifest.corpus_revision, generated_at: rel.manifest.generated_at,
    recipes: recipes.length,
    steps: recipes.reduce((s, r) => s + r.step_count, 0),
    wikidata: { recipes: recipes.filter((r) => r.canon_qid).length, dishes: new Set(recipes.map((r) => r.canon_qid).filter(Boolean)).size },
    sources: readJson(join(root, 'data', 'sources.json')).length,
    languages: langs.map((l) => ({ lang: l, released: rel.text[l]?.size ?? 0, waiting: contrib[l]?.size ?? 0,
      machine: [...(rel.text[l]?.values() ?? [])].filter((t) => t.machine_translated).length })),
    pictures: { recipes_with: recipes.filter((r) => hasPicture(r, rel, photos, ai)).length, contributed_photos: photos.size, ai_dish_images: ai.n },
    step_pictures: { ai_recipe_sets: stepSets.length,
      ai_recipe_images: stepSets.reduce((s, d) => s + filesIn(join(root, 'ai-recipe-images', d), /\.webp$/).length, 0) },
  };
}

/** STATUS.md: the release's numbers. Contributions waiting in contrib/ are live in `node tools/work.mjs`, not here. */
export function statusMarkdown(n) {
  const L = ['# Status', '',
    `Release \`${n.version}\`, built from corpus revision \`${n.corpus_revision}\` on ${n.generated_at.slice(0, 10)}. ` +
    'Written by `node tools/work.mjs status --write` at each release. [`WORK.md`](WORK.md) says how to help with each part.', ''];
  L.push('## Recipes', '', '| | |', '|---|---|',
    `| Recipes | ${fmt(n.recipes)} |`,
    `| Steps | ${fmt(n.steps)} (${(n.steps / n.recipes).toFixed(1)} per recipe) |`,
    `| Linked to a Wikidata dish | ${fmt(n.wikidata.recipes)} recipes, ${fmt(n.wikidata.dishes)} dishes |`,
    `| Sources | ${n.sources} ([\`data/sources.json\`](data/sources.json); candidates in [\`SOURCES.md\`](SOURCES.md)) |`, '');
  L.push('## Languages', '', 'Each language is released on its own: a recipe\'s text in a language ships once that translation has passed a check.', '',
    '| Language | Recipes | Share | Machine-translated |', '|---|---|---|---|');
  for (const l of n.languages.filter((x) => x.released)) L.push(`| \`${l.lang}\` | ${fmt(l.released)} | ${pct(l.released, n.recipes)} | ${fmt(l.machine)} |`);
  L.push('', 'Every other language: 0. Any language is welcome: [`WORK.md`](WORK.md#which-languages).', '');
  L.push('## Pictures', '', '| | |', '|---|---|',
    `| Recipes with a picture | ${fmt(n.pictures.recipes_with)} of ${fmt(n.recipes)} (${pct(n.pictures.recipes_with, n.recipes)}) |`,
    `| Contributed photos ([\`photos/\`](photos/)) | ${fmt(n.pictures.contributed_photos)} |`,
    `| AI dish images ([\`ai-images/\`](ai-images/)) | ${fmt(n.pictures.ai_dish_images)} |`,
    `| Recipes in this dataset with step pictures | 0 ([\`docs/step-pictures.md\`](docs/step-pictures.md)) |`,
    `| AI step pictures of AI-written recipes ([\`ai-recipe-images/\`](ai-recipe-images/)) | ${fmt(n.step_pictures.ai_recipe_images)} for ${n.step_pictures.ai_recipe_sets} recipes ([review](docs/step-pictures-review.md)) |`, '');
  return L.join('\n');
}

/** The lines between the status markers in README.md. */
export function readmeBlock(n) {
  const langs = n.languages.filter((l) => l.released).map((l) => `**${fmt(l.released)}** in \`${l.lang}\``).join(', ');
  return [`- **${fmt(n.recipes)} recipes** with ${fmt(n.steps)} steps: ${langs}.`,
    `- **${fmt(n.pictures.recipes_with)} have a picture** so far (${fmt(n.pictures.ai_dish_images)} AI dish images, ${fmt(n.pictures.contributed_photos)} contributed photos).`,
    `- **${fmt(n.step_pictures.ai_recipe_images)} AI step pictures** for ${n.step_pictures.ai_recipe_sets} AI-written recipes; step pictures for these recipes are planned.`,
    `- Release \`${n.version}\` (${n.generated_at.slice(0, 10)}). Every number: [\`STATUS.md\`](STATUS.md).`].join('\n');
}

export function writeStatus(root = '.') {
  const n = numbers(root);
  writeFileSync(join(root, 'STATUS.md'), statusMarkdown(n) + '\n');
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  const re = /(<!-- status:start[^>]*-->\n)[\s\S]*?(<!-- status:end -->)/;
  if (!re.test(readme)) throw new Error('README.md has no <!-- status:start --> … <!-- status:end --> block');
  writeFileSync(join(root, 'README.md'), readme.replace(re, (_, a, b) => `${a}${readmeBlock(n)}\n${b}`));
  return n;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  const json = args.includes('--json'), n = +opt('--n', 25), offset = +opt('--offset', 0);
  const cmd = args[0] && !args[0].startsWith('--') ? args[0] : 'summary';
  const root = '.';
  const page = (rows) => rows.slice(offset, offset + n);
  const print = (rows, line) => { if (json) console.log(JSON.stringify(rows, null, 2)); else for (const r of rows) console.log(line(r)); };

  if (cmd === 'translate') {
    const lang = args[1];
    if (!/^[a-z]{2,3}$/.test(lang ?? '')) { console.error('usage: node tools/work.mjs translate <language code, e.g. de> [--from en|pl] [--n 25] [--offset 0] [--json]'); process.exit(2); }
    if (PIPELINE_LANGS.includes(lang)) { console.error(`${lang} text comes from the maintainers' pipeline. Translate into any other language; report a mistake in the ${lang} text as an issue.`); process.exit(2); }
    const q = translateQueue(loadRelease(root), loadContribTranslations(root), lang, opt('--from', null));
    print(page(q), (x) => `${x.id}\t${x.steps} steps\tfrom ${x.based_on.lang}\t${x.source.name}`);
    if (!json) console.error(`\n${fmt(q.length)} recipes left to translate into ${lang}. --json gives each one's text, its file and its based_on (CONTRIBUTING.md § Translate).`);
  } else if (cmd === 'photos') {
    const rel = loadRelease(root), q = photoQueue(rel, root);
    print(page(q).map((r) => ({ id: r.id, name: nameOf(rel, r.id), canon_qid: r.canon_qid })), (x) => `${x.id}\t${x.canon_qid ?? '-'}\t${x.name}`);
    if (!json) console.error(`\n${fmt(q.length)} recipes have no picture. A photo of one you cooked goes in photos/ (CONTRIBUTING.md § Photo).`);
  } else if (cmd === 'status') {
    const x = args.includes('--write') ? writeStatus(root) : numbers(root);
    console.log(json ? JSON.stringify(x, null, 2) : statusMarkdown(x));
  } else if (cmd === 'summary') {
    const x = numbers(root), rel = loadRelease(root);
    console.log(`Release ${x.version}: ${fmt(x.recipes)} recipes, ${fmt(x.steps)} steps.\n`);
    console.log(`Translate     ${x.languages.map((l) => `${l.lang} ${pct(l.released, x.recipes)}${l.waiting ? ` (+${l.waiting} waiting)` : ''}`).join(', ')}; every other language 0 %`);
    console.log('              → node tools/work.mjs translate <lang>');
    console.log(`Photos        ${fmt(photoQueue(rel, root).length)} recipes have no picture           → node tools/work.mjs photos`);
    console.log(`Step pictures none yet for these recipes; 30 AI sets to review → docs/step-pictures.md`);
    console.log('Recipes       share one of yours                              → CONTRIBUTING.md § Share a recipe');
    console.log('Sources       candidates to harvest, with their licences      → SOURCES.md');
  } else { console.error(`unknown command ${cmd}; see the top of tools/work.mjs`); process.exit(2); }
}
