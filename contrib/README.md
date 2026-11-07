# Contributions waiting for a check

Translations you add go here first. A maintainer checks each one and adds it to the next release in that language;
then it leaves this folder and appears in `data/text/<lang>.jsonl`. `node tools/work.mjs` counts what is waiting.

## A translation

One file per recipe and language: `contrib/translations/<lang>/<recipe id, ":" as "-">.json`.

- `<lang>` is the ISO 639 code: two letters (`de`, `es`, `uk`, `zh`), or three when the language has none (`fil`).
  Polish and English come from the maintainers' pipeline, so they are not taken here.
- Get the recipes to translate, with their text, file names and `based_on`, from
  `node tools/work.mjs translate <lang> --json`.

```json
{
  "id": "plwb:10140",
  "lang": "de",
  "based_on": { "lang": "en", "sha256": "<from work.mjs: the hash of the line you translated>" },
  "name": "In der Pfanne gebräunter Schmorreis",
  "summary": "…",
  "ingredients": [
    { "name": "Langkornreis", "note": "trocken, im Kochbeutel" },
    { "name": "Brühe" },
    { "name": "Pflanzenöl", "note": "so viel, dass der Pfannenboden bedeckt ist" }
  ],
  "steps": ["…", "…"],
  "translator": { "github": "your-login", "model": null },
  "license": "CC-BY-SA-4.0"
}
```

| Field | What goes in it |
|---|---|
| `id` | the recipe's id from `data/recipes.jsonl` |
| `lang` | the language you translated into; the same as the folder |
| `based_on` | the language you translated from and the `sha256` that `work.mjs` printed for it. If that text changes before your translation is checked, the check compares the two. |
| `name`, `summary` | the recipe's name and one-line summary |
| `ingredients` | one entry per ingredient, **in the same order and number** as the source. Only `name` and `note`: amounts and units are in `data/recipes.jsonl` and stay there. |
| `steps` | one entry per step, **in the same order and number** as the source. Keep every number, temperature and time. |
| `translator.github` | your GitHub login. Your translation is credited to it. |
| `translator.model` | the exact id of the AI model that wrote the translation, or `null` if you wrote it yourself. Text written by a model is labelled machine-translated. |
| `license` | `"CC-BY-SA-4.0"`: you license your translation like the rest of the data. |

## How it is checked

- **On your pull request:** `node tools/validate.mjs` (CI runs it) checks the shape: a recipe that exists, the same
  number of ingredients and steps, the script your language is written in, the licence, and that it is not the source
  text copied. A changed source text or a number that differs from the source is a warning for the reviewer.
- **Before release:** a fluent reader or an AI model from a different family than the translator's compares the
  translation with the original recipe: meaning, amounts, steps left out or added. A translation that needs a fix is
  sent back in your pull request or in an issue.
