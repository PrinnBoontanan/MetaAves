#!/usr/bin/env python3
"""
Enrich MetaAves' AviList taxonomy with intermediary ranks from NCBI Taxonomy.

The game keeps AviList as the species/checklist source. NCBI is used only to
fill the missing intermediary taxonomic ranks and their parent relationships.

Expected input:
  data/birds.generated.json
  data/taxonomy.generated.json
  data/clade_membership.generated.json
  an NCBI Datasets taxonomy JSONL export for Aves

The NCBI export can be produced with:
  datasets summary taxonomy taxon 8782 --children --as-json-lines > data/ncbi_aves.jsonl

NCBI does not provide every phylogenetic clade as a formal Linnaean rank.
Named clades remain in MetaAves' separate clade layer.
"""

import argparse
import json
import re
from pathlib import Path

SUPPORTED_RANKS = [
    "kingdom",
    "phylum",
    "class",
    "subclass",
    "infraclass",
    "cohort",
    "superorder",
    "order",
    "suborder",
    "infraorder",
    "parvorder",
    "superfamily",
    "family",
    "subfamily",
    "tribe",
    "subtribe",
    "genus",
    "subgenus",
    "species",
]

NCBI_RANKS = set(SUPPORTED_RANKS)
ROOT_TAXID = 8782


def normalize_name(value):
    if not value:
        return ""
    return re.sub(r"\s+", " ", str(value).strip()).casefold()


def load_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def taxonomy_record(line):
    try:
        value = json.loads(line)
    except json.JSONDecodeError:
        return None

    tax = value.get("taxonomy", value)
    if not isinstance(tax, dict):
        return None

    # Current NCBI Datasets JSONL uses snake_case field names
    # (for example tax_id and current_scientific_name). Keep the
    # camelCase variants for compatibility with older exports.
    taxid = tax.get("tax_id")
    if taxid is None:
        taxid = tax.get("taxId")

    rank = str(tax.get("rank") or "").strip().lower()

    scientific = tax.get("current_scientific_name")
    if scientific is None:
        scientific = tax.get("currentScientificName")

    if isinstance(scientific, dict):
        scientific = scientific.get("name")
    elif scientific is None:
        scientific = tax.get("scientific_name") or tax.get("scientificName")

    # NCBI Datasets documents parents as taxids ordered from the
    # immediate parent (most specific) to the most general parent.
    # Therefore the LAST item is the immediate parent.
    parent = tax.get("parent_tax_id")
    if parent is None:
        parent = tax.get("parentTaxId")
    if parent is None:
        parent = tax.get("parentTaxID")
    if parent is None:
        parents = tax.get("parents")
        if isinstance(parents, list) and parents:
            parent = parents[-1]

    if isinstance(parent, dict):
        parent = (
            parent.get("tax_id")
            or parent.get("taxId")
            or parent.get("taxID")
            or parent.get("taxonId")
        )

    if taxid is None or not rank or not scientific:
        return None

    try:
        taxid = int(taxid)
    except (TypeError, ValueError):
        return None

    try:
        parent = int(parent) if parent is not None else None
    except (TypeError, ValueError):
        parent = None

    return {
        "taxId": taxid,
        "parentTaxId": parent,
        "rank": rank,
        "name": str(scientific).strip(),
    }


def load_ncbi(path):
    records = {}
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            record = taxonomy_record(line)
            if record:
                records[record["taxId"]] = record
    return records


def lineage_for_taxid(taxid, records):
    lineage = []
    seen = set()

    while taxid is not None and taxid not in seen:
        seen.add(taxid)
        node = records.get(taxid)
        if node is None:
            break
        lineage.append(node)
        if node["taxId"] == ROOT_TAXID:
            break
        taxid = node["parentTaxId"]

    lineage.reverse()
    return lineage


def node_id(rank, name):
    safe = re.sub(r"[^A-Za-z0-9_-]+", "_", name).strip("_")
    return f"{rank}:{safe}"


