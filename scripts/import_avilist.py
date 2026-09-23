#!/usr/bin/env python3
"""
Build MetaAves bird/taxonomy data from the official AviList v2025b XLSX.

Usage:
  python scripts/import_avilist.py path/to/AviList-v2025b-extended.xlsx

The importer treats AviList as the authoritative ranked taxonomy and
automatically finds the AviList extended worksheet, so minor worksheet
name/capitalization changes do not break the import.
"""

import json
import re
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


def normalize_header(value):
    if value is None:
        return ""
    return re.sub(r"[^a-z0-9]+", "_", str(value).strip().lower()).strip("_")


def find_col(headers, candidates):
    normalized = {
        normalize_header(header): index
        for index, header in enumerate(headers)
        if header is not None
    }

    for candidate in candidates:
        key = normalize_header(candidate)
        if key in normalized:
            return normalized[key]

    for key, index in normalized.items():
        if any(normalize_header(candidate) in key for candidate in candidates):
            return index

    return None


def taxon_id(rank, name):
    safe_name = re.sub(r"[^A-Za-z0-9_-]+", "_", name).strip("_")
    return f"{rank}:{safe_name}"


def find_avilist_sheet(workbook):
    # Prefer the known current name, but normalize case/spacing so the
    # importer also works with harmless naming differences.
    preferred = "AviList v2025b extended"
    if preferred in workbook.sheetnames:
        return workbook[preferred]

    target = normalize_header(preferred)
    for sheet_name in workbook.sheetnames:
        normalized = normalize_header(sheet_name)
        if normalized == target:
            return workbook[sheet_name]

    # Fallback: find any sheet containing both "avilist" and "extended".
    for sheet_name in workbook.sheetnames:
        normalized = normalize_header(sheet_name)
        if "avilist" in normalized and "extended" in normalized:
            return workbook[sheet_name]

    available = ", ".join(repr(name) for name in workbook.sheetnames)
    raise SystemExit(
        "Could not find the AviList extended worksheet. "
        f"Available worksheets: {available}"
    )



def validate_import(birds, taxa):
    print("\n=== MetaAves Import Validation ===")

    missing_fields = {
        "commonName": [],
        "scientificName": [],
        "order": [],
        "family": [],
        "genus": []
    }

    for bird in birds:
        for field in missing_fields:
            if not bird.get(field):
                missing_fields[field].append(bird.get("scientificName") or bird.get("commonName") or "<unknown>")

    def duplicate_count(values):
        seen = set()
        duplicates = set()
        for value in values:
            if not value:
                continue
            if value in seen:
                duplicates.add(value)
            seen.add(value)
        return len(duplicates)

    duplicate_scientific = duplicate_count(
        bird.get("scientificName") for bird in birds
    )
    duplicate_common = duplicate_count(
        bird.get("commonName") for bird in birds
    )

    extinct_count = sum(1 for bird in birds if bird.get("isExtinct"))

    invalid_taxon_parents = [
        taxon_id_value
        for taxon_id_value, taxon in taxa.items()
        if taxon_id_value != "class:Aves"
        and taxon.get("parent") not in taxa
    ]

    root = taxa.get("class:Aves")
    invalid_root = (
        not root
        or root.get("rank") != "class"
        or root.get("name") != "Aves"
        or root.get("parent") is not None
    )

    print(f"Species imported:        {len(birds):,}")
    print(f"Extinct/possibly extinct:{extinct_count:,}")
    print(f"Taxonomy nodes:          {len(taxa):,}")
    print()
    print(f"Missing common names:    {len(missing_fields['commonName']):,}")
    print(f"Missing scientific names:{len(missing_fields['scientificName']):,}")
    print(f"Missing order:           {len(missing_fields['order']):,}")
    print(f"Missing family:          {len(missing_fields['family']):,}")
    print(f"Missing genus:           {len(missing_fields['genus']):,}")
    print()
    print(f"Duplicate scientific:    {duplicate_scientific:,}")
    print(f"Duplicate common names:  {duplicate_common:,}")
    print(f"Invalid taxon parents:   {len(invalid_taxon_parents):,}")
    print(f"Invalid Aves root:       {'YES' if invalid_root else 'NO'}")

    errors = (
        any(missing_fields.values())
        or duplicate_scientific > 0
        or invalid_taxon_parents
        or invalid_root
    )

    if errors:
        print("\nSTATUS: CHECK REQUIRED")
        for field, values in missing_fields.items():
            if values:
                print(f"  {field}: {values[:5]}")
        if invalid_taxon_parents:
            print(f"  Invalid parent examples: {invalid_taxon_parents[:5]}")
        return False

    print("\nSTATUS: PASS")
    return True


