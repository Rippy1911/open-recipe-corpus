# Work

What this project needs, and how to take a piece of it. The goal: recipes that anyone may use, in every language,
with a picture of every step, served free. The numbers so far are in [`STATUS.md`](STATUS.md).

```bash
node tools/work.mjs            # what is left, per track
```

## Tracks anyone can take

| Track | Who | Start | How |
|---|---|---|---|
| **Translate** recipes into a new language | people, and AI models run by people | `node tools/work.mjs translate <lang>` | [`CONTRIBUTING.md`](CONTRIBUTING.md#translate) |
| **Photograph** a recipe you cooked | people | `node tools/work.mjs photos` | [`CONTRIBUTING.md`](CONTRIBUTING.md#photo) |
| **Report a mistake** in a recipe or translation | people | the cookbook or `data/` | [`CONTRIBUTING.md`](CONTRIBUTING.md#report-a-mistake) |
| **Share a recipe**, your own or from an open source | people | an issue | [`CONTRIBUTING.md`](CONTRIBUTING.md#share-a-recipe) |
| **Propose a source** to harvest | people | [`SOURCES.md`](SOURCES.md) | [`CONTRIBUTING.md`](CONTRIBUTING.md#propose-a-source) |
| **Code**: the API, the tools | people, and AI models run by people | `api/`, `tools/` | [`CONTRIBUTING.md`](CONTRIBUTING.md#the-api-and-the-tools) |

AI models: read [`AGENTS.md`](AGENTS.md) first.

### Taking a piece without clashing

- **Translations:** before you start, look at the open pull requests for your language (titled `translate <lang>: …`).
  Take a slice nobody has: `node tools/work.mjs translate <lang> --offset 50`. Open your pull request as a draft early,
  so the next person sees which recipes you have.
- **Everything else:** comment on the issue, or open the pull request as a draft.
- One pull request is one language, or one recipe's photo, or one fix. Up to 25 recipes per pull request.

### Which languages

Any. The ones most asked for: German, Spanish, French, Italian, Portuguese, Ukrainian, Russian, Turkish, Hindi,
Chinese, Korean, Japanese, Arabic. Polish and English come from the maintainers' pipeline (below), so report a mistake
in them instead of translating.

Recipes linked to a Wikidata dish come first in every list (the dishes people look for), then shorter recipes.

## What the maintainers do

Some work needs the private pipeline behind this repository: harvesting, the recipe and translation checks, and the
project's AI images. It is listed here so everyone can see what is coming. As of 2026-11-07:

**Recipes waiting for checks** (the pipeline has them structured; a check decides whether they ship)

- [ ] **English Wikibooks:** 3,423 recipes wait for their culinary check (would a cook succeed as written?). Their
      Polish translations wait for a translation check.
- [ ] **Polish Wikisource:** 1,311 recipes wait for their culinary check.
- [ ] **English translations of released recipes:** 2,318 wait for their translation check, and 450 need a fix the
      check asked for.

**Contributions**

- [ ] Check contributed translations and release them, each credited to its translator and labelled machine-translated
      when a model wrote it. Serve each new language from the API (`languages` in `api/corpus.config.json`).
- [ ] Structure the recipes shared in issues and add them to a release.

**Pictures**

- [ ] AI dish images for the recipes that have no picture (`node tools/work.mjs photos`), dishes linked to Wikidata
      first.
- [ ] Step pictures for the recipes in `data/`, each planned from its own recipe ([`docs/step-pictures.md`](docs/step-pictures.md)).
- [ ] Review the 30 existing step-picture sets and remake the ones that fail ([`docs/step-pictures-review.md`](docs/step-pictures-review.md)).

**Sources**

- [ ] Verify the licence of the first new-language source (German Wikibooks, *Kochbuch*), then harvest it
      ([`SOURCES.md`](SOURCES.md)).
- [ ] Re-harvest the current sources on a schedule, so upstream corrections and authors stay current.

**Releases and reach**

- [ ] Number the releases (`v0.1.0` next) and publish each as a GitHub release.
- [ ] Mirror each release on Hugging Face and archive it on Zenodo for a DOI.
- [ ] Recipe pages that search engines can index, with schema.org `Recipe` data.
