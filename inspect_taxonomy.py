import json
from pathlib import Path
from collections import Counter, defaultdict

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"

birds_file = DATA / "birds.generated.json"
taxonomy_file = DATA / "taxonomy.generated.json"

print("MetaAves Taxonomy Inspector")
print("=" * 60)

with birds_file.open("r", encoding="utf-8") as f:
    birds = json.load(f)

with taxonomy_file.open("r", encoding="utf-8") as f:
    taxonomy = json.load(f)

print(f"\nBirds:    {len(birds):,}")
print(f"Taxa:     {len(taxonomy):,}")

# ------------------------------------------------------------
# 1. Count ranks
# ------------------------------------------------------------

rank_counts = Counter(
    taxon.get("rank")
    for taxon in taxonomy.values()
    if isinstance(taxon, dict)
)

print("\nRANK COUNTS")
print("-" * 60)

for rank, count in sorted(
    rank_counts.items(),
    key=lambda item: str(item[0])
):
    rank_name = str(rank) if rank is not None else "(no rank)"
    print(f"{rank_name:15} {count:>6,}")

# ------------------------------------------------------------
# 2. Look specifically for intermediary ranks
# ------------------------------------------------------------

interesting_ranks = [
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

print("\nINTERMEDIARY RANKS")
print("-" * 60)

for rank in interesting_ranks:
    count = rank_counts.get(rank, 0)
    print(f"{rank:15} {count:>6,}")

# ------------------------------------------------------------
# 3. Find Passeriformes and everything underneath it
# ------------------------------------------------------------

print("\nPASSERIFORMES HIERARCHY")
print("-" * 60)

passeriformes = []

for taxon in taxonomy.values():
    if (
        isinstance(taxon, dict)
        and taxon.get("name") == "Passeriformes"
        and taxon.get("rank") == "order"
    ):
        passeriformes.append(taxon)

if not passeriformes:
    print("Passeriformes was NOT found.")
else:
    for p in passeriformes:
        print(f"FOUND: {p.get('id')}")
        print(f"Name:   {p.get('name')}")
        print(f"Rank:   {p.get('rank')}")
        print(f"Parent: {p.get('parent')}")

        children = [
            t for t in taxonomy.values()
            if isinstance(t, dict) and t.get("parent") == p.get("id")
        ]

        print("\nDirect children:")

        for child in sorted(
            children,
            key=lambda x: (x.get("rank", ""), x.get("name", ""))
        ):
            print(
                f"  {child.get('rank'):15} "
                f"{child.get('name')}"
            )

# ------------------------------------------------------------
# 4. Check birds whose taxonomy path is broken
# ------------------------------------------------------------

print("\nBROKEN TAXONOMY PATHS")
print("-" * 60)

broken = []

for bird in birds:
    scientific = bird.get("scientificName")

    if not scientific:
        continue

    # Support both possible ID styles.
    possible_ids = [
        f"species:{scientific}",
        f"species:{scientific.replace(' ', '_')}"
    ]

    species_taxon = None

    for taxon_id in possible_ids:
        if taxon_id in taxonomy:
            species_taxon = taxonomy[taxon_id]
            break

    if species_taxon is None:
        broken.append(
            (scientific, "species node missing")
        )
        continue

    current = species_taxon
    seen = set()

    while current:
        taxon_id = current.get("id")

        if taxon_id in seen:
            broken.append(
                (scientific, "taxonomy cycle")
            )
            break

        seen.add(taxon_id)

        parent_id = current.get("parent")

        if not parent_id:
            if current.get("id") != "class:Aves":
                broken.append(
                    (scientific, f"ends at {current.get('id')}")
                )
            break

        if parent_id not in taxonomy:
            broken.append(
                (scientific, f"missing parent {parent_id}")
            )
            break

        current = taxonomy[parent_id]

print(f"Broken paths: {len(broken):,}")

for scientific, problem in broken[:30]:
    print(f"  {scientific} -> {problem}")

if len(broken) > 30:
    print(f"  ... and {len(broken) - 30:,} more")

# ------------------------------------------------------------
# 5. Check how many species have each rank in their ancestry
# ------------------------------------------------------------

print("\nSPECIES ANCESTRY COVERAGE")
print("-" * 60)

species_rank_coverage = Counter()

for bird in birds:
    scientific = bird.get("scientificName")

    if not scientific:
        continue

    species_taxon = taxonomy.get(
        f"species:{scientific.replace(' ', '_')}"
    )

    if not species_taxon:
        species_taxon = taxonomy.get(
            f"species:{scientific}"
        )

    if not species_taxon:
        continue

    current = species_taxon
    seen = set()

    while current and current.get("id") not in seen:
        seen.add(current.get("id"))

        rank = current.get("rank")

        if rank:
            species_rank_coverage[rank] += 1

        parent_id = current.get("parent")

        if not parent_id:
            break

        current = taxonomy.get(parent_id)

for rank in interesting_ranks:
    print(
        f"{rank:15} "
        f"{species_rank_coverage.get(rank, 0):>6,} / "
        f"{len(birds):,}"
    )

# ------------------------------------------------------------
# 6. Show a complete example path
# ------------------------------------------------------------

print("\nEXAMPLE TAXONOMY PATH")
print("-" * 60)

example_names = [
    "House Sparrow",
    "Great Hornbill",
    "Oriental Pied Hornbill",
]

for common_name in example_names:
    bird = next(
        (
            b for b in birds
            if b.get("commonName") == common_name
        ),
        None
    )

    if not bird:
        print(f"\n{common_name}: NOT FOUND")
        continue

    scientific = bird.get("scientificName")

    species_taxon = taxonomy.get(
        f"species:{scientific.replace(' ', '_')}"
    )

    if not species_taxon:
        species_taxon = taxonomy.get(
            f"species:{scientific}"
        )

    print(f"\n{common_name}")
    print(f"Scientific: {scientific}")

    if not species_taxon:
        print("  Species taxonomy node NOT FOUND")
        continue

    path = []
    current = species_taxon
    seen = set()

    while current and current.get("id") not in seen:
        seen.add(current.get("id"))
        path.append(current)

        parent_id = current.get("parent")

        if not parent_id:
            break

        current = taxonomy.get(parent_id)

    for taxon in reversed(path):
        print(
            f"  {taxon.get('rank'):15} "
            f"{taxon.get('name')}"
        )

print("\n" + "=" * 60)
print("INSPECTION COMPLETE")