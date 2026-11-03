// The three read operations behind both REST (/v1/*) and MCP (/mcp): one parameter schema, one validator, one
// handler each. Every recipe carries its attribution. Nutrition is not served here.
import R from './generated.js';
import { fold, ftsWords } from './text.js';

export class ApiError extends Error {
  constructor(status, code, message, { extra = {}, headers = {} } = {}) {
    super(message);
    Object.assign(this, { status, code, extra, headers });
  }
}
const RETRYABLE = new Set(['rate_limited', 'internal']);
export const errorBody = (e) => ({ error: { code: e.code, message: e.message, retryable: RETRYABLE.has(e.code), ...e.extra } });

export const LICENSE_URL = {
  'CC-BY-SA-4.0': 'https://creativecommons.org/licenses/by-sa/4.0/',
  'CC-BY-4.0': 'https://creativecommons.org/licenses/by/4.0/',
  'CC0-1.0': 'https://creativecommons.org/publicdomain/zero/1.0/',
  'public-domain': null,
};

const LANGS = Object.keys(R.languages);
const lang = { type: 'string', enum: LANGS, default: R.fallback_language, description: `Language of the text. ${R.fallback_language} when left out.` };
const oneOf = (values, description) => ({ type: 'string', enum: values, description });

export const TOOLS = {
  search_recipes: {
    title: 'Search recipes',
    description: 'Find recipes by words in the name, summary or ingredients, by ingredients, and by filters (all combine with AND). '
      + 'Diacritics are optional: "zurek" finds "żurek". Returns one page of compact recipes, each with its attribution; '
      + 'pass next_cursor back for the next page. Use get_recipe for amounts and steps.',
    params: {
      q: { type: 'string', maxLength: 200, description: 'Words to find in the name, summary or ingredient names. Words under 3 letters match the start of a name only.' },
      ingredients: { type: 'array', items: { type: 'string', maxLength: 60 }, maxItems: 10, description: 'Ingredient names the recipe must all contain, e.g. ["cabbage", "mushroom"].' },
      lang,
      category: oneOf(R.enums.category, 'Meal category.'),
      dish_type: oneOf(R.enums.dish_type, 'Dish type.'),
      cuisine: oneOf(R.enums.cuisine, 'Cuisine.'),
      source: oneOf(R.enums.source, 'Source collection.'),
      tags: { type: 'array', items: { type: 'string', enum: R.enums.tags }, maxItems: 8, description: 'Recipes that carry all of these tags.' },
      max_total_minutes: { type: 'integer', minimum: 1, maximum: 10080, description: 'Prep plus cook time at most this. Recipes with an unknown time are left out.' },
      has_photo: { type: 'boolean', description: 'Only recipes with (true) or without (false) a photo.' },
      limit: { type: 'integer', minimum: 1, maximum: 50, default: 20, description: 'Results per page (at most 50).' },
      cursor: { type: 'string', maxLength: 300, description: 'next_cursor from the previous page of the same search.' },
    },
  },
  get_recipe: {
    title: 'Get a recipe',
    description: 'One recipe by id: ingredients with amounts, steps, times, tags, photo and attribution. '
      + 'servings scales ingredient amounts (not the step text).',
    params: {
      id: { type: 'string', maxLength: 40, description: 'Recipe id, e.g. "plwb:10140".' },
      lang,
      servings: { type: 'integer', minimum: 1, maximum: 100, description: 'Scale ingredient amounts to this many servings.' },
    },
    required: ['id'],
  },
  list_facets: {
    title: 'List facets',
    description: 'The languages, sources and filter values (category, dish type, cuisine, tags) with recipe counts per value.',
    params: { lang },
  },
};

/** JSON Schema of a tool's input, for MCP tools/list and the OpenAPI document. */
export const inputSchema = (name) => ({
  type: 'object',
  properties: TOOLS[name].params,
  ...(TOOLS[name].required ? { required: TOOLS[name].required } : {}),
  additionalProperties: false,
});

const bad = (message) => new ApiError(400, 'bad_request', message);

