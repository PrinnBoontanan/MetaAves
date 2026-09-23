#!/usr/bin/env python3
"""
Build MetaAves bird/taxonomy data from the official AviList v2025b XLSX.

Usage:
  python scripts/import_avilist.py path/to/AviList-v2025b-extended.xlsx

The importer intentionally keeps enrichment fields (Thai name, habitat, diet,
behavior, breeding, interesting facts) separate because AviList does not
provide those fields.
"""

import json
import sys
from pathlib import Path

from openpyxl import load_workbook

RANKS = [
    "kingdom", "phylum", "class", "subclass", "infraclass", "cohort",
    "superorder", "order", "suborder", "infraorder", "parvorder",
    "superfamily", "family", "subfamily", "tribe", "subtribe",
    "genus", "subgenus", "species"
]

def clean(value):
    if value is None:
        return None
    value = str(value).strip()
    return value or None

def find_col(headers, candidates):
    normalized = {str(h).strip().lower(): i for i, h in enumerate(headers) if h is not None}
    for candidate in candidates:
        if candidate.lower() in normalized:
            return normalized[candidate.lower()]
    for key, idx in normalized.items():
        if any(candidate.lower() in key for candidate in candidates):
            return idx
    return None

def main():
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python scripts/import_avilist.py <AviList-extended.xlsx>")

    xlsx = Path(sys.argv[1])
    if not xlsx.exists():
        raise SystemExit(f"File not found: {xlsx}")

    wb = load_workbook(xlsx, read_only=True, data_only=True)
    ws = wb["AviList v2025b"]

    rows = ws.iter_rows(values_only=True)
    headers = next(rows)

    cols = {
        "rank": find_col(headers, ["Taxon_rank", "Rank"]),
        "english": find_col(headers, ["English_name_AviList", "English_name"]),
        "scientific": find_col(headers, ["Scientific_name"]),
        "order": find_col(headers, ["Order"]),
        "family": find_col(headers, ["Family"]),
        "genus": find_col(headers, ["Genus"]),
        "extinct": find_col(headers, ["Extinct_or_possibly_extinct"]),
        "range": find_col(headers, ["Range"]),
        "iucn": find_col(headers, ["IUCN_Red_List_Category"]),
    }

    missing = [k for k, v in cols.items() if v is None and k in {"rank", "english", "scientific"}]
    if missing:
        raise SystemExit(f"Could not find required AviList columns: {', '.join(missing)}")

    birds = []
    taxa = {"class:Aves": {
        "id": "class:Aves", "rank": "class", "name": "Aves",
        "parent": None, "children": []
    }}

    last_by_rank = {}

    for row in rows:
        rank = clean(row[cols["rank"]])
        if rank != "species":
            continue

        common = clean(row[cols["english"]])
        scientific = clean(row[cols["scientific"]])
        if not common or not scientific:
            continue

        order = clean(row[cols["order"]])
        family = clean(row[cols["family"]])
        genus = clean(row[cols["genus"]])
        extinct_value = clean(row[cols["extinct"]])

        bird = {
            "commonName": common,
            "scientificName": scientific,
            "thaiName": None,
            "isExtinct": bool(extinct_value and extinct_value.lower() in {"yes", "true", "extinct"}),
            "kingdom": "Animalia",
            "phylum": "Chordata",
            "class": "Aves",
            "subclass": None,
            "infraclass": None,
            "cohort": None,
            "superorder": None,
            "order": order,
            "suborder": None,
            "infraorder": None,
            "parvorder": None,
            "superfamily": None,
            "family": family,
            "subfamily": None,
            "tribe": None,
            "subtribe": None,
            "genus": genus,
            "subgenus": None,
            "species": scientific,
            "habitat": None,
            "distribution": clean(row[cols["range"]]) if cols["range"] is not None else None,
            "diet": None,
            "behavior": None,
            "breeding": None,
            "conservation": clean(row[cols["iucn"]]) if cols["iucn"] is not None else None,
            "interestingFacts": [],
            "wikipediaTitle": common,
            "genusCharacteristics": []
        }
        birds.append(bird)

        path = [("class", "Aves"), ("order", order), ("family", family), ("genus", genus)]
        parent = "class:Aves"
        for tax_rank, name in path[1:]:
            if not name:
                continue
            tax_id = f"{tax_rank}:{name}"
            if tax_id not in taxa:
                taxa[tax_id] = {
                    "id": tax_id, "rank": tax_rank, "name": name,
                    "parent": parent, "children": []
                }
                taxa[parent]["children"].append(tax_id)
            parent = tax_id

        species_id = "species:" + scientific.replace(" ", "_")
        taxa[species_id] = {
            "id": species_id, "rank": "species", "name": scientific,
            "parent": parent, "children": []
        }
        taxa[parent]["children"].append(species_id)

    out = Path("data")
    out.mkdir(exist_ok=True)
    (out / "birds.generated.json").write_text(
        json.dumps(birds, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    taxonomy = {
        "_meta": {
            "version": 3,
            "masterSource": {
                "name": "AviList: The Global Avian Checklist",
                "version": "2025b"
            },
            "generatedBy": "scripts/import_avilist.py",
            "clades": "Maintained separately from ranked taxonomy."
        }
    }
    taxonomy.update(taxa)
    (out / "taxonomy.generated.json").write_text(
        json.dumps(taxonomy, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    print(f"Imported {len(birds):,} species")
    print(f"Generated {len(taxa):,} taxonomy nodes")

if __name__ == "__main__":
    main()
