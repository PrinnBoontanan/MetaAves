# MetaAves data build

The authoritative species/ranked-taxonomy input is **AviList v2025b**.

## Importing the full bird checklist

1. Download the **Extended (.xlsx)** checklist from:
   https://www.avilist.org/checklist/v2025b/
2. Install the importer dependency:
   `pip install -r requirements.txt`
3. Run:
   `python scripts/import_avilist.py path/to/AviList-v2025b-extended.xlsx`

This creates:
- `data/birds.generated.json`
- `data/taxonomy.generated.json`

The generated taxonomy is built from the canonical `rankOrder` rather than a hard-coded
order → family → genus chain. MetaAves currently starts the game tree at **Aves
(class)**, so kingdom and phylum are not inserted above the root.

AviList v2025b currently publishes the classic order, family, genus and species
ranks. The importer already supports additional intermediate rank fields if a
future AviList release provides them.

## Enrichment and phylogeny

The generated files intentionally leave enrichment fields such as Thai names,
diet, behavior, breeding and interesting facts empty. These should be populated
in a separate enrichment pass so that authoritative taxonomy is not mixed with
secondary descriptive data.

Phylogenetic clades such as **Telluraves**, **Afroaves**, and **Australaves**
are maintained separately from ranked taxonomy. The game engine can insert those
clade nodes between ranked nodes without treating them as Linnaean ranks.

The importer does not invent clade membership. A future clade-membership layer
will map species/groups onto the maintained MetaAves clade backbone.
