#!/usr/bin/env python3
"""
Incrementally enrich MetaAves taxonomy/clade data locally.

This script NEVER rebuilds the clade backbone and NEVER replaces an existing
clade path. It only appends missing, already-defined clades from data/clades.json.

For ranked taxonomy, --taxonomy queries Wikidata only for species that are
missing one or more supported intermediate ranks, then writes a reviewable
patch. Nothing is applied unless --apply is supplied.

Usage:
  python scripts/enrich_missing_taxonomy.py
  python scripts/enrich_missing_taxonomy.py --apply
  python scripts/enrich_missing_taxonomy.py --taxonomy
  python scripts/enrich_missing_taxonomy.py --taxonomy --apply
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
import http.client

ROOT = Path(__file__).resolve().parents[1]
BIRDS = ROOT / "data" / "birds.generated.json"
CLADES = ROOT / "data" / "clades.json"
MEMBERSHIP = ROOT / "data" / "clade_membership.generated.json"
ENRICHMENT = ROOT / "data" / "taxonomy_enrichment.generated.json"
CLADE_PATCH = ROOT / "data" / "clade_membership.enrichment.patch.json"
TAXON_PATCH = ROOT / "data" / "taxonomy_enrichment.patch.json"

TARGET_RANKS = (
    "subclass", "infraclass", "superorder", "suborder", "infraorder",
    "parvorder", "superfamily", "subfamily", "tribe", "subtribe", "subgenus",
)

RANK_ORDER = (
    "class", "subclass", "infraclass", "superorder", "order",
    "suborder", "infraorder", "parvorder", "superfamily", "family",
    "subfamily", "tribe", "subtribe", "genus", "subgenus", "species",
)

WIKIDATA = "https://query.wikidata.org/sparql"
BATCH_SIZE = 50
MAX_RETRIES = 5
TIMEOUT = 180


def load(path):
    return json.loads(path.read_text(encoding="utf-8"))


def dump(path, value):
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def merge_expected_path(existing, expected):
    """
    Fill holes in an existing path using the verified expected backbone.

    Existing names are never deleted. Expected names are inserted in their
    backbone order, while any extra existing names are retained afterward.
    """
    existing = list(existing or [])
    expected = list(expected or [])
    expected_set = set(expected)

    merged = []
    seen = set()

    for value in expected:
        if value not in seen:
            merged.append(value)
            seen.add(value)

    for value in existing:
        if value not in seen:
            merged.append(value)
            seen.add(value)

    return merged


def enrich_clade_membership(birds, clades, membership):
    meta = clades.get("_meta", {})
    order_paths = meta.get("orderCladePaths", {})
    family_paths = meta.get("passerineFamilyCladePaths", {})

    current_species = membership.setdefault("species", {})
    current_post = membership.setdefault("postOrderSpecies", {})

    patch_species = {}
    patch_post = {}

    for bird in birds:
        scientific = str(bird.get("scientificName") or "").strip()
        if not scientific:
            continue

        expected = order_paths.get(bird.get("order"), [])
        existing = current_species.get(scientific, [])
        additions = [x for x in expected if x not in existing]

        if additions:
            merged = merge_expected_path(existing, expected)
            patch_species[scientific] = merged

        if bird.get("order") == "Passeriformes":
            expected_post = family_paths.get(bird.get("family"), [])
            existing_post = current_post.get(scientific, [])
            additions_post = [x for x in expected_post if x not in existing_post]
            if additions_post:
                patch_post[scientific] = merge_expected_path(
                    existing_post, expected_post
                )

    return {
        "species": patch_species,
        "postOrderSpecies": patch_post,
    }


def qliteral(value):
    value = str(value).replace("\\", "\\\\")
    value = value.replace('"', '\\"').replace("\n", " ").replace("\r", " ")
    return '"' + value + '"'


def chunks(values, size):
    for i in range(0, len(values), size):
        yield values[i:i + size]


def request_json(query):
    params = urlencode({"query": query, "format": "json"})
    last = None

    for attempt in range(1, MAX_RETRIES + 1):
        req = Request(
            WIKIDATA + "?" + params,
            headers={
                "Accept": "application/sparql-results+json",
                "User-Agent": "MetaAves local taxonomy enrichment/1.0",
                "Connection": "close",
            },
        )
        try:
            with urlopen(req, timeout=TIMEOUT) as response:
                return json.load(response)
        except (
            HTTPError, URLError, TimeoutError,
            http.client.IncompleteRead,
            http.client.RemoteDisconnected,
            ConnectionResetError,
            BrokenPipeError,
        ) as exc:
            last = exc
            if attempt == MAX_RETRIES:
                break
            delay = min(30, 2 ** (attempt - 1) + 1.5)
            print(f"Wikidata request failed ({attempt}/{MAX_RETRIES}): {exc}")
            print(f"Retrying in {delay:.1f}s...")
            time.sleep(delay)

    raise RuntimeError(f"Wikidata request failed after {MAX_RETRIES} attempts: {last}")


def enrich_missing_ranked_taxonomy(birds, existing_output):
    existing_species = existing_output.get("species", {})
    missing = []

    for bird in birds:
        scientific = str(bird.get("scientificName") or "").strip()
        if not scientific:
            continue
        current = existing_species.get(scientific, {})
        if any(rank not in current for rank in TARGET_RANKS):
            missing.append(scientific)

    print(f"Species missing at least one intermediate rank: {len(missing)}")

    enriched_patch = {}
    ambiguous = {}

    query_template = r"""
