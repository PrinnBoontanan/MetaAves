#!/usr/bin/env python3
from pathlib import Path
import platform, shutil, stat, subprocess, sys, tempfile, urllib.request, json

REPO = Path(__file__).resolve().parent
DATA = REPO / "data"
SCRIPTS = REPO / "scripts"

AVILIST_URL = "https://www.avilist.org/wp-content/uploads/2026/06/AviList-v2025b-10Jun2026-extended.xlsx"
RANKS = ["class","subclass","infraclass","cohort","superorder","order","suborder",
         "infraorder","parvorder","superfamily","family","subfamily","tribe",
         "subtribe","genus","subgenus","species"]

def run(cmd, label):
    print(f"\n==> {label}\n$", " ".join(map(str, cmd)))
    subprocess.run(cmd, cwd=REPO, check=True)

def download(url, dest):
    print(f"\n==> Downloading {url}")
    req = urllib.request.Request(url, headers={"User-Agent":"MetaAves-local-builder/2.0"})
    with urllib.request.urlopen(req, timeout=180) as r, open(dest, "wb") as f:
        shutil.copyfileobj(r, f)

def datasets_cli(tmp):
    found = shutil.which("datasets")
    if found:
        return Path(found)
    system, machine = platform.system().lower(), platform.machine().lower()
    if system == "linux":
        suffix = "linux-amd64" if machine in ("x86_64","amd64") else "linux-arm64"
        name = "datasets"
    elif system == "darwin":
        suffix = "mac-amd64" if machine in ("x86_64","amd64") else "mac-arm64"
        name = "datasets"
    elif system == "windows":
        suffix = "win64" if machine in ("x86_64","amd64") else "win-arm64"
        name = "datasets.exe"
    else:
        raise RuntimeError(f"Unsupported OS: {platform.system()}")
    target = tmp / name
    download(f"https://ftp.ncbi.nlm.nih.gov/pub/datasets/command-line/v2/{suffix}/{name}", target)
    if system != "windows":
        target.chmod(target.stat().st_mode | stat.S_IXUSR)
    return target

def validate():
    taxonomy = json.loads((DATA/"taxonomy.generated.json").read_text(encoding="utf-8"))
    birds = json.loads((DATA/"birds.generated.json").read_text(encoding="utf-8"))
    for name in ["birds.generated.json","taxonomy.generated.json","clade_membership.generated.json"]:
        if not (DATA/name).exists():
            raise RuntimeError(f"Missing generated file: data/{name}")
    if taxonomy.get("class:Aves", {}).get("name") != "Aves":
        raise RuntimeError("Aves root is missing or invalid.")
    if len(birds) < 10000:
        raise RuntimeError(f"Only {len(birds):,} birds generated; expected at least 10,000.")
    ranks = {x.get("rank") for x in taxonomy.values() if isinstance(x, dict)}
    missing = {"class","order","family","genus","species"} - ranks
    if missing:
        raise RuntimeError(f"Missing ranks: {sorted(missing)}")
    print(f"\nVALIDATION PASSED: {len(birds):,} birds, {len(taxonomy)-1:,} taxonomy nodes.")

def main():
    print("MetaAves LOCAL taxonomy builder v3 — classic taxonomy + separate clades")
    print("Runs on this PC only. Nothing is pushed to GitHub.")\n    print("Taxonomy: Class → Order → Family → Genus → Species. No suborder/infraorder/etc.");

    for p in [SCRIPTS/"import_avilist.py", DATA]:
        if not p.exists():
            print(f"ERROR: missing {p}")
            return 1

    try:
        import openpyxl
    except ImportError:
        print("ERROR: openpyxl is missing. Run: python -m pip install -r requirements.txt")
        return 1

    tmp = Path(tempfile.mkdtemp(prefix="metaves-build-"))
    ncbi = tmp/"ncbi_aves.jsonl"

    try:
        for p in [DATA/"ncbi_aves.jsonl", REPO/"AviList-v2025b-extended.xlsx"]:
            if p.exists():
                p.unlink()

        avilist = tmp/"AviList-v2025b-extended.xlsx"
        download(AVILIST_URL, avilist)

        run([sys.executable, str(SCRIPTS/"import_avilist.py"), str(avilist)],
            "Build AviList base dataset")

        validate()
        print("\nDONE. Generated files are ready in data/.")
        return 0

    except subprocess.CalledProcessError as e:
        print(f"\nBUILD FAILED: command exited with code {e.returncode}")
        # Keep the exact NCBI output for debugging instead of deleting it.
        if ncbi.exists():
            saved = DATA/"ncbi_aves.failed.jsonl"
            shutil.copy2(ncbi, saved)
            print(f"Saved NCBI diagnostic file: {saved}")
        print("Run the same command again only after we inspect the output.")
        return e.returncode or 1

    except Exception as e:
        print(f"\nBUILD FAILED: {e}")
        if ncbi.exists():
            saved = DATA/"ncbi_aves.failed.jsonl"
            shutil.copy2(ncbi, saved)
            print(f"Saved NCBI diagnostic file: {saved}")
        return 1

    finally:
        # Do not delete the saved failure copy.
        shutil.rmtree(tmp, ignore_errors=True)

if __name__ == "__main__":
    raise SystemExit(main())