def add_taxon(taxa, node, parent_id):
    tax_id = node_id(node["rank"], node["name"])

    existing = taxa.get(tax_id)
    if existing is None:
        taxa[tax_id] = {
            "id": tax_id,
            "rank": node["rank"],
            "name": node["name"],
            "parent": parent_id,
            "children": [],
            "source": "NCBI Taxonomy",
        }
    elif existing.get("parent") != parent_id:
        # Keep the first validated parent. A name collision at the same rank
        # should never silently rewrite an already-built hierarchy.
        return existing["id"]

    if parent_id and parent_id in taxa:
        children = taxa[parent_id].setdefault("children", [])
        if tax_id not in children:
            children.append(tax_id)

    return tax_id


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--ncbi-jsonl", required=True)
    parser.add_argument("--data-dir", default="data")
    args = parser.parse_args()

    data_dir = Path(args.data_dir)
    birds_path = data_dir / "birds.generated.json"
    taxonomy_path = data_dir / "taxonomy.generated.json"

    birds = load_json(birds_path)
    taxonomy = load_json(taxonomy_path)

    records = load_ncbi(args.ncbi_jsonl)
    if not records:
        raise SystemExit("No usable NCBI taxonomy records were found.")

    by_name = {}
    for record in records.values():
        if record["rank"] == "species":
            by_name.setdefault(normalize_name(record["name"]), []).append(record)

    matched = 0
    unmatched = []
    enriched = 0
    used_ranks = set()

    # Rebuild the ranked nodes from actual parent/child relationships rather
    # than assuming that every rank is directly nested in the next rank.
    # This is the important fix for suborder -> infraorder -> parvorder etc.
    new_taxa = {
        "class:Aves": {
            "id": "class:Aves",
            "rank": "class",
            "name": "Aves",
            "parent": None,
            "children": [],
            "source": "AviList + NCBI Taxonomy",
        }
    }

    for bird in birds:
        candidates = by_name.get(normalize_name(bird["scientificName"]), [])
        species_node = candidates[0] if candidates else None

        if species_node is None:
            unmatched.append(bird["scientificName"])
            continue

        lineage = lineage_for_taxid(species_node["taxId"], records)
        ranked_lineage = [
            node for node in lineage
            if node["rank"] in NCBI_RANKS and node["rank"] != "species"
        ]

        # The species/checklist identity remains AviList. NCBI is only used
        # when it can supply an intermediary lineage for that same species.
        if not ranked_lineage:
            unmatched.append(bird["scientificName"])
            continue

        # Ensure the lineage starts at Aves and preserve AviList's canonical
        # order/family/genus values when they are available.
        bird_by_rank = {
            rank: bird.get(rank)
            for rank in SUPPORTED_RANKS
            if bird.get(rank)
        }

        parent_id = "class:Aves"
        last_ranked_name = {"class": "Aves"}

        for node in ranked_lineage:
            rank = node["rank"]
            name = node["name"]

            if rank == "class":
                if name != "Aves":
                    continue
                parent_id = "class:Aves"
                continue

            # Do not replace AviList's accepted order/family/genus names.
            # For those anchor ranks, use the AviList name if it matches the
            # NCBI lineage; otherwise stop enriching below that boundary.
            if rank in {"order", "family", "genus"} and bird_by_rank.get(rank):
                if normalize_name(bird_by_rank[rank]) != normalize_name(name):
                    break
                name = bird_by_rank[rank]

            node_copy = dict(node)
            node_copy["name"] = name
            current_id = add_taxon(new_taxa, node_copy, parent_id)
            parent_id = current_id
            last_ranked_name[rank] = name
            used_ranks.add(rank)

            if rank != "class":
                bird[rank] = name

        species_id = node_id("species", bird["scientificName"])
        if parent_id not in new_taxa:
            parent_id = node_id("genus", bird.get("genus") or bird["scientificName"].split()[0])
            if parent_id not in new_taxa:
                new_taxa[parent_id] = {
                    "id": parent_id,
                    "rank": "genus",
                    "name": bird.get("genus") or bird["scientificName"].split()[0],
                    "parent": "class:Aves",
                    "children": [],
                    "source": "AviList fallback",
                }
                new_taxa["class:Aves"]["children"].append(parent_id)

        new_taxa[species_id] = {
            "id": species_id,
            "rank": "species",
            "name": bird["scientificName"],
            "commonName": bird.get("commonName"),
            "parent": parent_id,
            "children": [],
            "source": "AviList",
        }
        new_taxa[parent_id].setdefault("children", []).append(species_id)

        matched += 1
        if any(
            bird.get(rank)
            for rank in (
                "subclass", "infraclass", "cohort", "superorder",
                "suborder", "infraorder", "parvorder", "superfamily",
                "subfamily", "tribe", "subtribe", "subgenus"
            )
        ):
            enriched += 1

    # Preserve the clade layer metadata while making the ranked dataset
    # explicit about its source policy.
    taxonomy_meta = dict(taxonomy.get("_meta", {}))
    taxonomy_meta.update({
        "version": 5,
        "masterSource": {
            "name": "AviList: The Global Avian Checklist",
            "version": "2025b",
        },
        "intermediateRankSource": {
            "name": "NCBI Taxonomy",
            "rootTaxId": ROOT_TAXID,
            "policy": (
                "AviList remains authoritative for the species checklist and "
                "canonical order/family/genus anchors. NCBI fills intermediary "
                "rank nodes where the lineage matches those anchors."
            ),
        },
        "rankOrder": SUPPORTED_RANKS,
        "nodeTypes": ["ranked_taxon", "species"],
    })

    output = {"_meta": taxonomy_meta}
    output.update(new_taxa)
    taxonomy_path.write_text(
        json.dumps(output, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    birds_path.write_text(
        json.dumps(birds, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print("=== MetaAves NCBI Taxonomy Enrichment ===")
    print(f"NCBI records:             {len(records):,}")
    print(f"AviList species:           {len(birds):,}")
    print(f"Matched species:           {matched:,}")
    print(f"Unmatched species:         {len(unmatched):,}")
    print(f"Species with extra ranks:  {enriched:,}")
    print(f"Taxonomy nodes:             {len(new_taxa):,}")
    print("Ranks observed:")
    for rank in SUPPORTED_RANKS:
        count = sum(1 for node in new_taxa.values() if node.get("rank") == rank)
        if count:
            print(f"  {rank:12} {count:,}")

    if unmatched:
        print("First unmatched species:")
        for name in unmatched[:20]:
            print(f"  - {name}")


if __name__ == "__main__":
    main()