SELECT ?species ?speciesName ?sitelinks ?ancestorName ?rankLabel WHERE {
  VALUES ?speciesName { %s }

  ?species wdt:P225 ?speciesName ;
           wdt:P105 wd:Q7432 ;
           wdt:P171+ ?ancestor ;
           wikibase:sitelinks ?sitelinks .

  ?ancestor wdt:P225 ?ancestorName ;
            wdt:P105 ?rank .

  SERVICE wikibase:label {
    bd:serviceParam wikibase:language "en".
    ?rank rdfs:label ?rankLabel.
  }

  VALUES ?rankLabel {
    "subclass" "infraclass" "superorder" "suborder"
    "infraorder" "parvorder" "superfamily" "subfamily"
    "tribe" "subtribe" "subgenus"
  }
}
"""

    for batch_no, batch in enumerate(chunks(missing, BATCH_SIZE), 1):
        data = request_json(query_template % " ".join(qliteral(x) for x in batch))
        rows = data.get("results", {}).get("bindings", [])

        # Choose the Wikidata item with the largest sitelink count for each
        # scientific name, matching the existing enrichment policy.
        selected = {}
        item_counts = {}
        for row in rows:
            name = row.get("speciesName", {}).get("value", "")
            uri = row.get("species", {}).get("value", "")
            if not name or not uri:
                continue
            qid = uri.rsplit("/", 1)[-1]
            try:
                count = int(row.get("sitelinks", {}).get("value", "0"))
            except ValueError:
                count = 0
            item_counts.setdefault(name, {})[qid] = count

        for name, items in item_counts.items():
            selected[name] = max(items, key=lambda qid: (items[qid], qid))

        candidates = {}
        for row in rows:
            name = row.get("speciesName", {}).get("value", "")
            uri = row.get("species", {}).get("value", "")
            ancestor = row.get("ancestorName", {}).get("value", "")
            rank = row.get("rankLabel", {}).get("value", "")
            if not name or not uri or not ancestor or rank not in TARGET_RANKS:
                continue
            qid = uri.rsplit("/", 1)[-1]
            if selected.get(name) != qid:
                continue
            candidates.setdefault(name, {}).setdefault(rank, set()).add(ancestor)

        for name, rank_map in candidates.items():
            additions = {}
            for rank, values in rank_map.items():
                values = sorted(values)
                if len(values) == 1:
                    additions[rank] = values[0]
                elif values:
                    ambiguous.setdefault(name, {})[rank] = values

            if additions:
                # Only add ranks absent from the current generated file.
                current = existing_species.get(name, {})
                additions = {
                    rank: value
                    for rank, value in additions.items()
                    if rank not in current
                }
                if additions:
                    enriched_patch[name] = additions

        if batch_no % 10 == 0 or batch_no == 1:
            print(f"Taxonomy batch {batch_no}: {min(batch_no * BATCH_SIZE, len(missing))}/{len(missing)}")
        time.sleep(0.15)

    return {"species": enriched_patch, "ambiguous": ambiguous}


def apply_clade_patch(membership, patch):
    for key, entries in patch.items():
        target = membership.setdefault(key, {})
        for species, path in entries.items():
            target[species] = path


def apply_taxonomy_patch(output, patch):
    target = output.setdefault("species", {})
    for species, ranks in patch.get("species", {}).items():
        target.setdefault(species, {})
        for rank, value in ranks.items():
            # Existing values are sacred: never overwrite.
            target[species].setdefault(rank, value)

    ambiguous = output.setdefault("ambiguous", {})
    for species, ranks in patch.get("ambiguous", {}).items():
        ambiguous.setdefault(species, {})
        for rank, values in ranks.items():
            ambiguous[species].setdefault(rank, values)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="Apply safe missing-data additions.")
    parser.add_argument("--taxonomy", action="store_true", help="Also query Wikidata for missing intermediate ranked taxonomy.")
    args = parser.parse_args()

    for path in (BIRDS, CLADES, MEMBERSHIP):
        if not path.exists():
            raise SystemExit(f"Missing required file: {path}")

    birds = load(BIRDS)
    clades = load(CLADES)
    membership = load(MEMBERSHIP)

    clade_patch = enrich_clade_membership(birds, clades, membership)
    dump(CLade_PATCH, {
        "_meta": {
            "policy": "Append-only. Existing clade memberships are never overwritten.",
            "source": "data/clades.json",
        },
        **clade_patch,
    })

    added_clades = sum(len(v) for v in clade_patch["species"].values())
    added_post = sum(len(v) for v in clade_patch["postOrderSpecies"].values())
    print(f"Clade additions: {added_clades}")
    print(f"Passerine post-order additions: {added_post}")
    print(f"Wrote review patch: {CLade_PATCH}")

    taxonomy_patch = {"species": {}, "ambiguous": {}}
    if args.taxonomy:
        existing = load(ENRICHMENT) if ENRICHMENT.exists() else {"species": {}, "ambiguous": {}}
        taxonomy_patch = enrich_missing_ranked_taxonomy(birds, existing)
        dump(TAXON_PATCH, {
            "_meta": {
                "policy": "Append-only. Existing taxonomy enrichment is never overwritten.",
                "source": "Wikidata P171 + P105",
                "rankOrder": list(RANK_ORDER),
            },
            **taxonomy_patch,
        })
        print(f"Taxonomy additions: {len(taxonomy_patch['species'])} species")
        print(f"Taxonomy ambiguous: {len(taxonomy_patch['ambiguous'])} species")
        print(f"Wrote review patch: {TAXON_PATCH}")

    if not args.apply:
        print("\nDRY RUN: no generated database file was modified.")
        print("Review the patch files, then rerun with --apply.")
        return

    apply_clade_patch(membership, clade_patch)
    dump(MEMBERSHIP, membership)
    print(f"Applied clade enrichment to {MEMBERSHIP}")

    if args.taxonomy:
        if not ENRICHMENT.exists():
            base = {
                "_meta": {
                    "version": 1,
                    "source": "Wikidata taxonomy hierarchy",
                    "rankOrder": list(RANK_ORDER),
                },
                "species": {},
                "ambiguous": {},
            }
        else:
            base = load(ENRICHMENT)
        apply_taxonomy_patch(base, taxonomy_patch)
        base.setdefault("_meta", {})["rankOrder"] = list(RANK_ORDER)
        dump(ENRICHMENT, base)
        print(f"Applied taxonomy enrichment to {ENRICHMENT}")

    print("\nDONE. Existing clade/taxonomy values were preserved; only missing values were added.")


if __name__ == "__main__":
    main()
