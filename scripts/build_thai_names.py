#!/usr/bin/env python3
"""
Build the local Thai bird-name database for MetaAves.

Sources, in priority order:
1. data/thai_name_overrides.json
2. eBird/Clements Thai alternate-name workbook supplied with --ebird-xlsx
3. Avibase species pages (online fallback)
4. Wikidata Thai labels (online fallback)

The generated file is intentionally small: only scientific-name -> Thai-name
pairs are stored. The game loads it locally before using runtime lookups.

Typical use:
    python scripts/build_thai_names.py \
        --ebird-xlsx /path/to/eBird_Taxonomy_v2025_5-tab_30Oct2025.xlsx \
        --strict
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from html import unescape
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import quote, urljoin
from urllib.request import Request, urlopen, urlretrieve

ROOT = Path(__file__).resolve().parents[1]
BIRDS_FILE = ROOT / "data" / "birds.generated.json"
OVERRIDES_FILE = ROOT / "data" / "thai_name_overrides.json"
OUTPUT_FILE = ROOT / "data" / "thai_names.generated.json"
TEMP_EBIRD_XLSX = ROOT / ".cache_ebird_thai_names.xlsx"

AVIBASE_SEARCH = "https://avibase.bsc-eoc.org/search.jsp?qstr={}"
WIKIDATA_SEARCH = (
    "https://www.wikidata.org/w/api.php?action=wbsearchentities"
    "&search={}&language=en&format=json&origin=*"
)
WIKIDATA_ENTITY = (
    "https://www.wikidata.org/w/api.php?action=wbgetentities"
    "&ids={}&props=labels&languages=th&format=json&origin=*"
)

THAI_RE = re.compile(r"[\u0E00-\u0E7F]")
SCIENTIFIC_RE = re.compile(r"\b[A-Z][a-z-]+\s+[a-z-]+\b")


class TextParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []

    def handle_data(self, data):
        if data:
            self.parts.append(data)

    @property
    def text(self):
        return unescape(" ".join(self.parts))


def fetch_text(url: str, timeout: int = 20) -> str:
    request = Request(
        url,
        headers={
            "User-Agent": "MetaAves Thai-name builder/1.0 "
                          "(https://github.com/PrinnBoontanan/MetaAves)"
        },
    )
    with urlopen(request, timeout=timeout) as response:
        return response.read().decode("utf-8", errors="replace")


def normalize_scientific(value: str) -> str:
    words = str(value or "").strip().split()
    return " ".join(words[:2]).lower() if len(words) >= 2 else ""


def is_thai_name(value: str) -> bool:
    value = str(value or "").strip()
    return bool(value) and bool(THAI_RE.search(value))


def load_json(path: Path, default):
    if not path.exists():
        return default
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def load_override_names() -> dict[str, str]:
    data = load_json(OVERRIDES_FILE, {})
    return {
        normalize_scientific(key): str(value).strip()
        for key, value in data.get("names", {}).items()
        if normalize_scientific(key) and is_thai_name(value)
    }


def load_ebird_names(path: Path, scientific_column: str, thai_column: str) -> dict[str, str]:
    try:
        from openpyxl import load_workbook
        from openpyxl.utils.cell import column_index_from_string
    except ImportError:
        raise SystemExit(
            "openpyxl is required for --ebird-xlsx. "
            "Install it in your project environment first."
        )

    workbook = load_workbook(path, read_only=True, data_only=True)
    sheet = workbook[workbook.sheetnames[0]]

    sci_col = column_index_from_string(scientific_column)
    thai_col = column_index_from_string(thai_column)
    names = {}

    for row in sheet.iter_rows(min_row=2, values_only=True):
        scientific = normalize_scientific(row[sci_col - 1] if len(row) >= sci_col else "")
        thai = str(row[thai_col - 1] or "").strip() if len(row) >= thai_col else ""
        if scientific and is_thai_name(thai):
            names[scientific] = thai

    workbook.close()
    return names


def extract_avibase_species_links(html: str) -> list[str]:
    # Avibase search results expose species.jsp links. We keep only unique
    # absolute/relative links and inspect a small number of candidates.
    links = re.findall(
        r'href=["\']([^"\']*species\.jsp[^"\']*)["\']',
        html,
        flags=re.I,
    )
    seen = set()
    result = []
    for link in links:
        absolute = urljoin("https://avibase.bsc-eoc.org/", link)
        if absolute not in seen:
            seen.add(absolute)
            result.append(absolute)
    return result


def extract_avibase_thai(html: str) -> str | None:
    parser = TextParser()
    parser.feed(html)
    text = parser.text
    matches = re.findall(
        r"(?:^|\n)Thai:\s*([^\n]+)",
        text,
        flags=re.I,
    )
    for value in matches:
        value = value.strip(" \t|")
        if is_thai_name(value):
            return value
    return None


def lookup_avibase(scientific: str) -> str | None:
    try:
        search_html = fetch_text(AVIBASE_SEARCH.format(quote(scientific)))
        for link in extract_avibase_species_links(search_html)[:6]:
            try:
                page = fetch_text(link)
                thai = extract_avibase_thai(page)
                if thai:
                    return thai
            except Exception:
                continue
    except Exception:
        return None
    return None


def lookup_wikidata(scientific: str) -> str | None:
    try:
        search = json.loads(fetch_text(WIKIDATA_SEARCH.format(quote(scientific))))
        results = search.get("search", [])
        entity_id = None
        for result in results:
            label = str(result.get("label", "")).strip().lower()
            match_text = str(result.get("match", {}).get("text", "")).strip().lower()
            if label == scientific.lower() or match_text == scientific.lower():
                entity_id = result.get("id")
                break
        if not entity_id and results:
            entity_id = results[0].get("id")
        if not entity_id:
            return None

        entity = json.loads(fetch_text(WIKIDATA_ENTITY.format(quote(entity_id))))
        return (
            entity.get("entities", {})
            .get(entity_id, {})
            .get("labels", {})
            .get("th", {})
            .get("value")
        )
    except Exception:
        return None


def get_thailand_species() -> set[str]:
    # Avibase's current Thailand checklist is used only to determine which
    # MetaAves species require Thai names. The actual names still come from
    # eBird/Avibase/Wikidata.
    url = "https://avibase.bsc-eoc.org/checklist.jsp?lang=EN&list=clements&region=th"
    html = fetch_text(url)
    parser = TextParser()
    parser.feed(html)
    text = parser.text

    # The checklist contains English | scientific | status rows. Extract
    # scientific binomials conservatively.
    found = set()
    for match in re.finditer(
        r"\b([A-Z][a-z-]+\s+[a-z-]+)\b",
        text,
    ):
        found.add(normalize_scientific(match.group(1)))
    return found


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--ebird-xlsx", type=Path)
    parser.add_argument("--download-ebird", action="store_true", help="Download the official eBird v2025 alternate common-name workbook automatically.")
    parser.add_argument("--scientific-column", default="F")
    parser.add_argument("--thai-column", default="DV")
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--delay", type=float, default=0.15)
    parser.add_argument("--strict", action="store_true")
    args = parser.parse_args()

    birds = load_json(BIRDS_FILE, [])
    if not isinstance(birds, list):
        raise SystemExit("data/birds.generated.json is not a bird list.")

    overrides = load_override_names()
    names = dict(overrides)

    ebird_path = args.ebird_xlsx
    if ebird_path is None or args.download_ebird:
        ebird_path = TEMP_EBIRD_XLSX
        print("Downloading official eBird v2025 Thai alternate-name workbook...")
        request = Request(EBIRD_THAI_NAMES_URL, headers={"User-Agent": "MetaAves Thai-name builder/1.0"})
        with urlopen(request, timeout=180) as response, ebird_path.open("wb") as handle:
            handle.write(response.read())

    if ebird_path:
        ebird = load_ebird_names(
            ebird_path,
            args.scientific_column,
            args.thai_column,
        )
        for scientific, thai in ebird.items():
            names.setdefault(scientific, thai)
        print(f"eBird Thai names loaded: {len(ebird)}")

    print("Loading Thailand species list from Avibase...")
    thailand = get_thailand_species()

    local_scientific = {
        normalize_scientific(bird.get("scientificName", ""))
        for bird in birds
        if isinstance(bird, dict)
    }
    targets = sorted((thailand & local_scientific) - set(names))

    thailand_metaaves = thailand & local_scientific
    expected_thailand_count = 1112
    print(f"Thailand species in MetaAves: {len(thailand_metaaves)}")
    if len(thailand_metaaves) != expected_thailand_count:
        raise SystemExit(f"Thailand species coverage mismatch: expected {expected_thailand_count}, found {len(thailand_metaaves)}.")
    print(f"Thai names already known: {len(names)}")
    print(f"Online lookups required: {len(targets)}")

    def resolve(scientific):
        thai = lookup_avibase(scientific)
        if thai:
            return scientific, thai, "Avibase"
        thai = lookup_wikidata(scientific)
        if thai and is_thai_name(thai):
            return scientific, thai.strip(), "Wikidata"
        return scientific, None, "unresolved"

    completed = 0
    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as executor:
        futures = {executor.submit(resolve, sci): sci for sci in targets}
        for future in as_completed(futures):
            scientific, thai, source = future.result()
            if thai:
                names[scientific] = thai
            completed += 1
            if args.delay:
                time.sleep(args.delay)
            if completed % 50 == 0 or completed == len(targets):
                print(f"Resolved {completed}/{len(targets)}")

    unresolved = sorted(
        scientific
        for scientific in thailand_metaaves
        if scientific not in names
    )

    output = {
        "_meta": {
            "description": "Generated Thai common-name database for MetaAves Thailand mode.",
            "source_priority": [
                "data/thai_name_overrides.json",
                "eBird/Clements v2025 Thai alternate common names",
                "Avibase Thailand species pages",
                "Wikidata Thai labels",
            ],
            "generated_by": "scripts/build_thai_names.py",
            "thailand_species_checked": len(thailand & local_scientific),
            "unresolved": len(unresolved),
        },
        "names": {scientific: names[scientific] for scientific in sorted(thailand_metaaves) if scientific in names},
    }

    OUTPUT_FILE.write_text(
        json.dumps(output, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    print(f"Wrote {OUTPUT_FILE}")
    thai_count = len(output["names"])
    print(f"Thai names: {thai_count}/{expected_thailand_count}")
    if thai_count != expected_thailand_count:
        print("ERROR: Thai database is not complete; refusing to report success.")
    print(f"Unresolved Thailand birds: {len(unresolved)}")

    if unresolved:
        print("\nUnresolved scientific names:")
        for scientific in unresolved:
            print(f"  {scientific}")

    if thai_count != expected_thailand_count:
        return 2
    if args.strict and unresolved:
        return 2
    try:
        if TEMP_EBIRD_XLSX.exists() and not args.ebird_xlsx:
            TEMP_EBIRD_XLSX.unlink()
    except OSError:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
