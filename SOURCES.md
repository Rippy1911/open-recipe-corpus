# Sources

Where the recipes come from, what may come next, and the rules for taking recipes from anywhere. Counts as of
2026-11-07.

## In use

| Source | Licence | Pages harvested | Released |
|---|---|---|---|
| `pl-wikibooks`: [pl.wikibooks.org, *Książka kucharska*](https://pl.wikibooks.org/wiki/Ksi%C4%85%C5%BCka_kucharska) | CC BY-SA 4.0 | 1,013 | 947 |
| `pl-wikisource`: public-domain cookbooks from 1752 to 1941 on [pl.wikisource.org](https://pl.wikisource.org) | public domain | 6,284 | 2,066 |
| `en-wikibooks`: [en.wikibooks.org, *Cookbook*](https://en.wikibooks.org/wiki/Cookbook:Table_of_Contents) | CC BY-SA 4.0 | 3,833 | 0 (waiting for their checks, [`WORK.md`](WORK.md)) |

A page is not always a recipe (index pages, stubs, articles about an ingredient), and a recipe ships only once it has
passed its checks, so "released" is lower than "harvested".

## The rules

1. **A licence that allows sharing and changing, commercially.** CC BY-SA 4.0, CC BY 4.0, CC0, or the UK Open
   Government Licence v3 are fine. A licence with NonCommercial (NC) or NoDerivatives (ND) is not. "Free to use"
   without a licence is not enough.
2. **Or the public domain, in the US and in the country it comes from.** For a book in 2026: published in 1930 or
   earlier (US), and its author died before 1956 (EU and most countries: life plus 70 years). A translation of an
   old book has its own copyright: use the original, or a translation that is itself in the public domain.
3. **Never** recipes from websites, blogs, apps, or cookbooks still in copyright, even rephrased. A dataset that
   scraped them cannot license them, whatever its label says.
4. **Harvest politely, through the front door.** Use the site's API or its official dumps: the MediaWiki API for
   Wikimedia projects, Project Gutenberg's mirrors and catalogue feeds (its website must not be crawled). Name the
   project and a contact URL in the User-Agent, send one request at a time, honour `maxlag` and `Retry-After`, and never
   get around `robots.txt`, logins or paywalls.
5. **Keep the evidence.** For every page: its URL, page and revision id, history link, the licence the page states,
   and the date it was taken. Every recipe carries its credit line and links ([`ATTRIBUTION.md`](ATTRIBUTION.md)).
6. **A candidate becomes "in use" only after its licence has been checked** and recorded in the table above.

## Candidates

Not in use yet. Each needs its licence checked against the rules before anything is harvested.

| Candidate | Language | Licence to check | Size | Notes |
|---|---|---|---|---|
| German Wikibooks, *Kochbuch* | de | CC BY-SA 4.0 | count first | The first new language. Native recipes read better than translations and add dishes we lack. |
| French, Italian, Spanish, Portuguese, Dutch and Russian Wikibooks cookbooks | fr, it, es, pt, nl, ru | CC BY-SA 4.0 | about 9,400 pages together (estimate) | |
| German Wikisource cookbooks, e.g. Henriette Davidis | de | public domain | | Check each book. Old measures need a glossary first. |
| English Wikisource cookbooks | en | public domain | | Check each book, in the US and in its author's country. |
| Project Gutenberg cookbooks | many | public domain in the US | | Only books whose authors died before 1956. Use the mirrors, not the website. |
| Pellegrino Artusi, *La scienza in cucina e l'arte di mangiar bene* (1891) | it | public domain (author died 1911) | about 790 recipes | The Italian original only. |
| Elena Molokhovets, *Подарок молодым хозяйкам* (1861) | ru | public domain (author died 1918) | | The Russian original only. The 1992 English translation is in copyright. |
| US Armed Forces Recipe Service cards | en | US government work | | Public domain in the US. Check each card. |
| NHS recipes | en | Open Government Licence v3 | | Text only: images and some pages are excluded. Check each page. |
| A Mediterranean recipe set on Zenodo | en | CC BY 4.0 | about 200 | Check the record's licence. |
| Endangered Recipes Translated 500 | Indian languages | CC BY 4.0 | about 500 | Access is gated: check that its terms allow sharing. |

## Not usable

| Source | Why |
|---|---|
| Recipe1M+, RecipeNLG | Scraped from commercial recipe sites; licensed for research only. |
| tastyR | Labelled CC0, but scraped from a commercial site: a label cannot grant rights it does not hold. |
| TheMealDB | No licence stated. |
| Recipe websites, blogs and apps; cookbooks in copyright | Their text is protected, and rephrasing does not change that. |

Know another source? Open a [**Propose a source**](https://github.com/Rippy1911/open-recipe-corpus/issues/new?template=propose-a-source.yml) issue.
