# MetaAves 🐦

**MetaAves** is a bird-only taxonomy guessing game inspired by Metazooa.

Guess the mystery bird from its English common name, then use the interactive taxonomy tree to work your way closer to the answer.

## Features

- 🌍 **World Birds** — a global bird species pool, including extinct and possibly extinct species in the source data.
- 🇹🇭 **Thailand Birds** — a Thailand-focused bird pool with Thai names in the study experience.
- 🌳 **Interactive taxonomy tree** — explore shared clades and taxonomic relationships between guesses.
- 📋 **Tree / Table views** — switch between the visual taxonomy tree and a compact table.
- 🔎 **Smart English-name search** — ranked autocomplete with typo tolerance and duplicate-guess protection.
- 📚 **Bird study cards** — descriptions, taxonomy, habitat and distribution, diet, behavior, breeding, conservation, photos, and Wikipedia links when available.
- 🇹🇭↔️🇬🇧 **Thai ↔ English Bird Name Helper** — a separate lookup tool that does not change the English-only gameplay rules.
- 💡 **Identification hints** — clues adapt to the mystery bird and the taxonomy already discovered.

## Data

MetaAves combines generated bird/taxonomy data with online reference information. Taxonomy is based primarily on AviList, while study-card information and media can be retrieved from Wikipedia and other public biodiversity services.

Online information can change independently of the game, so the study card treats missing information explicitly rather than inventing it.

## Run locally

MetaAves is a static web application.

1. Clone the repository.
2. Serve the project directory with a local web server.
3. Open the server URL in a modern browser.

Example:

    python -m http.server 8080

Then open `http://localhost:8080`.

## Project structure

- `index.html` — page structure and dialogs
- `style.css` — visual design and responsive layout
- `script.js` — game logic, taxonomy rendering, search, study cards, and online lookups
- `data/` — generated bird, taxonomy, clade, and reference data
- `.github/workflows/` — data-generation / maintenance workflows

## Status

MetaAves is a personal learning project built to explore bird taxonomy, web development, data processing, and interactive educational game design.

