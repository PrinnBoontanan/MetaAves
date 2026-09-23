#!/usr/bin/env python3
"""Apply controlled supplemental suborder/infraorder/parvorder taxonomy.

This layer supplements the AviList + NCBI backbone. It is intentionally
separate from NCBI enrichment so the source and treatment remain explicit.
Current scope: Passeriformes, using the Wikipedia Passerine page's
Oliveros et al. (2019) treatment.
"""
import json
import re
from pathlib import Path

DATA_DIR = Path("data")
SOURCE_PATH = DATA_DIR / "supplemental_taxonomy.json"
TAXONOMY_PATH = DATA_DIR / "taxonomy.generated.json"
BIRDS_PATH = DATA_DIR / "birds.generated.json"

INSERT_RANKS = ("suborder", "infraorder", "parvorder")


def node_id(rank, name):
    safe = re.sub(r"[^A-Za-z0-9_-]+", "_", name).strip("_")
    return f"{rank}:{safe}"


def load(path):
    return json.loads(path.read_text(encoding="utf-8"))


def descendants(taxa, root_id):
    result = []
    stack = list(taxa.get(root_id, {}).get("children", []))
    seen = set()
    while stack:
        current = stack.pop()
        if current in seen:
            continue
        seen.add(current)
        node = taxa.get(current)
        if not node:
            continue
        result.append(current)
        stack.extend(node.get("children", []))
    return result


def descendant_families(taxa, root_id):
    families = set()
    for taxon_id in descendants(taxa, root_id):
        node = taxa.get(taxon_id, {})
        if node.get("rank") == "family":
            families.add(node.get("name"))
    if taxa.get(root_id, {}).get("rank") == "family":
        families.add(taxa[root_id].get("name"))
    return families


def add_node(taxa, rank, name, parent_id, source_meta):
    taxon_id = node_id(rank, name)
    existing = taxa.get(taxon_id)
    if existing is None:
        taxa[taxon_id] = {
            "id": taxon_id,
            "rank": rank,
            "name": name,
            "parent": parent_id,
            "children": [],
            "source": "Wikipedia",
            "sourcePage": source_meta["sourcePage"],
            "sourceTreatment": source_meta["sourceTreatment"],
        }
    elif existing.get("parent") != parent_id:
        raise RuntimeError(
            f"Supplemental node parent conflict: {taxon_id}: "
            f"{existing.get('parent')} vs {parent_id}"
        )

    children = taxa[parent_id].setdefault("children", [])
    if taxon_id not in children:
        children.append(taxon_id)
    return taxon_id


def reparent(taxa, node_id_value, new_parent):
    node = taxa[node_id_value]
    old_parent = node.get("parent")
    if old_parent == new_parent:
        return
    if old_parent and old_parent in taxa:
        old_children = taxa[old_parent].setdefault("children", [])
        if node_id_value in old_children:
            old_children.remove(node_id_value)
    node["parent"] = new_parent
    new_children = taxa[new_parent].setdefault("children", [])
    if node_id_value not in new_children:
        new_children.append(node_id_value)