/**
 * Validate a tool's input. MCP passes JSON values; REST passes query strings (`fromQuery`), each key mapped to the
 * list of its values, so arrays may be repeated or comma-separated. Unknown keys fail, so a typo is never ignored.
 */
export function validate(name, input, { fromQuery = false } = {}) {
  const { params, required = [] } = TOOLS[name];
  if (input == null || typeof input !== 'object' || Array.isArray(input)) throw bad('Arguments must be an object.');
  const out = {};
  for (const k of Object.keys(input)) if (!Object.hasOwn(params, k)) throw bad(`Unknown parameter "${k}". Known: ${Object.keys(params).join(', ')}.`);
  for (const [k, p] of Object.entries(params)) {
    let v = input[k];
    if (fromQuery && v !== undefined) {
      if (p.type === 'array') v = v.flatMap((s) => s.split(',')).map((s) => s.trim()).filter(Boolean);
      else if (v.length > 1) throw bad(`"${k}" was given more than once.`);
      else v = v[0];
      if (p.type === 'integer') v = /^\d+$/.test(v) ? Number(v) : v;
      if (p.type === 'boolean') v = { true: true, 1: true, false: false, 0: false }[v] ?? v;
    }
    if (v === undefined || v === '' || (Array.isArray(v) && !v.length)) {
      if (required.includes(k)) throw bad(`"${k}" is required.`);
      if (p.default !== undefined) out[k] = p.default;
      continue;
    }
    out[k] = check(k, v, p);
  }
  return out;
}

function check(k, v, p) {
  if (p.type === 'array') {
    if (!Array.isArray(v)) throw bad(`"${k}" must be a list.`);
    if (v.length > p.maxItems) throw bad(`"${k}" takes at most ${p.maxItems} values.`);
    return [...new Set(v.map((x) => check(k, x, p.items)))];
  }
  if (p.type === 'integer' && !(Number.isInteger(v) && v >= p.minimum && v <= p.maximum)) throw bad(`"${k}" must be a whole number from ${p.minimum} to ${p.maximum}.`);
  if (p.type === 'boolean' && typeof v !== 'boolean') throw bad(`"${k}" must be true or false.`);
  if (p.type === 'string') {
    if (typeof v !== 'string') throw bad(`"${k}" must be a string.`);
    if (p.maxLength && v.length > p.maxLength) throw bad(`"${k}" is longer than ${p.maxLength} characters.`);
    if (p.enum && !p.enum.includes(v)) {
      if (k === 'lang') throw new ApiError(400, 'unsupported_language', `Language "${v}" is not served here.`, { extra: { languages: LANGS } });
      throw bad(`"${k}" must be one of: ${p.enum.join(', ')}.`);
    }
  }
  return v;
}

/** The language a request is served in: a configured language with no text yet falls back to fallback_language. */
const served = (l) => (R.languages[l].status === 'available' ? l : R.fallback_language);

// Cursors are opaque, bound to the release and to the search they continue.
const b64 = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)));
const searchKey = ({ cursor, limit, ...rest }) => JSON.stringify(Object.keys(rest).sort().map((k) => [k, rest[k]]));
function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(36);
}
// Deeper than this, narrow the search instead: an OFFSET this large reads every row it skips.
const MAX_OFFSET = 5000;
function offsetOf(a) {
  if (!a.cursor) return 0;
  let c;
  try { c = JSON.parse(unb64(a.cursor)); } catch { c = null; }
  if (!c || typeof c !== 'object') throw bad('"cursor" is not a cursor from this API.');
  if (c.r !== R.release) throw new ApiError(409, 'release_changed', 'The data was updated since this cursor was made. Start the search again.');
  if (c.h !== hash(searchKey(a)) || !Number.isSafeInteger(c.o) || c.o < 0 || c.o > MAX_OFFSET) throw bad('"cursor" belongs to a different search.');
  return c.o;
}

