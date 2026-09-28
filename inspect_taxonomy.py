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

rank_counts = Counter(
    taxon.get("rank")
    for taxon in taxonomy.values()
    if isinstance(taxon, dict)
)

print("\nRANK COUNTS")
print("-" * 60)

for rank, count in sorted(rank_counts.items(), key=lambda item: str(item[0])):
    rank_name = str(rank) if rank is not None else "(no rank)"
    print(f"{rank_name:15} {count:>6,}")

print("\nINTERMEDIARY RANKS")
print("-" * 60)

for rank in interesting_ranks:
    print(f"{rank:15} {rank_counts.get(rank, 0):>6,}")

def get_species_taxon(bird):
    scientific = bird.get("scientificName")
    if not scientific:
        return None

    for taxon_id in (
        f"species:{scientific.replace(' ', '_')}",
        f"species:{scientific}",
    ):
        if taxon_id in taxonomy:
            return taxonomy[taxon_id]

    return None

def get_ancestry(bird):
    current = get_species_taxon(bird)
    path = []
    seen = set()

    while current and current.get("id") not in seen:
        seen.add(current.get("id"))
        path.append(current)

        parent_id = current.get("parent")
        if not parent_id:
            break

        current = taxonomy.get(parent_id)

    return path

# ------------------------------------------------------------
# Passeriformes
# ------------------------------------------------------------

print("\nPASSERIFORMES HIERARCHY")
print("-" * 60)

passeriformes = [
    taxon for taxon in taxonomy.values()
    if (
        isinstance(taxon, dict)
        and taxon.get("name") == "Passeriformes"
        and taxon.get("rank") == "order"
    )
]

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
# Broken paths
# ------------------------------------------------------------

print("\nBROKEN TAXONOMY PATHS")
print("-" * 60)

broken = []

for bird in birds:
    scientific = bird.get("scientificName")
    if not scientific:
        continue

    species_taxon = get_species_taxon(bird)

    if species_taxon is None:
        broken.append((scientific, "species node missing"))
        continue

    current = species_taxon
    seen = set()

    while current:
        taxon_id = current.get("id")

        if taxon_id in seen:
            broken.append((scientific, "taxonomy cycle"))
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
# Overall ancestry coverage
# ------------------------------------------------------------

print("\nSPECIES ANCESTRY COVERAGE")
print("-" * 60)

species_rank_coverage = Counter()
missing_by_rank = defaultdict(list)

for bird in birds:
    ancestry = get_ancestry(bird)

    if not ancestry:
        continue

    ranks_present = {
        taxon.get("rank")
        for taxon in ancestry
        if taxon.get("rank")
    }

    for rank in ranks_present:
        species_rank_coverage[rank] += 1

    for rank in interesting_ranks:
        if rank not in ranks_present:
            missing_by_rank[rank].append(bird)

for rank in interesting_ranks:
    print(
        f"{rank:15} "
        f"{species_rank_coverage.get(rank, 0):>6,} / "
        f"{len(birds):,}"
    )

# ------------------------------------------------------------
# Missing-rank analysis
# ------------------------------------------------------------

print("\nMISSING INTERMEDIARY RANK ANALYSIS")
print("-" * 60)
print("This groups missing ranks by the bird's actual order and family.")
print("It tells us whether a missing rank is concentrated in certain groups")
print("or broadly absent across orders.")

for rank in ("suborder", "infraorder", "parvorder"):
    missing = missing_by_rank.get(rank, [])

    print(f"\n{rank.upper()}: {len(missing):,} species missing")

    by_order = Counter()
    by_family = Counter()
    by_order_family = Counter()

    for bird in missing:
        ancestry = get_ancestry(bird)

        order_name = next(
            (
                taxon.get("name")
                for taxon in ancestry
                if taxon.get("rank") == "order"
            ),
            "(no order)",
        )

        family_name = next(
            (
                taxon.get("name")
                for taxon in ancestry
                if taxon.get("rank") == "family"
            ),
            "(no family)",
        )

        by_order[order_name] += 1
        by_family[family_name] += 1
        by_order_family[(order_name, family_name)] += 1

    print("\n  By order:")
    for name, count in by_order.most_common():
        print(f"    {name:25} {count:>5,}")

    print("\n  By family (largest first):")
    for name, count in by_family.most_common(25):
        print(f"    {name:25} {count:>5,}")

    if len(by_family) > 25:
        print(f"    ... and {len(by_family) - 25:,} more families")

    print("\n  Largest order/family groups:")
    for (order_name, family_name), count in by_order_family.most_common(20):
        print(
            f"    {order_name:20} / "
            f"{family_name:25} {count:>5,}"
        )

# ------------------------------------------------------------
# Example paths
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
        None,
    )

    if not bird:
        print(f"\n{common_name}: NOT FOUND")
        continue

    scientific = bird.get("scientificName")
    ancestry = get_ancestry(bird)

    print(f"\n{common_name}")
    print(f"Scientific: {scientific}")

    if not ancestry:
        print("  Species taxonomy node NOT FOUND")
        continue

    for taxon in reversed(ancestry):
        print(
            f"  {taxon.get('rank'):15} "
            f"{taxon.get('name')}"
        )

print("\n" + "=" * 60)
print("INSPECTION COMPLETE")
