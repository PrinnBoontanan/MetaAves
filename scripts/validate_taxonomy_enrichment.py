#!/usr/bin/env python3
"""Validate MetaAves global taxonomy enrichment output."""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BIRDS = ROOT / "data" / "birds.generated.json"
ENRICHMENT = ROOT / "data" / "taxonomy_enrichment.generated.json"

TARGET_RANKS = (
    "subclass",
    "infraclass",
    "superorder",
    "suborder",
    "infraorder",
    "parvorder",
    "superfamily",
    "subfamily",
    "tribe",
    "subtribe",
    "subgenus",
)


def main() -> None:
    birds = json.loads(BIRDS.read_text(encoding="utf-8"))
    output = json.loads(ENRICHMENT.read_text(encoding="utf-8"))

    species_names = {
        str(b.get("scientificName") or "").strip()
        for b in birds
        if str(b.get("scientificName") or "").strip()
    }

    enriched = output.get("species", {})
    if not isinstance(enriched, dict):
        raise SystemExit("Invalid enrichment: species must be an object.")

    unknown_species = sorted(set(enriched) - species_names)
    if unknown_species:
        raise SystemExit(
            f"Invalid enrichment: {len(unknown_species)} species are not in birds.generated.json."
        )

    invalid_ranks = []
    counts = {rank: 0 for rank in TARGET_RANKS}

    for species, ranks in enriched.items():
        if not isinstance(ranks, dict):
            raise SystemExit(f"Invalid enrichment for {species}: ranks must be an object.")

        for rank, value in ranks.items():
            if rank not in TARGET_RANKS:
                invalid_ranks.append((species, rank))
                continue
            if not isinstance(value, str) or not value.strip():
                raise SystemExit(f"Invalid empty value: {species} -> {rank}")
            counts[rank] += 1

    if invalid_ranks:
        sample = ", ".join(f"{species}:{rank}" for species, rank in invalid_ranks[:10])
        raise SystemExit(f"Unknown rank fields found: {sample}")

    print(f"Bird species in backbone: {len(species_names)}")
    print(f"Species with enrichment: {len(enriched)}")
    print()
    for rank in TARGET_RANKS:
        print(f"{rank:12} {counts[rank]:5}/{len(species_names)}")

    ambiguous = output.get("ambiguous", {})
    print()
    print(f"Ambiguous species retained for review: {len(ambiguous)}")
    print("Taxonomy enrichment validation: PASS")


if __name__ == "__main__":
    main()