def main():
    taxa = load(TAXONOMY_PATH)
    source = load(SOURCE_PATH)
    birds = load(BIRDS_PATH)

    order_id = node_id("order", "Passeriformes")
    if order_id not in taxa:
        print("No Passeriformes node found; supplemental layer skipped.")
        return

    groups = source["groups"]

    # Build a family -> desired path. Every family in this source has one
    # unambiguous path in the published treatment. The longest path wins.
    family_paths = {}
    for group in groups:
        prefix = []
        parent_rank = group["parentRank"]
        parent_name = group["parentName"]

        if parent_rank == "order":
            prefix = [(group["rank"], group["name"])]
        else:
            parent_path = family_paths.get(parent_name)
            # Parent names are globally unique for these ranks.
            if parent_path is None:
                parent_path = []
            prefix = parent_path + [(group["rank"], group["name"])]

        for family in group["families"]:
            current = family_paths.get(family, [])
            if len(prefix) > len(current):
                family_paths[family] = prefix

    # The explicit group definitions above are easier to reason about if we
    # derive paths from the group graph rather than relying on ordering.
    by_key = {(g["rank"], g["name"]): g for g in groups}

    def path_for(group):
        if group["parentRank"] == "order":
            return [(group["rank"], group["name"])]
        parent_key = (group["parentRank"], group["parentName"])
        parent = by_key.get(parent_key)
        if parent is None:
            raise RuntimeError(f"Missing supplemental parent: {parent_key}")
        return path_for(parent) + [(group["rank"], group["name"])]

    family_paths = {}
    for group in groups:
        path = path_for(group)
        for family in group["families"]:
            old = family_paths.get(family)
            if old and old != path:
                # A family may appear in a broad group and a more specific
                # group. The more specific path is the useful one.
                if len(path) < len(old):
                    continue
            if not old or len(path) >= len(old):
                family_paths[family] = path

    # Create every node required by the source treatment.
    created = 0
    for group in groups:
        parent_id = node_id(group["parentRank"], group["parentName"])
        if parent_id not in taxa:
            # Parent may itself be supplemental.
            raise RuntimeError(f"Missing taxonomy parent: {parent_id}")
        taxon_id = node_id(group["rank"], group["name"])
        before = taxon_id in taxa
        add_node(taxa, group["rank"], group["name"], parent_id, source["_meta"])
        if not before:
            created += 1

    # For each existing direct child of Passeriformes, determine the deepest
    # supplemental path shared by all mapped families below that child.
    direct_children = list(taxa[order_id].get("children", []))
    moved = 0
    covered_families = set()

    for child_id in direct_children:
        families = descendant_families(taxa, child_id)
        mapped = [family_paths[f] for f in families if f in family_paths]
        if not mapped:
            continue

        # Find the longest common prefix of the desired paths.
        common = list(mapped[0])
        for path in mapped[1:]:
            limit = min(len(common), len(path))
            i = 0
            while i < limit and common[i] == path[i]:
                i += 1
            common = common[:i]
            if not common:
                break

        if not common:
            continue

        parent_id = order_id
        for rank, name in common:
            parent_id = node_id(rank, name)

        if child_id != parent_id:
            reparent(taxa, child_id, parent_id)
            moved += 1

        covered_families.update(families.intersection(family_paths))

    # Record supplemental rank values on birds for easy UI/data access.
    for bird in birds:
        if bird.get("order") != "Passeriformes":
            continue
        path = family_paths.get(bird.get("family"))
        if not path:
            continue
        for rank, name in path:
            bird[rank] = name

    meta = taxa.setdefault("_meta", {})
    meta["supplementalTaxonomy"] = {
        "name": source["_meta"]["name"],
        "source": source["_meta"]["source"],
        "sourcePage": source["_meta"]["sourcePage"],
        "sourceTreatment": source["_meta"]["sourceTreatment"],
        "scope": source["_meta"]["scope"],
        "mappedFamilies": len(family_paths),
        "coveredFamilies": len(covered_families),
    }

    TAXONOMY_PATH.write_text(
        json.dumps(taxa, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    BIRDS_PATH.write_text(
        json.dumps(birds, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print("=== Supplemental Taxonomy ===")
    print(f"Source:                    {source['_meta']['source']}")
    print(f"Mapped Passeriformes families: {len(family_paths):,}")
    print(f"Covered families:           {len(covered_families):,}")
    print(f"Supplemental nodes created: {created:,}")
    print(f"Existing branches reparented: {moved:,}")

    if covered_families != set(family_paths):
        missing = sorted(set(family_paths) - covered_families)
        print("Families not connected into the supplemented tree:")
        for family in missing[:30]:
            print(f"  - {family}")
        raise SystemExit(
            f"Supplemental taxonomy incomplete: {len(missing)} families not connected."
        )

    print("SUPPLEMENTAL VALIDATION PASSED")


if __name__ == "__main__":
    main()