def main():
    if len(sys.argv) != 2:
        raise SystemExit(
            "Usage: python scripts/import_avilist.py <AviList-extended.xlsx>"
        )

    xlsx = Path(sys.argv[1])
    if not xlsx.exists():
        raise SystemExit(f"File not found: {xlsx}")

    wb = load_workbook(xlsx, read_only=True, data_only=True)
    ws = find_avilist_sheet(wb)

    print(f"Using worksheet: {ws.title}")

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

    missing = [
        key for key, value in cols.items()
        if value is None and key in {"rank", "english", "scientific"}
    ]
    if missing:
        raise SystemExit(
            "Could not find required AviList columns: "
            + ", ".join(missing)
        )

    birds = []

    taxa = {
        "class:Aves": {
            "id": "class:Aves",
            "rank": "class",
            "name": "Aves",
            "parent": None,
            "children": []
        }
    }

    for row in rows:
        rank = clean(row[cols["rank"]])

        if rank != "species":
            continue

        common = clean(row[cols["english"]])
        scientific = clean(row[cols["scientific"]])

        if not common or not scientific:
            continue

        # AviList's extended sheet may leave the Genus column blank even
        # though the scientific name is binomial. Use the explicit Genus
        # value when present; otherwise derive the genus from the first
        # nomenclatural token of the scientific name.
        genus = (
            clean(row[cols["genus"]])
            if cols["genus"] is not None
            else None
        )
        if not genus:
            genus = scientific.split()[0]

        bird = {
            "commonName": common,
            "scientificName": scientific,
            "thaiName": None,
            "isExtinct": False,
            "kingdom": "Animalia",
            "phylum": "Chordata",
            "class": "Aves",
            "subclass": None,
            "infraclass": None,
            "cohort": None,
            "superorder": None,
            "order": clean(row[cols["order"]]) if cols["order"] is not None else None,
            "suborder": None,
            "infraorder": None,
            "parvorder": None,
            "superfamily": None,
            "family": clean(row[cols["family"]]) if cols["family"] is not None else None,
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

        extinct_value = clean(row[cols["extinct"]]) if cols["extinct"] is not None else None
        bird["isExtinct"] = bool(
            extinct_value
            and extinct_value.lower() in {
                "yes", "true", "extinct", "possibly extinct"
            }
        )

        birds.append(bird)

        parent_id = "class:Aves"

        for tax_rank in RANKS[RANKS.index("class") + 1:]:
            value = bird.get(tax_rank)
            if not value:
                continue

            current_id = taxon_id(tax_rank, value)

            if current_id not in taxa:
                taxa[current_id] = {
                    "id": current_id,
                    "rank": tax_rank,
                    "name": value,
                    "parent": parent_id,
                    "children": []
                }

                if parent_id in taxa:
                    if current_id not in taxa[parent_id]["children"]:
                        taxa[parent_id]["children"].append(current_id)

            parent_id = current_id

        species_id = taxon_id("species", scientific)

        if species_id not in taxa:
            taxa[species_id] = {
                "id": species_id,
                "rank": "species",
                "name": scientific,
                "commonName": common,
                "parent": parent_id,
                "children": []
            }
            taxa[parent_id]["children"].append(species_id)

    out = Path("data")
    out.mkdir(exist_ok=True)

    (out / "birds.generated.json").write_text(
        json.dumps(birds, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )

    taxonomy = {
        "_meta": {
            "version": 4,
            "masterSource": {
                "name": "AviList: The Global Avian Checklist",
                "version": "2025b"
            },
            "generatedBy": "scripts/import_avilist.py",
            "rankOrder": RANKS,
            "rootTaxa": ["class:Aves"],
            "nodeTypes": ["ranked_taxon", "species"],
            "clades": (
                "Maintained separately from ranked taxonomy. "
                "The game can insert clade nodes between ranked taxa."
            )
        }
    }
    taxonomy.update(taxa)

    (out / "taxonomy.generated.json").write_text(
        json.dumps(taxonomy, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )

    print(f"Imported {len(birds):,} species")
    print(f"Generated {len(taxa):,} ranked taxonomy nodes")
    print("Wrote data/birds.generated.json")
    print("Wrote data/taxonomy.generated.json")

    validate_import(birds, taxa)


if __name__ == "__main__":
    main()
