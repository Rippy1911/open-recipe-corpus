// Text folding shared by the build (stored *_norm columns) and every query, so both sides fold the same way.

/** Lower case, no diacritics, ł → l: "Żurek" and "zurek" fold to the same string. */
export const fold = (s) => String(s ?? '').normalize('NFKD').replace(/\p{M}+/gu, '').replace(/[łŁ]/g, 'l').toLowerCase();

/**
 * The words of a query as FTS5 phrases. Only words of 3+ characters: the trigram tokenizer matches nothing shorter.
 * Splitting on anything that is not a letter or digit also strips every FTS5 operator, so user text is never syntax.
 */
export const ftsWords = (s) => fold(s).split(/[^\p{L}\p{N}]+/u).filter((w) => [...w].length >= 3).map((w) => `"${w}"`);
