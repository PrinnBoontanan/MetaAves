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

    taxonomy_species = {
        str(entry.get("name") or "").strip(): entry
        for entry in taxonomy.values()
        if isinstance(entry, dict) and entry.get("rank") == "species"
    } if isinstance(taxonomy, dict) else {}
    for scientific in taxonomy_species:
        if scientific not in bird_by_scientific:
            fail(f"taxonomy contains unknown species: {scientific}")
    for scientific, bird in bird_by_scientific.items():
        species_node = taxonomy_species.get(scientific)
        if not species_node:
            fail(f"taxonomy is missing a species node for {scientific}")
        genus_node = taxonomy.get(species_node.get("parent"))
        if not isinstance(genus_node, dict) or genus_node.get("rank") != "genus" or genus_node.get("name") != bird.get("genus"):
            fail(f"species-to-genus taxonomy link is inconsistent for {scientific}")
        family_node = taxonomy.get(genus_node.get("parent"))
        if not isinstance(family_node, dict) or family_node.get("rank") != "family" or family_node.get("name") != bird.get("family"):
            fail(f"genus-to-family taxonomy link is inconsistent for {scientific}")
        order_node = taxonomy.get(family_node.get("parent"))
        if not isinstance(order_node, dict) or order_node.get("rank") != "order" or order_node.get("name") != bird.get("order"):
            fail(f"family-to-order taxonomy link is inconsistent for {scientific}")
        class_node = taxonomy.get(order_node.get("parent"))
        if not isinstance(class_node, dict) or class_node.get("rank") != "class" or class_node.get("name") != "Aves":
            fail(f"order-to-Aves taxonomy link is inconsistent for {scientific}")

    meta = clades.get("_meta", {})
    order_paths = meta.get("orderCladePaths", {})
    passerine_family_paths = meta.get("passerineFamilyCladePaths", {})
    nonpasserine_family_paths = meta.get("nonpasserineFamilyCladePaths", {})
    family_paths = {**passerine_family_paths, **nonpasserine_family_paths}

    if not isinstance(order_paths, dict):
        fail("clades._meta.orderCladePaths is missing or invalid")
    if not isinstance(family_paths, dict):
        fail("clades._meta.passerineFamilyCladePaths is missing or invalid")

    bird_orders = {str(bird.get("order") or "").strip() for bird in birds}
    bird_passerine_families = {
        str(bird.get("family") or "").strip()
        for bird in birds
        if bird.get("order") == "Passeriformes"
    }
    bird_nonpasserine_families = {
        str(bird.get("family") or "").strip()
        for bird in birds
        if bird.get("order") != "Passeriformes"
    }
    missing_order_backbones = sorted(bird_orders - set(order_paths))
    extra_order_backbones = sorted(set(order_paths) - bird_orders)
    if missing_order_backbones:
        fail("missing clade backbone for orders: " + ", ".join(missing_order_backbones))
    if extra_order_backbones:
        fail("stale clade backbone for orders: " + ", ".join(extra_order_backbones))
    missing_passerine_families = sorted(bird_passerine_families - set(passerine_family_paths))
    extra_passerine_families = sorted(set(passerine_family_paths) - bird_passerine_families)
    extra_nonpasserine_families = sorted(set(nonpasserine_family_paths) - bird_nonpasserine_families)
    if missing_passerine_families:
        fail("missing passerine clade mapping for families: " + ", ".join(missing_passerine_families))
    if extra_passerine_families:
        fail("stale passerine clade mapping for families: " + ", ".join(extra_passerine_families))
    if extra_nonpasserine_families:
        fail("stale non-passerine clade mapping for families: " + ", ".join(extra_nonpasserine_families))

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

    # Membership can legitimately include a documented intermediate clade
    # that is defined in clades.json but is not part of the current order- or
    # family-level backbone shortcuts (for example Muscicapida). The clade
    # registry is the authoritative set of valid named clades; the backbone
    # paths are only the expected inherited subsets checked below.
    for clade_id, entry in clades.items():
        if (
            isinstance(clade_id, str) and
            clade_id.startswith("clade:") and
            isinstance(entry, dict)
        ):
            name = str(entry.get("name") or "").strip()
            if name:
                known_clades.add(name)

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

    # Every bird whose order has a configured phylogenetic backbone must inherit
    # every clade in that backbone. This checks the whole species list, not
    # selected examples, and catches missing clades during data regeneration.
    for scientific, bird in bird_by_scientific.items():
        expected_order_path = order_paths.get(bird.get("order"), [])
        actual_path = membership.get("species", {}).get(scientific)
        if expected_order_path and not isinstance(actual_path, list):
            fail(f"{scientific} has no species clade-membership path")
        expected_family_path = family_paths.get(bird.get("family"), [])
        missing = [name for name in [*expected_order_path, *expected_family_path] if name not in (actual_path or [])]
        if missing:
            fail(f"{scientific} is missing expected order/family clades: " + ", ".join(missing))
        expected_post_path = family_paths.get(bird.get("family"), [])
        actual_post_path = membership.get("postOrderSpecies", {}).get(scientific, [])
        if expected_post_path and not isinstance(actual_post_path, list):
            fail(f"{scientific} is missing its family-level post-order clade path")
        missing_post = [name for name in expected_post_path if name not in (actual_post_path or [])]
        if missing_post:
            fail(f"{scientific} is missing family-level post-order clades: " + ", ".join(missing_post))

    for order in ("Procellariiformes", "Sphenisciformes"):
        if "Feraequornithes" not in order_paths.get(order, []):
            fail(f"{order} is missing the documented Feraequornithes clade")
    if "Feraequornithes" in order_paths.get("Gaviiformes", []):
        fail("Gaviiformes must remain outside Feraequornithes")

    # Membership lists are sets of clades containing a species, not literal
    # parent-to-child paths. Structural parent relationships are validated
    # directly from clades.json below.
    # Parent/children links in clades.json must agree in both directions.
    for clade_id, entry in clades.items():
        if not isinstance(clade_id, str) or not clade_id.startswith("clade:") or not isinstance(entry, dict):
            continue
        parent = entry.get("parent")
        if parent:
            if parent not in clades:
                # Some clades intentionally attach directly to a ranked taxon
                # such as the Passeriformes order rather than to another clade.
                ranked_name = parent.split(":", 1)[1] if ":" in parent else parent
                if (
                    parent not in taxonomy and
                    not any(key.endswith(":" + ranked_name) for key in taxonomy if isinstance(key, str))
                ):
                    fail(f"{clade_id} references missing parent {parent}")
            elif clade_id not in (clades[parent].get("children") or []):
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
