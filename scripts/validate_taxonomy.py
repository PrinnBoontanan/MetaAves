#!/usr/bin/env python3
"""Validate the current MetaAves taxonomy and clade data."""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BIRDS = ROOT / "data" / "birds.generated.json"
TAXONOMY = ROOT / "data" / "taxonomy.generated.json"
CLADES = ROOT / "data" / "clades.json"
MEMBERSHIP = ROOT / "data" / "clade_membership.generated.json"

CORE_RANKS = ("class", "order", "family", "genus")
MEMBERSHIP_SECTIONS = ("species", "postOrderSpecies")


def load(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def fail(message: str):
    raise SystemExit(f"Taxonomy validation FAILED: {message}")


def main() -> None:
    for path in (BIRDS, TAXONOMY, CLADES, MEMBERSHIP):
        if not path.exists():
            fail(f"missing required file: {path}")

    birds = load(BIRDS)
    taxonomy = load(TAXONOMY)
    clades = load(CLADES)
    membership = load(MEMBERSHIP)

    if not isinstance(birds, list) or not birds:
        fail("birds.generated.json is empty or not a list")

    bird_by_scientific = {}
    for bird in birds:
        scientific = str(bird.get("scientificName") or "").strip()
        if not scientific:
            fail("bird record is missing scientificName")
        if scientific in bird_by_scientific:
            fail(f"duplicate scientificName: {scientific}")
        bird_by_scientific[scientific] = bird

        for rank in CORE_RANKS:
            if not str(bird.get(rank) or "").strip():
                fail(f"{scientific} is missing {rank}")

    taxonomy_species = taxonomy.get("species", {}) if isinstance(taxonomy, dict) else {}
    for scientific, ranks in taxonomy_species.items():
        if scientific not in bird_by_scientific:
            fail(f"taxonomy contains unknown species: {scientific}")
        if not isinstance(ranks, dict):
            fail(f"taxonomy ranks are not an object: {scientific}")

    meta = clades.get("_meta", {})
    order_paths = meta.get("orderCladePaths", {})
    family_paths = meta.get("passerineFamilyCladePaths", {})

    if not isinstance(order_paths, dict):
        fail("clades._meta.orderCladePaths is missing or invalid")
    if not isinstance(family_paths, dict):
        fail("clades._meta.passerineFamilyCladePaths is missing or invalid")

    known_clades = set()

    def collect_paths(value):
        if isinstance(value, list):
            for name in value:
                if isinstance(name, str) and name.strip():
                    known_clades.add(name.strip())

    for path in order_paths.values():
        collect_paths(path)
    for path in family_paths.values():
        collect_paths(path)

    if not known_clades:
        fail("no clades were found in clades.json")

    for section in MEMBERSHIP_SECTIONS:
        entries = membership.get(section, {})
        if not isinstance(entries, dict):
            fail(f"membership.{section} is not an object")

        for scientific, path in entries.items():
            if scientific not in bird_by_scientific:
                fail(f"membership.{section} contains unknown species: {scientific}")
            if not isinstance(path, list):
                fail(f"membership.{section}[{scientific}] is not a list")
            if len(path) != len(set(path)):
                fail(f"duplicate clade in membership.{section}: {scientific}")
            for clade in path:
                if clade not in known_clades:
                    fail(
                        f"membership.{section}[{scientific}] references unknown clade: {clade}"
                    )

    # Every clade membership path must agree with the parent links declared in clades.json.
    clade_parent_by_name = {}
    for clade_id, entry in clades.items():
        if not isinstance(clade_id, str) or not clade_id.startswith("clade:") or not isinstance(entry, dict):
            continue
        name = str(entry.get("name") or "").strip()
        if not name:
            continue
        parent = str(entry.get("parent") or "").strip()
        clade_parent_by_name[name] = parent.split(":", 1)[1] if parent.startswith("clade:") else parent or None

    def check_clade_path(path, label):
        for index in range(1, len(path)):
            child = path[index]
            expected_parent = path[index - 1]
            declared_parent = clade_parent_by_name.get(child)
            if declared_parent and declared_parent != expected_parent:
                fail(
                    f"{label} has inconsistent clade parent: "
                    f"{child} declares {declared_parent}, path says {expected_parent}"
                )

    for section in MEMBERSHIP_SECTIONS:
        for scientific, path in membership.get(section, {}).items():
            check_clade_path(path, f"membership.{section}[{scientific}]")

    # Parent/children links in clades.json must agree in both directions.
    for clade_id, entry in clades.items():
        if not isinstance(clade_id, str) or not clade_id.startswith("clade:") or not isinstance(entry, dict):
            continue
        parent = entry.get("parent")
        if parent:
            if parent not in clades:
                fail(f"{clade_id} references missing parent {parent}")
            if clade_id not in (clades[parent].get("children") or []):
                fail(f"{clade_id} is missing from its parent's children list")
        for child in entry.get("children") or []:
            if child not in clades:
                fail(f"{clade_id} references missing child {child}")
            if clades[child].get("parent") != clade_id:
                fail(f"{child} declares {clades[child].get('parent')} but is listed under {clade_id}")

    # Every order with a configured clade backbone must use only that backbone.
    checked_order_paths = 0
    for scientific, bird in bird_by_scientific.items():
        expected = order_paths.get(bird.get("order"))
        actual = membership.get("species", {}).get(scientific, [])
        if expected:
            checked_order_paths += 1
            missing = [clade for clade in expected if clade not in actual]
            if missing:
                fail(
                    f"{scientific} is missing expected order clades: "
                    + ", ".join(missing)
                )

        if bird.get("order") == "Passeriformes":
            expected_post = family_paths.get(bird.get("family"))
            if expected_post:
                actual_post = membership.get("postOrderSpecies", {}).get(scientific, [])
                missing_post = [clade for clade in expected_post if clade not in actual_post]
                if missing_post:
                    fail(
                        f"{scientific} is missing expected passerine clades: "
                        + ", ".join(missing_post)
                    )

    if checked_order_paths == 0:
        fail("no configured order clade paths were checked")

    print(f"Bird species validated: {len(bird_by_scientific)}")
    print(f"Configured order backbones checked: {checked_order_paths}")
    print(f"Known clade names: {len(known_clades)}")
    print(f"Species clade memberships: {len(membership.get('species', {}))}")
    print(f"Passerine post-order memberships: {len(membership.get('postOrderSpecies', {}))}")
    print("Current taxonomy/clade validation: PASS")


if __name__ == "__main__":
    main()
