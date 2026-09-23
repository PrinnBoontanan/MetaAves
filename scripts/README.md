# MetaAves data build

The authoritative species/taxonomy input is **AviList v2025b**.

1. Download the **Extended (.xlsx)** checklist from:
   https://www.avilist.org/checklist/v2025b/
2. Install the importer dependency:
   `pip install -r requirements.txt`
3. Run:
   `python scripts/import_avilist.py path/to/AviList-v2025b-extended.xlsx`

This creates:
- `data/birds.generated.json`
- `data/taxonomy.generated.json`

The generated files intentionally leave enrichment fields such as Thai names,
diet, behavior, breeding and interesting facts empty. Those will be populated
in a separate enrichment pass so that the authoritative taxonomy is not mixed
with secondary descriptive data.

Phylogenetic clades (for example Telluraves) are maintained separately from
the ranked AviList hierarchy and will be added in the clade layer next.