export async function searchRecipes(db, a, origin) {
  const L = served(a.lang), F = R.fallback_language;
  const offset = offsetOf(a);
  const where = [], binds = [];
  const words = a.q ? ftsWords(a.q) : [];
  const ing = (a.ingredients ?? []).flatMap((i) => {
    const w = ftsWords(i);
    if (!w.length) throw bad(`Ingredient "${i}" needs at least 3 letters.`);
    return [`ingredients : (${w.join(' ')})`];
  });
  const match = [...(words.length ? [`(${words.join(' ')})`] : []), ...ing].join(' AND ');
  if (a.q && !words.length) {
    // D1 refuses a LIKE pattern over 50 bytes, so the prefix is cut to fit "% " + prefix + "%".
    let p = fold(a.q).trim().replace(/\s+/g, ' ').replace(/[\\%_]/g, (c) => `\\${c}`);
    while (new TextEncoder().encode(p).length > 40) p = p.slice(0, -1).replace(/\\$/, '');
    where.push(`(t.name_norm LIKE ? ESCAPE '\\' OR t.name_norm LIKE ? ESCAPE '\\')`);
    binds.push(`${p}%`, `% ${p}%`);
  }
  // The fallback clause only where the build counted recipes that need it: without it, (lang, name_norm) is one index walk.
  if (L === F || !R.facets[L]?.in_fallback_language) { where.push('t.lang = ?'); binds.push(L); } else {
    where.push('(t.lang = ? OR (t.lang = ? AND NOT EXISTS (SELECT 1 FROM txt x WHERE x.id = t.id AND x.lang = ?)))');
    binds.push(L, F, L);
  }
  for (const k of ['category', 'dish_type', 'cuisine', 'source']) if (a[k]) { where.push(`r.${k} = ?`); binds.push(a[k]); }
  for (const tag of a.tags ?? []) { where.push('EXISTS (SELECT 1 FROM json_each(r.tags) WHERE value = ?)'); binds.push(tag); }
  if (a.max_total_minutes) { where.push('r.total_min <= ?'); binds.push(a.max_total_minutes); }
  if (a.has_photo !== undefined) { where.push('r.has_photo = ?'); binds.push(a.has_photo ? 1 : 0); }
  const cols = 't.lang, t.body, r.core, r.photo';
  const sql = match
    ? `SELECT ${cols} FROM fts JOIN txt t ON t.n = fts.rowid JOIN recipe r ON r.id = t.id WHERE fts MATCH ? AND ${where.join(' AND ')} ORDER BY bm25(fts, 10.0, 4.0, 1.0), t.id LIMIT ? OFFSET ?`
    : `SELECT ${cols} FROM txt t JOIN recipe r ON r.id = t.id WHERE ${where.join(' AND ')} ORDER BY t.name_norm, t.id LIMIT ? OFFSET ?`;
  const { results } = await db.prepare(sql).bind(...(match ? [match] : []), ...binds, a.limit + 1, offset).all();
  const more = results.length > a.limit && offset + a.limit <= MAX_OFFSET;
  return {
    ...envelope(a.lang, L),
    results: results.slice(0, a.limit).map((row) => shape(row, origin, false)),
    next_cursor: more ? b64(JSON.stringify({ r: R.release, h: hash(searchKey(a)), o: offset + a.limit })) : null,
  };
}

export async function getRecipe(db, a, origin) {
  const { results } = await db.prepare('SELECT t.lang, t.body, r.core, r.photo FROM recipe r LEFT JOIN txt t ON t.id = r.id WHERE r.id = ?').bind(a.id).all();
  if (!results.length) throw new ApiError(404, 'not_found', `No recipe "${a.id}".`);
  const L = served(a.lang);
  const row = results.find((x) => x.lang === L) ?? results.find((x) => x.lang === R.fallback_language);
  if (!row) {
    throw new ApiError(404, 'no_text_in_language', `Recipe "${a.id}" has no text in ${a.lang} or ${R.fallback_language}.`,
      { extra: { available_langs: results.map((x) => x.lang).filter(Boolean).sort() } });
  }
  return { ...envelope(a.lang, row.lang), recipe: shape(row, origin, true, a.servings) };
}

export function listFacets(a) {
  const L = served(a.lang);
  return { ...envelope(a.lang, L), languages: R.languages, sources: R.sources, ...R.facets[L] };
}

