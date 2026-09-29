#!/usr/bin/env python3
"""
Build-time intermediate taxonomy enrichment for MetaAves.

AviList remains authoritative for class/order/family/genus/species.
Wikidata is used only to recover intermediate ranks that AviList does not
publish for a species.  We follow the Wikidata parent-taxon hierarchy (P171)
and taxon-rank property (P105), preferring Wikidata's best-ranked statements.

Output:
  data/taxonomy_enrichment.generated.json
"""

from __future__ import annotations

import http.client
import json
import sys
import time
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

ROOT = Path(__file__).resolve().parents[1]
BIRDS = ROOT / "data" / "birds.generated.json"
OUT = ROOT / "data" / "taxonomy_enrichment.generated.json"

ENDPOINT = "https://query.wikidata.org/sparql"
BATCH_SIZE = 50
SLEEP_SECONDS = 0.15
MAX_RETRIES = 5
REQUEST_TIMEOUT = 180

TARGET_RANKS = {
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
}

QUERY = r"""
SELECT ?species ?speciesName ?sitelinks ?ancestorName ?rankLabel WHERE {
  VALUES ?speciesName {
    %s
  }

  ?species wdt:P225 ?speciesName ;
           wdt:P105 wd:Q7432 ;
           wdt:P171+ ?ancestor ;
           wikibase:sitelinks ?sitelinks .

  # Prefer Wikidata taxa that have an English Wikipedia article.
  # This removes many duplicate/historical Wikidata items that share
  # the same scientific name but represent different taxonomic viewpoints.
  ?article schema:about ?species ;
           schema:isPartOf <https://en.wikipedia.org/> .

  ?ancestor wdt:P225 ?ancestorName ;
            wdt:P105 ?rank .

  SERVICE wikibase:label {
    bd:serviceParam wikibase:language "en".
    ?rank rdfs:label ?rankLabel.
  }

  VALUES ?rankLabel {
    "subclass"
    "infraclass"
    "superorder"
    "suborder"
    "infraorder"
    "parvorder"
    "superfamily"
    "subfamily"
    "tribe"
    "subtribe"
    "subgenus"
  }
}
"""

def qliteral(value: str) -> str:
    # SPARQL string literal with escaped quotes/backslashes/newlines.
    value = value.replace("\\", "\\\\")
    value = value.replace('"', '\"')
    value = value.replace("\n", " ")
    value = value.replace("\r", " ")
    return '"' + value + '"'

def request_json(params: dict) -> dict:
    url = ENDPOINT + "?" + urlencode(params)

    last_error = None

    for attempt in range(1, MAX_RETRIES + 1):
        req = Request(
            url,
            headers={
                "Accept": "application/sparql-results+json",
                "User-Agent": "MetaAves taxonomy enrichment/1.0 (GitHub Actions)",
                "Connection": "close",
            },
        )

        try:
            with urlopen(req, timeout=REQUEST_TIMEOUT) as response:
                return json.load(response)

        except (
            HTTPError,
            URLError,
            TimeoutError,
            http.client.IncompleteRead,
            http.client.RemoteDisconnected,
            ConnectionResetError,
            BrokenPipeError,
        ) as exc:
            last_error = exc

            if attempt == MAX_RETRIES:
                break

            delay = min(30, (2 ** (attempt - 1)) + 1.5)
            print(
                f"Wikidata request interrupted "
                f"(attempt {attempt}/{MAX_RETRIES}): {exc}"
            )
            print(f"Retrying in {delay:.1f}s...")
            time.sleep(delay)

    raise RuntimeError(
        f"Wikidata request failed after {MAX_RETRIES} attempts: {last_error}"
    )

def chunks(items, size):
    for i in range(0, len(items), size):
        yield items[i:i + size]

def main():
    if not BIRDS.exists():
        raise SystemExit(f"Missing {BIRDS}")

    birds = json.loads(BIRDS.read_text(encoding="utf-8"))
    names = []
    for bird in birds:
        scientific = str(bird.get("scientificName") or "").strip()
        if scientific:
            names.append(scientific)

    names = sorted(set(names))
    enriched = {}
    ambiguous = {}

    print(f"Species to enrich: {len(names)}")

    for batch_number, batch in enumerate(chunks(names, BATCH_SIZE), start=1):
        values = " ".join(qliteral(name) for name in batch)
        query = QUERY % values

        data = request_json({
            "query": query,
            "format": "json",
        })

        rows = data.get("results", {}).get("bindings", [])

        # A scientific name can correspond to multiple Wikidata items
        # (accepted taxa, historical taxa, or taxonomic alternatives).
        # Pick the English-Wikipedia-linked item with the highest sitelink
        # count before evaluating its parent taxonomy.
        species_items = {}
        for row in rows:
            species = row.get("speciesName", {}).get("value", "")
            species_uri = row.get("species", {}).get("value", "")
            sitelinks_raw = row.get("sitelinks", {}).get("value", "0")

            if not species or not species_uri:
                continue

            species_qid = species_uri.rsplit("/", 1)[-1]

            try:
                sitelinks = int(sitelinks_raw)
            except ValueError:
                sitelinks = 0

            species_items.setdefault(species, {})[species_qid] = sitelinks

        selected_species = {}
        for species, items in species_items.items():
            selected_species[species] = max(
                items,
                key=lambda qid: (items[qid], qid),
            )

        candidates = {}
        for row in rows:
            species = row.get("speciesName", {}).get("value", "")
            species_uri = row.get("species", {}).get("value", "")
            ancestor = row.get("ancestorName", {}).get("value", "")
            rank = row.get("rankLabel", {}).get("value", "")

            if not species or not species_uri or not ancestor:
                continue

            if rank not in TARGET_RANKS:
                continue

            species_qid = species_uri.rsplit("/", 1)[-1]
            if selected_species.get(species) != species_qid:
                continue

            candidates.setdefault(species, {}).setdefault(rank, set()).add(ancestor)

        for species, rank_map in candidates.items():
            clean = {}
            for rank, values_for_rank in rank_map.items():
                values_for_rank = sorted(values_for_rank)
                if len(values_for_rank) == 1:
                    clean[rank] = values_for_rank[0]
                elif values_for_rank:
                    # Do not silently invent a classification when Wikidata
                    # exposes genuinely different parent-taxonomy viewpoints.
                    ambiguous.setdefault(species, {})[rank] = values_for_rank

            if clean:
                enriched[species] = clean

        if batch_number % 10 == 0 or batch_number == 1:
            print(
                f"Batch {batch_number}: "
                f"{min(batch_number * BATCH_SIZE, len(names))}/{len(names)}"
            )

        time.sleep(SLEEP_SECONDS)

    output = {
        "_meta": {
            "version": 1,
            "source": "Wikidata taxonomy hierarchy",
            "property": "P171 parent taxon + P105 taxon rank",
            "policy": (
                "Supplemental only. AviList remains authoritative for the "
                "core ranked taxonomy. When multiple Wikidata items share "
                "a scientific name, the English-Wikipedia-linked item with "
                "the highest sitelink count is selected. Ambiguous ranks "
                "within that selected hierarchy are retained in the "
                "ambiguity report and are not automatically applied."
            ),
            "species_total": len(names),
            "species_with_enrichment": len(enriched),
            "ambiguous_species": len(ambiguous),
            "generated_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        },
        "species": enriched,
        "ambiguous": ambiguous,
    }

    OUT.write_text(
        json.dumps(output, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    print(f"Wrote {OUT}")
    print(f"Enriched species: {len(enriched)}")
    print(f"Ambiguous species: {len(ambiguous)}")

if __name__ == "__main__":
    main()
