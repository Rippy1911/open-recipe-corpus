# How to credit a recipe

Every recipe in `data/recipes.jsonl` carries a `provenance` object, and the API returns the same information as
`attribution`. When you show or reuse a recipe, include:

- **The credit line:** `provenance.attribution`, for example *Autorzy Wikibooks (pl.wikibooks.org, Książka kucharska)*.
- **A link to the source page:** `provenance.url`. To link the exact version, use
  `<site>/w/index.php?oldid=<provenance.revision>`.
- **A link to the page history:** `provenance.history_url`. That is where the individual authors are listed.
- **The licence:** CC BY-SA 4.0, with a link to <https://creativecommons.org/licenses/by-sa/4.0/>.
- **What was changed:** `provenance.changes`, for example *structured into fields and edited for clarity*. If the
  text is machine-translated (`machine_translated: true` in the text file), say so.

For example:

> **Bigos (Polish hunter's stew)**, from [Książka kucharska/Bigos](https://pl.wikibooks.org/w/index.php?oldid=551039)
> by [Wikibooks authors](https://pl.wikibooks.org/w/index.php?curid=9356&action=history), CC BY-SA 4.0.
> Structured into fields, edited for clarity and machine-translated from Polish by the
> [Open recipe corpus](https://github.com/Rippy1911/open-recipe-corpus).

## Crediting the whole dataset

> Open recipe corpus (https://github.com/Rippy1911/open-recipe-corpus), CC BY-SA 4.0. Based on the Wikibooks
> cookbooks by their contributors and on public-domain books from Wikisource.

## Public-domain sources

Recipes from `pl-wikisource` come from public-domain books, such as Lucyna Ćwierczakiewiczowa's *Baby, placki i
mazurki* (1908). Their `provenance` has `based_on` with the book, author and year, `adapted: true`, and
`adaptation_notes` on what was modernised, such as old measures converted to grams. The book is not under copyright,
but our structured version is CC BY-SA 4.0, so credit it the same way.