const envelope = (asked, servedLang) => ({ release: R.release, lang: asked, lang_served: servedLang, fallback: asked !== servedLang });

/** A recipe as served: compact in search results, full (amounts, steps) from get_recipe. */
export function shape(row, origin, full, servings) {
  const c = JSON.parse(row.core), t = JSON.parse(row.body), photo = row.photo ? JSON.parse(row.photo) : null;
  const { prep, cook } = c.time_min;
  const out = {
    id: c.id,
    lang: row.lang,
    name: t.name,
    summary: t.summary || null,
    machine_translated: t.machine_translated,
    ...(t.translated_from ? { translated_from: t.translated_from } : {}),
    category: c.category,
    dish_type: c.dish_type,
    cuisine: c.cuisine,
    servings: c.servings,
    time_min: { prep, cook, total: prep != null && cook != null ? prep + cook : null },
    tags: c.tags,
    allergens: c.allergens,
    photo: photo && {
      url: new URL(photo.path, origin).href,
      ai_generated: photo.ai_generated,
      ...(photo.ai_generated ? { digital_source_type: photo.digital_source_type, note: 'AI-generated illustration of the dish, not a photo of this recipe.' } : {}),
      license: photo.license,
      license_url: LICENSE_URL[photo.license] ?? null,
      ...(photo.author ? { author: photo.author } : {}),
      ...(photo.source_url ? { source_url: photo.source_url } : {}),
    },
    url: `${origin}/v1/recipes/${c.id}?lang=${row.lang}`,
    attribution: attribution(c, t),
  };
  if (!full) return { ...out, ingredient_names: t.ingredients.map((i) => i.name) };
  if (servings && !c.servings) throw bad(`Recipe "${c.id}" states no servings, so it cannot be scaled.`);
  const f = servings ? servings / c.servings : 1;
  return {
    ...out,
    source_lang: c.source_lang,
    canon_qid: c.canon_qid,
    ...(servings ? { servings, scaled: true, steps_scaled: false } : {}),
    ingredients: c.ingredients.map((q, i) => ({
      name: t.ingredients[i].name,
      qty: q.qty == null ? null : round(q.qty * f, q.unit),
      unit: q.unit,
      ...(t.ingredients[i].note ? { note: t.ingredients[i].note } : {}),
      ...(t.ingredients[i].group ? { group: t.ingredients[i].group } : {}),
    })),
    steps: t.steps,
  };
}

const COUNTED = new Set(['pcs', 'clove', 'slice', 'bunch', 'pinch']);
/** Scaled amounts: g and ml to the nearest 5 above 50, counted units to 0.5, spoons to 0.25, anything else to 0.01. */
export function round(q, unit) {
  if (unit === 'g' || unit === 'ml') return q > 50 ? Math.round(q / 5) * 5 : Math.max(1, Math.round(q));
  if (COUNTED.has(unit)) return Math.max(0.5, Math.round(q * 2) / 2);
  if (unit === 'tsp' || unit === 'tbsp') return Math.max(0.25, Math.round(q * 4) / 4);
  return Math.round(q * 100) / 100;
}

/** Credit for one record, complete enough to reuse it on its own under CC BY-SA 4.0. */
export function attribution(c, t) {
  const p = c.provenance, site = new URL(p.url).origin;
  return {
    title: p.title,
    source: p.source,
    url: p.url,
    revision: p.revision,
    revision_url: p.revision ? `${site}/w/index.php?oldid=${p.revision}` : null,
    history_url: p.history_url,
    credit: p.attribution,
    source_license: p.source_license,
    source_license_url: LICENSE_URL[p.source_license] ?? null,
    license: p.license,
    license_url: LICENSE_URL[p.license],
    changes: t.machine_translated ? `${p.changes}; machine-translated from ${t.translated_from}` : p.changes,
    machine_translated: t.machine_translated,
    ...(p.based_on ? { based_on: p.based_on } : {}),
  };
}

/** Run a tool on validated arguments. */
export function run(db, name, a, origin) {
  if (name === 'search_recipes') return searchRecipes(db, a, origin);
  if (name === 'get_recipe') return getRecipe(db, a, origin);
  return listFacets(a);
}
