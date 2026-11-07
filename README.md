# Open recipe corpus

**Recipes anyone may cook, share and build on, in every language.** We take recipes whose licences allow it (the
Wikibooks cookbooks and public-domain cookbooks), structure them into fields, check them, translate them, illustrate
them, and serve them free as data, an API and an MCP server. Today they are in Polish and English; every other
language is open for translation.

<!-- status:start: written by node tools/work.mjs status --write -->
- **3,013 recipes** with 20,970 steps: **3,013** in `pl`, **1,561** in `en`.
- **75 have a picture** so far (97 AI dish images, 0 contributed photos).
- **150 AI step pictures** for 30 AI-written recipes; step pictures for these recipes are planned.
- Release `0.1.0` (2026-11-07). Every number: [`STATUS.md`](STATUS.md).
<!-- status:end -->

**[Browse the cookbook →](https://cookbook.airon.app)** · **[Docs](https://cookbook.airon.app/#/en/docs)** ·
**[API and MCP](api/README.md)** at `recipes.airon.app` · **[What needs doing](WORK.md)** · **[Sources](SOURCES.md)**

Each recipe has servings, times, a category, dish type and cuisine, diet tags, allergens, ingredients with amounts in
metric units, and numbered steps. Every record links back to the page and revision it came from. Recipes linked to a
Wikidata dish carry its id.

Made by [Airon](https://airon.app/?utm_source=open-recipe-corpus), the AI fitness and nutrition coach that plans meals
and tracks macros. Airon uses this corpus for its recipe search and meal plans.

## Help

- **Translate** recipes into your language, yourself or with an AI model: `node tools/work.mjs translate <lang>`.
- **Photograph** a recipe you cooked: most recipes have no picture yet.
- **Report a mistake**, **share a recipe** of your own, or **propose a source** we may use.

[`WORK.md`](WORK.md) lists everything that is needed, [`CONTRIBUTING.md`](CONTRIBUTING.md) says how, and
[`AGENTS.md`](AGENTS.md) is for AI models. Only recipes that passed their checks are in `data/`, each language on its
own; English text is machine-translated from Polish and labelled as such.

## Use it without downloading anything

A free API and MCP server serve this data. No key is needed, and the limit is 10 requests per 10 seconds.

```bash
curl 'https://recipes.airon.app/v1/recipes?q=pierogi&lang=en&limit=3'
claude mcp add --transport http recipes https://recipes.airon.app/mcp
```

[`api/README.md`](api/README.md) has every endpoint and parameter, the MCP tools, client configs and limits.

## Host your own API

The API lives in this repository and serves the data next to it, so a clone is all you need. It runs on Cloudflare's
free plan (Workers, D1, R2).

- **With an AI coding assistant:** open this repository and ask it to *deploy `api/` to my Cloudflare account,
  following `api/README.md`*.
- **By hand:**
  1. In `api/corpus.config.json`, set `name`, and set `domain` to your own hostname (or `null` for the
     `workers.dev` URL).
  2. Run:

     ```bash
     cd api
     npm install
     npx wrangler login
     npm run deploy
     ```

  The deploy creates and loads a D1 database, uploads any photos to R2, and deploys the Worker.
  [`api/README.md`](api/README.md) § "Host your own" covers every config key, changing the limit, loading a new
  release and rolling back.

## The data

| File | One line per | Holds |
|---|---|---|
| `data/recipes.jsonl` | recipe | `id`, `source_lang`, `servings`, `time_min` (`prep`, `cook`), `category`, `dish_type`, `cuisine`, `tags`, `allergens`, `canon_qid` (Wikidata), `ingredients` (`qty`, `unit`), `step_count`, `provenance` |
| `data/text/<lang>.jsonl` | recipe in that language | `id`, `name`, `summary`, `ingredients` (`name`, `note`), `steps`, and `machine_translated` with `translated_from` for translated text |
| `data/sources.json` | (one array) | each source: site, licence, credit line |
| `manifest.json` | (one object) | the data licence, the corpus revision it was built from, and counts |
| `ai-images/<dish>/1.webp` + `1.json` | dish | an AI-generated illustration with `dish`, `qid`, `ai_generated: true` and `license: CC0-1.0`. The API matches it to recipes by Wikidata QID or exact dish name. |
| `ai-recipe-images/<recipe>/<step>.webp` + `.json` | step of an AI-written recipe | an AI-generated illustration with `recipe`, `step` (`hero.webp` is the card crop, with `crop_of_step`), `ai_generated: true` and `license: CC0-1.0`. The API does not serve these. |
| `photos/<recipe id>/` | recipe | contributed photos with their author and licence ([`CONTRIBUTING.md`](CONTRIBUTING.md#photo)) |
| `contrib/translations/<lang>/` | recipe in that language | contributed translations waiting for their check ([`contrib/README.md`](contrib/README.md)) |

- **Ingredients line up by position.** `recipes.jsonl` holds the amounts, and each text file holds the names in its
  language.
- **Units** are `g`, `kg`, `ml`, `l`, `pcs`, `tsp`, `tbsp`, `pinch`, `clove`, `slice`, `bunch` and `to_taste`.
  Unknown values are `null`.
- **`provenance`** has what you need to attribute a recipe: `source`, `title`, `url`, `revision`, `history_url`,
  `attribution` (the credit line), `source_license`, `license` and `changes`. Recipes from public-domain books also
  have `based_on` and `adaptation_notes`. See [`ATTRIBUTION.md`](ATTRIBUTION.md).

## Licences

- **Data:** CC BY-SA 4.0 ([`LICENSE-DATA.md`](LICENSE-DATA.md)). Keep each recipe's credit line and links
  ([`ATTRIBUTION.md`](ATTRIBUTION.md)).
- **AI images** in `ai-images/` and `ai-recipe-images/`: CC0 1.0, labelled as AI-generated. They are not photographs.
- **Photos** in `photos/`: the licence stated next to each one.
- **Code** in `api/` and `tools/`: Apache-2.0 ([`LICENSE`](LICENSE), [`NOTICE`](NOTICE)).

To cite the dataset, use [`CITATION.cff`](CITATION.cff) (GitHub's "Cite this repository").
