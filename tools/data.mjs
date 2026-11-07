// Shared loaders for tools/work.mjs and tools/validate.mjs. Node built-ins only.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fold } from '../api/src/text.js';

export const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'));
const lines = (f) => readFileSync(f, 'utf8').split('\n').filter((l) => l.trim());
export const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
export const dirs = (d) => (existsSync(d) ? readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort() : []);
export const filesIn = (d, re) => (existsSync(d) ? readdirSync(d).filter((f) => re.test(f)).sort() : []);

/** A recipe id as a folder or file name: `plwb:9356` → `plwb-9356`. */
export const idToName = (id) => id.replace(':', '-');

/**
 * The released dataset: recipes by id, and per language the text by id plus the exact line it was read from.
 * `based_on.sha256` in a contributed translation is the sha256 of that line (UTF-8, no newline).
 */
export function loadRelease(root = '.') {
  const recipes = new Map();
  for (const l of lines(join(root, 'data', 'recipes.jsonl'))) { const r = JSON.parse(l); recipes.set(r.id, r); }
  const text = {}, line = {};
  for (const f of filesIn(join(root, 'data', 'text'), /^[a-z]{2,3}\.jsonl$/)) {
    const lang = f.slice(0, -6);
    text[lang] = new Map(); line[lang] = new Map();
    for (const l of lines(join(root, 'data', 'text', f))) { const t = JSON.parse(l); text[lang].set(t.id, t); line[lang].set(t.id, l); }
  }
  return { recipes, text, line, manifest: readJson(join(root, 'manifest.json')) };
}

/** Contributed translations waiting in contrib/translations/<lang>/: { <lang>: Map(id → { file, t }) }. Unreadable files are skipped here; validate.mjs reports them. */
export function loadContribTranslations(root = '.') {
  const out = {};
  for (const lang of dirs(join(root, 'contrib', 'translations'))) {
    out[lang] = new Map();
    for (const f of filesIn(join(root, 'contrib', 'translations', lang), /\.json$/)) {
      try { const t = readJson(join(root, 'contrib', 'translations', lang, f)); if (typeof t?.id === 'string') out[lang].set(t.id, { file: f, t }); } catch { /* reported by validate.mjs */ }
    }
  }
  return out;
}

/** Recipe ids with a contributed photo (photos/<id as name>/ holding at least one <n>.json). */
export function photoIds(root = '.') {
  const ids = new Set();
  for (const d of dirs(join(root, 'photos'))) if (filesIn(join(root, 'photos', d), /^\d+\.json$/).length) ids.add(d);
  return ids;
}

/** The API's dish-name key (api/scripts/build.mjs asciiSlug), so a match here is a match there. */
export const dishKey = (s) => fold(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

/** The project's AI dish images: the Wikidata QIDs and dish-name keys they can be matched by, as the API matches them. */
export function aiDishes(root = '.') {
  const qids = new Set(), names = new Set();
  let n = 0;
  for (const dish of dirs(join(root, 'ai-images'))) {
    for (const f of filesIn(join(root, 'ai-images', dish), /^\d+\.json$/)) {
      const s = readJson(join(root, 'ai-images', dish, f));
      n++;
      if (s.qid) qids.add(s.qid);
      if (s.dish) names.add(dishKey(s.dish));
    }
  }
  return { qids, names, n };
}

/** Whether a recipe already has a picture: a contributed photo, or an AI dish image by QID or by its name in any language. */
export function hasPicture(r, rel, photos, ai) {
  if (photos.has(idToName(r.id))) return true;
  if (r.canon_qid && ai.qids.has(r.canon_qid)) return true;
  return Object.values(rel.text).some((m) => m.has(r.id) && ai.names.has(dishKey(m.get(r.id).name)));
}
