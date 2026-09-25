// ========================================
// MetaAves - Game State
// ========================================

const gameState = {
    mode: "world",
    maxGuesses: 12,
    guessesRemaining: 12,
    birds: [],
    mysteryBird: null,
    guesses: [],
    taxonomy: null,
    taxonInfo: null,
    clades: null,
    selectedTaxonId: null,
    gameStatus: "playing",
    taxonomyView: "tree",
    wikipediaCache: new Map(),
    thaiNameCache: new Map()
};

const guessCountElement = document.getElementById("guess-count");
const searchInput = document.getElementById("bird-search");
const guessButton = document.getElementById("guess-button");
const taxonomyTree = document.getElementById("taxonomy-tree");
const suggestions = document.getElementById("suggestions");
const treeViewButton = document.getElementById("tree-view-button");
const tableViewButton = document.getElementById("table-view-button");

// MetaAves uses a deliberately simple ranked taxonomy:
// Class → Order → Family → Genus → Species.
// Phylogenetic clades are a separate layer and are never treated as ranks.
const taxonomyLevels = [
    "class",
    "order",
    "family",
    "genus"
];


// ========================================
// Load bird database
// ========================================

async function loadGameData() {
    try {
        const [
            birdResponse,
            taxonomyResponse,
            taxonomyOverrideResponse,
            infoResponse,
            cladeResponse,
            cladeMembershipResponse
        ] = await Promise.all([
            fetch("data/birds.generated.json"),
            fetch("data/taxonomy.generated.json"),
            fetch("data/taxonomy_overrides.json"),
            fetch("data/taxon_info.json"),
            fetch("data/clades.json"),
            fetch("data/clade_membership.generated.json")
        ]);

        if (
            !birdResponse.ok ||
            !taxonomyResponse.ok ||
            !taxonomyOverrideResponse.ok ||
            !infoResponse.ok ||
            !cladeResponse.ok ||
            !cladeMembershipResponse.ok
        ) {
            throw new Error("Could not load MetaAves data.");
        }

        gameState.birds = await birdResponse.json();
        gameState.taxonomy = await taxonomyResponse.json();
        gameState.taxonomyOverrides = await taxonomyOverrideResponse.json();
        gameState.taxonInfo = await infoResponse.json();
        gameState.clades = await cladeResponse.json();

        const cladeMembership = await cladeMembershipResponse.json();
        const membershipBySpecies = cladeMembership.species || {};

        // Join the generated clade layer to the generated bird records.
        // The scientific name is the stable species key produced by AviList.
        gameState.birds.forEach(bird => {
            bird.cladePath = membershipBySpecies[bird.scientificName] || [];
        });

        // Select a random species from the full imported dataset.
        // The mystery remains hidden from the player until it is guessed.
        gameState.mysteryBird =
            gameState.birds[Math.floor(Math.random() * gameState.birds.length)];

        updateGuessCounter();
        renderTaxonomyView();
        updateAutomaticTaxonCard();

        console.log("Bird database loaded:", gameState.birds);
        console.log("Taxonomy loaded:", gameState.taxonomy);
        console.log("Taxon information loaded:", gameState.taxonInfo);
        console.log("Mystery bird:", gameState.mysteryBird);
    } catch (error) {
        console.error("Error loading bird database:", error);
    }
}


// ========================================
// Guess counter
// ========================================

function updateGuessCounter() {
    guessCountElement.textContent = gameState.guessesRemaining;
}


// ========================================
// Bird lookup
// ========================================

function findBirdByName(name) {
    return gameState.birds.find(
        bird =>
            bird.commonName.toLowerCase() === name.toLowerCase()
    );
}

function hasAlreadyBeenGuessed(bird) {
    return gameState.guesses.some(
        guessedBird =>
            guessedBird.commonName === bird.commonName
    );
}


// ========================================
// Autocomplete
// ========================================

function normalizeSearchText(value) {
    return String(value || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\\u0300-\\u036f]/g, "")
        .replace(/[^a-z0-9\\s-]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function levenshteinDistance(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;

    let previous = Array.from({ length: b.length + 1 }, (_, i) => i);

    for (let i = 1; i <= a.length; i++) {
        const current = [i];

        for (let j = 1; j <= b.length; j++) {
            current[j] = Math.min(
                current[j - 1] + 1,
                previous[j] + 1,
                previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
            );
        }

        previous = current;
    }

    return previous[b.length];
}

function scoreBirdSearchMatch(commonName, query) {
    const name = normalizeSearchText(commonName);
    const search = normalizeSearchText(query);

    if (!name || !search) return -Infinity;

    // Exact matches always come first.
    if (name === search) return 10000;

    const words = name.split(" ");
    const queryWords = search.split(" ");

    // Prefer names whose first word begins with what the player typed.
    if (name.startsWith(search)) return 9000 - name.length;

    // Then prefer a whole word beginning with the query.
    const wordPrefixIndex = words.findIndex(word => word.startsWith(search));
    if (wordPrefixIndex >= 0) {
        return 8000 - wordPrefixIndex * 40 - name.length;
    }

    // A query matching the beginning of multiple words is especially useful
    // for names such as "black crowned..." or "great hornbill".
    if (
        queryWords.length > 1 &&
        queryWords.every((word, index) =>
            words[index]?.startsWith(word)
        )
    ) {
        return 7800 - name.length;
    }

    // Infix matches are useful, but should never outrank prefix matches.
    const infixIndex = name.indexOf(search);
    if (infixIndex >= 0) {
        return 6000 - infixIndex * 12 - name.length;
    }

    // Finally allow small spelling mistakes. This makes the search forgiving
    // without allowing distant names to flood the dropdown.
    const compactName = name.replace(/ /g, "");
    const compactSearch = search.replace(/ /g, "");
    const maxDistance = compactSearch.length <= 4 ? 1 : 2;
    const distance = levenshteinDistance(compactName, compactSearch);

    if (distance <= maxDistance) {
        return 4000 - distance * 250 - Math.abs(name.length - search.length);
    }

    return -Infinity;
}

function selectSuggestion(bird) {
    searchInput.value = bird.commonName;
    suggestions.innerHTML = "";
    suggestions.classList.remove("visible");
    searchInput.setAttribute("aria-expanded", "false");
    searchInput.focus();
}

function showSuggestions(searchText) {
    suggestions.innerHTML = "";
    suggestions.classList.remove("visible");
    searchInput.setAttribute("aria-expanded", "false");

    const query = searchText.trim();

    // Avoid dumping hundreds of birds into the UI for a one-letter query.
    if (query.length < 2) return;

    const ranked = gameState.birds
        .filter(bird => !hasAlreadyBeenGuessed(bird))
        .map((bird, index) => ({
            bird,
            index,
            score: scoreBirdSearchMatch(bird.commonName, query)
        }))
        .filter(result => Number.isFinite(result.score))
        .sort((a, b) =>
            b.score - a.score ||
            a.bird.commonName.localeCompare(b.bird.commonName)
        );

    // Keep every matching database record. The ranking puts the most
    // obvious result(s) first, while the rest remain available by scrolling
    // through the floating dropdown. This is important because different
    // species can share the same English common name.
    if (!ranked.length) return;

    ranked.forEach((result, index) => {
        const suggestion = document.createElement("button");

        suggestion.type = "button";
        suggestion.classList.add("suggestion");
        suggestion.dataset.index = String(index);
        suggestion.textContent = result.bird.commonName;

        suggestion.addEventListener("mousedown", event => {
            // Prevent the input from losing focus before selection.
            event.preventDefault();
        });

        suggestion.addEventListener("click", () => {
            selectSuggestion(result.bird);
        });

        suggestions.appendChild(suggestion);
    });

    suggestions.classList.add("visible");
    searchInput.setAttribute("aria-expanded", "true");
}

function moveSuggestionSelection(direction) {
    const items = [...suggestions.querySelectorAll(".suggestion")];
    if (!items.length) return false;

    const current = items.findIndex(item =>
        item.classList.contains("keyboard-selected")
    );

    let next = current + direction;

    if (next < 0) next = items.length - 1;
    if (next >= items.length) next = 0;

    items.forEach(item => item.classList.remove("keyboard-selected"));
    items[next].classList.add("keyboard-selected");
    items[next].scrollIntoView({ block: "nearest" });

    return true;
}

// ========================================
// Bird lineage + true shared taxon
// ========================================

function getBirdPhylogenyPath(bird) {
    if (!bird) return [];

    const path = [];
    const seen = new Set();

    function addNode(id, level, value) {
        if (!id || seen.has(id)) return;
        seen.add(id);
        path.push({ id, level, value, depth: path.length });
    }

    addNode("class:Aves", "class", "Aves");

    // Clades are part of the actual lineage, not a separate decoration.
    // Their parent relationships determine where they belong.
    const cladeByName = new Map(
        Object.values(gameState.clades || {})
            .filter(entry => entry?.rank === "clade")
            .map(entry => [entry.name, entry])
    );

    // Use the canonical order -> clade backbone first. The generated
    // membership file is useful as a species-level join, but it can be
    // incomplete for a bird. The order backbone is the authoritative
    // structural path, so every bird in Galloanserae/Neoaves/etc. gets the
    // required intermediate clade nodes instead of jumping straight to a
    // parent such as Neognathae.
    const backboneCladeNames =
        gameState.clades?._meta?.orderCladePaths?.[bird.order];

    const cladeNames =
        Array.isArray(backboneCladeNames) && backboneCladeNames.length
            ? backboneCladeNames
            : (
                Array.isArray(bird.cladePath)
                    ? bird.cladePath
                    : []
            );

    const clades = cladeNames
        .map(name => cladeByName.get(name))
        .filter(Boolean);

    let previousCladeId = "class:Aves";

    for (const clade of clades) {
        if (seen.has(clade.id)) continue;

        const parentId = clade.parent || "class:Aves";

        // Do not insert an unrelated external clade.
        if (
            parentId !== "class:Aves" &&
            parentId !== previousCladeId &&
            !seen.has(parentId)
        ) {
            continue;
        }

        addNode(clade.id, "clade", clade.name);
        previousCladeId = clade.id;
    }

    // Detailed Wikipedia-style overrides can insert additional intermediate
    // taxa without replacing the large generated taxonomy catalog.
    const detailedOverride =
        gameState.taxonomyOverrides?.[bird.scientificName];

    if (Array.isArray(detailedOverride) && detailedOverride.length) {
        // Overrides describe the detailed ranked/phylogenetic chain starting
        // at Aves/order. Keep the real clade backbone above that chain, then
        // append only the nodes that are not already present. This prevents a
        // detailed Wikipedia path from accidentally replacing Telluraves,
        // Afroaves, Australaves, etc.
        for (const taxon of detailedOverride) {
            if (!taxon?.id || seen.has(taxon.id)) continue;
            addNode(taxon.id, taxon.rank || "clade", taxon.name);
        }
    }

    if (Array.isArray(detailedOverride) && detailedOverride.length) {
        return path.map((node, index) => ({ ...node, depth: index }));
    }

    // Ranked taxonomy comes after the deepest clade and follows the
    // generated taxonomy's real parent chain.
    const speciesTaxon = Object.values(gameState.taxonomy || {}).find(
        taxon =>
            taxon.rank === "species" &&
            taxon.name === bird.scientificName
    );

    const rankedPath = [];
    let currentId = speciesTaxon?.id || null;
    const seenTaxa = new Set();

    while (
        currentId &&
        !seenTaxa.has(currentId) &&
        gameState.taxonomy?.[currentId]
    ) {
        seenTaxa.add(currentId);
        const taxon = gameState.taxonomy[currentId];

        rankedPath.unshift({
            id: taxon.id,
            level: taxon.rank,
            value: taxon.name
        });

        if (taxon.id === "class:Aves") break;
        currentId = taxon.parent;
    }

    if (rankedPath.length && rankedPath[0].id === "class:Aves") {
        rankedPath.slice(1).forEach(node =>
            addNode(node.id, node.level, node.value)
        );
    } else {
        for (const level of ["order", "family", "genus"]) {
            const value = bird[level];
            if (value) addNode(nodeIdForTaxon(level, value), level, value);
        }

        addNode(
            nodeIdForTaxon("species", bird.scientificName),
            "species",
            bird.scientificName
        );
    }

    return path.map((node, index) => ({ ...node, depth: index }));
}

function nodeIdForTaxon(rank, value) {
    const safe = String(value || "")
        .replace(/[^A-Za-z0-9_-]+/g, "_")
        .replace(/^_+|_+$/g, "");

    return `${rank}:${safe}`;
}

// The deepest shared node is simply the last identical node in the two
// complete lineages. This handles clades and ranked taxa uniformly.
function getDeepestSharedTaxon(guessedBird, mysteryBird) {
    const guessedPath = getBirdPhylogenyPath(guessedBird);
    const mysteryPath = getBirdPhylogenyPath(mysteryBird);

    const limit = Math.min(guessedPath.length, mysteryPath.length);

    let deepest = {
        id: "class:Aves",
        level: "class",
        value: "Aves",
        depth: 0
    };

    for (let i = 0; i < limit; i++) {
        if (guessedPath[i].id !== mysteryPath[i].id) break;

        deepest = { ...mysteryPath[i], depth: i };
    }

    return deepest;
}

function getDeepestCommonNode(leftPath, rightPath) {
    const limit = Math.min(leftPath.length, rightPath.length);
    let deepest = null;

    for (let i = 0; i < limit; i++) {
        if (leftPath[i].id !== rightPath[i].id) break;
        deepest = leftPath[i];
    }

    return deepest;
}

// Make guess
// ========================================

function makeGuess() {
    const input = searchInput.value.trim();

    if (
        input === "" ||
        gameState.guessesRemaining <= 0 ||
        gameState.gameStatus !== "playing"
    ) {
        return;
    }

    const bird = findBirdByName(input);

    if (!bird) {
        console.log("Please select a valid bird.");
        return;
    }

    if (hasAlreadyBeenGuessed(bird)) {
        console.log("You already guessed this bird.");
        searchInput.value = "";
        suggestions.innerHTML = "";
        return;
    }

    gameState.guesses.push(bird);
    gameState.guessesRemaining--;

    const isCorrect =
        bird.commonName === gameState.mysteryBird.commonName;

    if (isCorrect) {
        gameState.gameStatus = "won";
    } else if (gameState.guessesRemaining <= 0) {
        gameState.gameStatus = "lost";
    }

    // Clear the search immediately after a valid guess so the
    // input never remains populated while the tree/card re-renders.
    searchInput.value = "";
    suggestions.innerHTML = "";

    updateGuessCounter();
    renderTaxonomyView();
    updateAutomaticTaxonCard();

    if (gameState.gameStatus === "won") {
        showGameOverCard("won");
    } else if (gameState.gameStatus === "lost") {
        showGameOverCard("lost");
    }
}


// ========================================
// Build the logical tree
// ========================================
//
// Build ONE real tree from the mystery's lineage and every guess.
// Each wrong guess is attached at its MRCA with the mystery.
// The hidden mystery branch extends to the deepest MRCA learned so far.
//
// This means:
//   House Sparrow + Great Hornbill
//       -> both share Telluraves
//       -> Sparrow is attached at Telluraves
//       -> Hornbill's hidden branch continues through Afroaves when a
//          sufficiently close guess reveals that branch.
//
// Older guesses never get moved; deeper later guesses simply grow the
// mystery branch farther down the already-existing tree.
function getMysteryRevealTaxon() {
    let deepest = {
        id: "class:Aves",
        level: "class",
        value: "Aves",
        depth: 0
    };

    for (const guessedBird of gameState.guesses) {
        if (guessedBird.commonName === gameState.mysteryBird.commonName) continue;

        const shared = getDeepestSharedTaxon(
            guessedBird,
            gameState.mysteryBird
        );

        if (shared.depth > deepest.depth) deepest = shared;
    }

    return deepest;
}

// Build a minimal revealed taxonomy tree.
// Full paths are used for biological relationships, but ordinary intermediate
// nodes are hidden. A node is shown only when it is a revealed endpoint or is
// necessary to connect two different revealed branches.
function buildTreeModel() {
    /*
     * MetaAves tree reconstruction
     *
     * The important distinction is between:
     *
     *   A) where a guess meets the mystery, and
     *   B) how several guesses relate to each other.
     *
     * A single wrong guess stops at its deepest shared taxon with the
     * mystery. It must NOT expose the rest of that bird's lineage.
     *
     * If several wrong guesses stop at the same taxon, however, their own
     * lineage is now useful information. We build a small side tree from
     * those guesses and expose the shared descendants needed to show where
     * they split.
     *
     * Example:
     *
     *   Aves
     *   └─ Telluraves
     *      ├─ Afroaves
     *      │  └─ Bucerotiformes
     *      │     ├─ Great Hornbill
     *      │     └─ Oriental Pied Hornbill
     *      └─ [another branch]
     *
     * Great Hornbill alone would simply be a leaf at Telluraves.
     * The Afroaves/Bucerotiformes branch appears only when another guess
     * makes that relationship useful.
     *
     * Existing guesses are never moved when a later guess reveals more
     * information.
     */

    const root = {
        type: "taxon",
        name: "Aves",
        taxonId: "class:Aves",
        level: "class",
        children: []
    };

    if (!gameState.mysteryBird || gameState.guesses.length === 0) {
        return root;
    }

    const finished =
        gameState.gameStatus === "won" ||
        gameState.gameStatus === "lost";

    const solved = gameState.gameStatus === "won";

    // ----------------------------------------
    // 1. Determine the endpoint of every guess
    // ----------------------------------------

    const wrongEntries = gameState.guesses
        .filter(
            bird =>
                bird.commonName !==
                gameState.mysteryBird.commonName
        )
        .map(bird => ({
            bird,
            endpoint: getDeepestSharedTaxon(
                bird,
                gameState.mysteryBird
            ),
            nodeType: "guess"
        }));

    const mysteryPath = getBirdPhylogenyPath(
        gameState.mysteryBird
    );

    const mysteryEndpoint = finished
        ? (
            mysteryPath[mysteryPath.length - 1] || {
                id: "class:Aves",
                level: "class",
                value: "Aves",
                depth: 0
            }
        )
        : getMysteryRevealTaxon();

    const mysteryEntry = {
        bird: gameState.mysteryBird,
        endpoint: mysteryEndpoint,
        nodeType: solved ? "correct" : "mystery"
    };

    // ----------------------------------------
    // 2. Cache complete lineages
    // ----------------------------------------

    const pathByBird = new Map();

    for (const entry of [...wrongEntries, mysteryEntry]) {
        pathByBird.set(
            entry.bird.commonName,
            getBirdPhylogenyPath(entry.bird)
        );
    }

    function getPathToEndpoint(entry) {
        const path =
            pathByBird.get(entry.bird.commonName) || [];

        const endpointIndex = path.findIndex(
            node => node.id === entry.endpoint.id
        );

        if (endpointIndex < 0) return [];

        return path.slice(0, endpointIndex + 1);
    }

    // ----------------------------------------
    // 3. Build the full tree first, then select
    //    which parts are allowed to be visible
    // ----------------------------------------
    //
    // This is the important Metazooa-style distinction:
    //
    //   1. First construct the REAL combined tree containing every guess.
    //   2. For each wrong guess, find its deepest shared taxon with the
    //      mystery. That is the information revealed by that guess.
    //   3. BUT if two or more guessed species share a branch with each
    //      other, that shared branch is also visible, even if it is not
    //      shared with the mystery.
    //
    // Example:
    //
    //   Mystery: a passerine
    //   Guess: House Sparrow
    //   Guess: Great Hornbill
    //   Guess: Oriental Pied Hornbill
    //
    // House Sparrow may reveal Passeriformes.
    // Both hornbills may reveal only Telluraves with the mystery.
    // Nevertheless, because the two hornbills share:
    //
    //   Telluraves -> Afroaves -> Bucerotiformes -> Bucerotidae
    //
    // that complete shared hornbill branch is shown.
    //
    // A branch shared by only one guessed species remains hidden.

    const entries = [...wrongEntries, mysteryEntry];

    function findTaxonChild(parent, taxonId) {
        return parent.children.find(
            child =>
                child.type === "taxon" &&
                child.taxonId === taxonId
        );
    }

    function getOrCreateTaxon(parent, taxon) {
        let child = findTaxonChild(parent, taxon.id);

        if (!child) {
            child = {
                type: "taxon",
                name: taxon.value,
                taxonId: taxon.id,
                level: taxon.level,
                children: []
            };

            parent.children.push(child);
        }

        return child;
    }

    function addSpecies(parent, entry) {
        const hidden =
            entry.nodeType === "mystery" &&
            !finished;

        const alreadyThere = parent.children.some(
            child =>
                child.type === "species" &&
                child.bird?.commonName ===
                    entry.bird.commonName
        );

        if (alreadyThere) return;

        parent.children.push({
            type: "species",
            name: hidden
                ? "???"
                : entry.bird.commonName,
            nodeType: hidden
                ? "mystery"
                : entry.nodeType,
            bird: hidden ? null : entry.bird
        });
    }

    // Select the visible projection from the COMPLETE tree.
    //
    // There are two independent kinds of information:
    //
    // 1. Guess -> mystery:
    //    reveal the deepest shared taxon for that guess.
    //
    // 2. Guess -> guess:
    //    if two guessed species share a deeper common branch, reveal
    //    that branch too. This does NOT require that branch to be shared
    //    with the mystery.
    //
    // We therefore use pairwise MRCAs instead of simply marking every
    // taxon that happens to occur in two paths. Each MRCA is a real
    // branching point in the combined tree.

    // Only reveal information that the guesses actually justify.
    //
    // IMPORTANT: a taxon being shared by two guesses is NOT enough by
    // itself. The shared taxon must be a *new, deeper branch* than the
    // point where those guesses meet the mystery. Otherwise common
    // ancestors such as Aves / Neognathae / Telluraves would make the
    // tree look like the whole taxonomy.
    const visibleIds = new Set(["class:Aves"]);

    function revealAncestors(path, throughId) {
        const endpointIndex = path.findIndex(node => node.id === throughId);
        if (endpointIndex < 0) return;

        // The underlying lineage is needed to find the real relationship,
        // but only the revealed endpoint itself becomes visible. The renderer
        // skips unrevealed intermediate taxa when connecting visible nodes.
        // This is what allows:
        //
        //   Telluraves
        //   └─ Bucerotidae
        //
        // instead of forcing:
        //
        //   Telluraves
        //   └─ Afroaves
        //      └─ Bucerotiformes
        //         └─ Bucerotidae
        visibleIds.add(path[endpointIndex].id);
    }

    // 1. Each wrong guess reveals only its MRCA with the mystery.
    for (const entry of wrongEntries) {
        const path = pathByBird.get(entry.bird.commonName) || [];
        revealAncestors(path, entry.endpoint.id);
    }

    // 2. A side branch is revealed ONLY when multiple guesses share a
    //    deeper MRCA than the mystery gives either of them.
    //
    // Example:
    //   mystery = passerine
    //   hornbill A -> Telluraves
    //   hornbill B -> Telluraves
    //   A + B -> Bucerotidae
    //
    // We reveal Telluraves -> Afroaves -> Bucerotiformes -> Bucerotidae,
    // but we do NOT reveal a private genus/species branch belonging to
    // just one hornbill.
    for (let i = 0; i < wrongEntries.length; i++) {
        const left = wrongEntries[i];
        const leftPath = pathByBird.get(left.bird.commonName) || [];

        for (let j = i + 1; j < wrongEntries.length; j++) {
            const right = wrongEntries[j];
            const rightPath = pathByBird.get(right.bird.commonName) || [];

            const common = getDeepestCommonNode(leftPath, rightPath);
            if (!common) continue;

            const leftEndpointDepth = left.endpoint.depth;
            const rightEndpointDepth = right.endpoint.depth;
            const mysteryDepth = Math.max(
                leftEndpointDepth,
                rightEndpointDepth
            );

            // If the pair's MRCA is not deeper than both mystery
            // relationships, it adds no new information and must stay
            // collapsed.
            if (common.depth <= mysteryDepth) continue;

            revealAncestors(leftPath, common.id);
        }
    }

    // 3. The mystery's current revealed position is visible.
    visibleIds.add(mysteryEntry.endpoint.id);

    // 4. At game end reveal the actual mystery lineage.
    if (finished) {
        const finishedMysteryPath =
            pathByBird.get(gameState.mysteryBird.commonName) || [];
        finishedMysteryPath.forEach(taxon => visibleIds.add(taxon.id));
    }

    // ----------------------------------------
    // 4. Project the full tree onto the visible
    //    nodes selected above
    // ----------------------------------------

    function addVisiblePath(path, entry, addLeaf) {
        if (!path.length) return;

        let parent = root;
        let deepestVisibleParent = root;

        for (let i = 1; i < path.length; i++) {
            const taxon = path[i];

            // Species are represented by the bird's common-name leaf,
            // not by a separate scientific-name taxon node in the rendered tree.
            // The scientific species ID remains in the underlying lineage for
            // MRCA calculations and the study card.
            if (taxon.level === "species") {
                continue;
            }

            if (!visibleIds.has(taxon.id)) {
                continue;
            }

            parent = getOrCreateTaxon(parent, taxon);
            deepestVisibleParent = parent;
        }

        if (addLeaf) {
            addSpecies(deepestVisibleParent, entry);
        }
    }

    // Wrong guesses use their COMPLETE real lineages here. This is what
    // allows two guesses to expose their own shared branch below the
    // mystery endpoint.
    for (const entry of wrongEntries) {
        const path =
            pathByBird.get(entry.bird.commonName) || [];

        addVisiblePath(path, entry, true);
    }

    // While playing, the mystery only exists as far as its deepest
    // currently revealed shared taxon.
    if (!finished) {
        const mysteryPath =
            pathByBird.get(mysteryEntry.bird.commonName) || [];

        const endpointIndex = mysteryPath.findIndex(
            node => node.id === mysteryEntry.endpoint.id
        );

        const revealedMysteryPath =
            endpointIndex >= 0
                ? mysteryPath.slice(0, endpointIndex + 1)
                : [mysteryPath[0]].filter(Boolean);

        addVisiblePath(revealedMysteryPath, mysteryEntry, true);
    } else {
        // Once the game ends, reveal the mystery's complete lineage.
        const mysteryPath =
            pathByBird.get(mysteryEntry.bird.commonName) || [];

        addVisiblePath(mysteryPath, mysteryEntry, true);
    }

    // The mystery was already added by the projection above.
    // Do not add it a second time here.
    return root;
}
// Metazooa-style tree renderer
// ========================================

// ========================================
// Tree node proximity coloring
// ========================================
//
// Color is based on biological closeness to the hidden mystery, not
// taxonomy rank. Red = far, yellow = middle, green = close.
//
// A side branch inherits the closeness of the point where that branch
// meets the mystery. This prevents a deep hornbill branch from becoming
// green merely because it contains many taxonomy levels.

function getTreeNodeProximity(node) {
    if (!node || node.type !== "taxon") return 0;

    // Metazooa's visual gradient follows the revealed tree itself:
    // shallow/root nodes are red, middle nodes are yellow/orange, and
    // deeper nodes nearer the species leaves become green. This is based
    // on the displayed tree depth, not on taxonomic rank or guess order.
    const depth = Number.isFinite(node.__renderDepth)
        ? node.__renderDepth
        : 0;
    const maxDepth = Math.max(
        1,
        Number.isFinite(node.__renderMaxDepth)
            ? node.__renderMaxDepth
            : depth
    );

    return Math.max(0, Math.min(1, depth / maxDepth));
}

function createTreeNodeElement(node) {
    const element = document.createElement("div");

    element.classList.add("meta-tree-node");

    if (node.type === "taxon") {
        const proximity = getTreeNodeProximity(node);
        const hue = Math.round(proximity * 120);
        element.style.setProperty("--tree-proximity-hue", hue);
        element.style.setProperty(
            "--tree-proximity-saturation",
            "58%"
        );
        element.style.setProperty(
            "--tree-proximity-lightness",
            "38%"
        );
        element.classList.add("meta-taxon-node");
        element.dataset.taxon = node.name;
        element.dataset.taxonId = node.taxonId || "";
        element.dataset.level = node.level;
        element.textContent = node.name;
        element.addEventListener("click", () => selectTaxon(node));
        element.style.pointerEvents = "auto";
    } else {
        element.classList.add("meta-species-node");
        element.classList.add(`meta-species-${node.nodeType}`);
        element.textContent = node.name;

        // Guessed / revealed species can be opened in the taxon card.
        if (node.bird) {
            element.classList.add("meta-species-clickable");
            element.style.pointerEvents = "auto";

            element.addEventListener("click", () => {
                // The mystery species should always reopen the Study Card
                // after the game has ended, even if the round was lost.
                // In a lost game its nodeType remains "mystery", so checking
                // only "correct" / "revealed-lost" would incorrectly open
                // the normal Taxon Card instead.
                if (
                    node.bird === gameState.mysteryBird &&
                    (
                        gameState.gameStatus === "won" ||
                        gameState.gameStatus === "lost"
                    )
                ) {
                    showGameOverCard(
                        gameState.gameStatus === "won" ? "won" : "lost"
                    );
                    return;
                }

                showBirdInTaxonCard(node.bird);
            });
        }
    }

    return element;
}

async function fetchOnlineThaiName(bird) {
    if (!bird?.scientificName) return null;

    const scientificName = String(bird.scientificName).trim();
    if (!scientificName) return null;

    if (gameState.thaiNameCache.has(scientificName)) {
        return gameState.thaiNameCache.get(scientificName);
    }

    const cacheValue = async () => {
        // 1. GBIF ChecklistBank / Taxonomic Backbone.
        // GBIF exposes vernacular names from many checklist datasets and
        // supports Thai names without requiring an API key.
        try {
            const matchUrl =
                "https://api.gbif.org/v1/species/match?name=" +
                encodeURIComponent(scientificName);

            const matchResponse = await fetch(matchUrl);
            if (matchResponse.ok) {
                const matchData = await matchResponse.json();
                const usageKey = matchData?.usageKey || matchData?.taxonKey;

                if (usageKey) {
                    const namesUrl =
                        "https://api.gbif.org/v1/species/" +
                        encodeURIComponent(usageKey) +
                        "/vernacularNames";

                    const namesResponse = await fetch(namesUrl);
                    if (namesResponse.ok) {
                        const namesData = await namesResponse.json();
                        const thai = (namesData.results || []).find(name => {
                            const language = String(name.language || "")
                                .trim()
                                .toLowerCase();
                            return language === "th" || language === "tha";
                        });

                        if (thai?.vernacularName) {
                            return String(thai.vernacularName).trim();
                        }
                    }
                }
            }
        } catch (error) {
            console.warn("GBIF Thai-name lookup failed:", scientificName, error);
        }

        // 2. Wikidata fallback.
        // Wikidata is broader than GBIF, but its Thai labels are not
        // available for every bird.
        try {
            const searchUrl =
                "https://www.wikidata.org/w/api.php?action=wbsearchentities" +
                "&search=" + encodeURIComponent(scientificName) +
                "&language=en&format=json&origin=*";

            const searchResponse = await fetch(searchUrl);
            if (!searchResponse.ok) return null;

            const searchData = await searchResponse.json();
            const exactMatch = (searchData.search || []).find(result =>
                String(result.label || "").trim().toLowerCase() === scientificName.toLowerCase() ||
                String(result.match?.text || "").trim().toLowerCase() === scientificName.toLowerCase()
            );
            const result = exactMatch || searchData.search?.[0];
            const entityId = result?.id;
            if (!entityId) return null;

            const entityUrl =
                "https://www.wikidata.org/w/api.php?action=wbgetentities" +
                "&ids=" + encodeURIComponent(entityId) +
                "&props=labels&languages=th&format=json&origin=*";

            const entityResponse = await fetch(entityUrl);
            if (!entityResponse.ok) return null;

            const entityData = await entityResponse.json();
            const label = entityData.entities?.[entityId]?.labels?.th?.value;
            return label ? String(label).trim() : null;
        } catch (error) {
            console.warn("Wikidata Thai-name lookup failed:", scientificName, error);
            return null;
        }
    };

    const promise = cacheValue();
    gameState.thaiNameCache.set(scientificName, promise);

    const thaiName = await promise;
    gameState.thaiNameCache.set(scientificName, thaiName);
    return thaiName;
}

function wikipediaCacheKey(title) {
    return String(title || "")
        .trim()
        .replace(/\s+/g, "_");
}

function isWikipediaBirdPage(summary) {
    if (!summary) return false;

    // Wikipedia's summary metadata is the source of truth for deciding
    // whether a homonymous page belongs to birds. Prefer broad positive bird
    // signals and only reject when the page clearly identifies another
    // biological group (for example, the plant genus Gypsophila).
    const description = String(summary.description || "").toLowerCase();
    const extract = String(summary.extract || "").toLowerCase();
    const text = description + " " + extract;

    const nonBirdSignals = [
        "genus of flowering plants",
        "species of flowering plant",
        "family of flowering plants",
        "genus of plants",
        "species of plant",
        "family of plants",
        "order of plants",
        "genus of fungi",
        "species of fungus",
        "genus of bacteria",
        "species of bacteria"
    ];

    if (nonBirdSignals.some(signal => text.includes(signal))) {
        return false;
    }

    const birdSignals = [
        "bird",
        "birds",
        "avian",
        "passerine",
        "aves"
    ];

    return birdSignals.some(signal => text.includes(signal));
}

function wikipediaLookupCandidates(title) {
    const cleanTitle = String(title || "").trim();
    if (!cleanTitle) return [];

    const candidates = [cleanTitle];

    // If a plain Wikipedia title is a homonym, Wikipedia commonly provides a
    // "(bird)" disambiguation. Try that before giving up.
    if (!/\(bird\)$/i.test(cleanTitle)) {
        candidates.push(cleanTitle + " (bird)");
    }

    return candidates;
}

function wikipediaLookupCandidates(title) {
    const cleanTitle = String(title || "").trim();
    if (!cleanTitle) return [];

    const candidates = [cleanTitle];

    // Wikipedia has a deliberate disambiguation for the bird genus
    // Gypsophila. Try the bird-specific title when the plain title is a
    // plant or another homonym.
    if (!/\\(bird\\)$/i.test(cleanTitle)) {
        candidates.push(cleanTitle + " (bird)");
    }

    return candidates;
}

async function fetchWikipediaPageData(title, includeHtml = false, expectedType = "bird") {
    const candidates = wikipediaLookupCandidates(title);

    for (const candidateTitle of candidates) {
        const normalizedTitle = wikipediaCacheKey(candidateTitle);
        if (!normalizedTitle) continue;

        let data = gameState.wikipediaCache.get(normalizedTitle);

        if (!data) {
            data = {
                summary: null,
                html: null,
                summaryPromise: null,
                htmlPromise: null,
                validatedBird: null
            };
            gameState.wikipediaCache.set(normalizedTitle, data);
        }

        if (!data.summaryPromise && !data.summary) {
            data.summaryPromise = fetch(
                "https://en.wikipedia.org/api/rest_v1/page/summary/" +
                encodeURIComponent(normalizedTitle),
                {
                    headers: {
                        "Api-User-Agent":
                            "MetaAves/1.0 (https://github.com/PrinnBoontanan/MetaAves)"
                    }
                }
            )
                .then(response => response.ok ? response.json() : null)
                .catch(() => null);
        }

        if (data.summaryPromise) {
            data.summary = await data.summaryPromise;
            data.summaryPromise = null;
        }

        if (!data.summary) continue;

        if (expectedType === "bird") {
            data.validatedBird = isWikipediaBirdPage(data.summary);
            if (!data.validatedBird) continue;
        }

        if (includeHtml && !data.html) {
            data.htmlPromise = fetch(
                "https://en.wikipedia.org/w/rest.php/v1/page/" +
                encodeURIComponent(normalizedTitle) +
                "/html" +
                encodeURIComponent(normalizedTitle),
                {
                    headers: {
                        "Api-User-Agent":
                            "MetaAves/1.0 (https://github.com/PrinnBoontanan/MetaAves)"
                    }
                }
            )
                .then(response => response.ok ? response.text() : null)
                .catch(() => null);

            data.html = await data.htmlPromise;
            data.htmlPromise = null;
        }

        return data;
    }

    return null;
}

function normalizeWikipediaText(value) {
    return String(value || "")
        .replace(/\[[^\]]*\]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function normalizeWikipediaHeading(value) {
    return normalizeWikipediaText(value)
        .replace(/\[edit\]/gi, "")
        .toLowerCase();
}

function extractWikipediaSections(html) {
    if (!html) return {};

    const documentRoot = new DOMParser().parseFromString(html, "text/html");
    const content =
        documentRoot.querySelector(".mw-parser-output") ||
        documentRoot.body;

    if (!content) return {};

    // Keep the original DOM intact for infobox extraction. The old parser
    // removed every table before reading sections, which was fine for prose
    // but also made it too easy to lose information when Wikipedia changed
    // its HTML structure.
    const sections = {
        __lead__: ""
    };

    const headings = [
        ...content.querySelectorAll("h2, h3, h4, h5")
    ];

    // Wikipedia now commonly wraps each heading in its own <section>.
    // Store the text belonging to every heading independently. Nested
    // sections are intentionally retained so that a field such as Diet can
    // still be found when it lives inside Behavior and ecology.
    headings.forEach(heading => {
        const headingText = normalizeWikipediaHeading(heading.textContent);
        if (!headingText) return;

        const sectionElement = heading.closest("section");
        let text = "";

        if (sectionElement) {
            const clone = sectionElement.cloneNode(true);
            clone.querySelectorAll(
                "h2, h3, h4, h5, table, style, script, noscript, " +
                ".navbox, .reflist, .reference, .mw-references-wrap"
            ).forEach(element => element.remove());

            text = normalizeWikipediaText(clone.textContent);
        } else {
            const parts = [];
            let sibling = heading.nextElementSibling;

            while (
                sibling &&
                !sibling.matches("h2, h3, h4, h5")
            ) {
                if (!sibling.matches("table, style, script, noscript")) {
                    const siblingText = normalizeWikipediaText(
                        sibling.textContent
                    );
                    if (siblingText) parts.push(siblingText);
                }
                sibling = sibling.nextElementSibling;
            }

            text = normalizeWikipediaText(parts.join(" "));
        }

        if (text) {
            sections[headingText] = text;
        }
    });

    // Lead text before the first heading.
    const firstHeading = headings[0];
    const leadParts = [];
    let leadNode = content.firstElementChild;

    while (leadNode && leadNode !== firstHeading) {
        if (!leadNode.matches("table, style, script, noscript")) {
            const leadText = normalizeWikipediaText(leadNode.textContent);
            if (leadText) leadParts.push(leadText);
        }
        leadNode = leadNode.nextElementSibling;
    }

    sections.__lead__ = normalizeWikipediaText(leadParts.join(" "));
    return sections;
}

function findWikipediaInfoboxField(html, candidates) {
    if (!html) return "";

    const documentRoot = new DOMParser().parseFromString(html, "text/html");
    const rows = documentRoot.querySelectorAll(
        ".infobox tr, table.infobox tr"
    );

    for (const row of rows) {
        const labelElement = row.querySelector("th");
        const valueElement = row.querySelector("td");
        if (!labelElement || !valueElement) continue;

        const label = normalizeWikipediaText(labelElement.textContent)
            .toLowerCase();

        if (!candidates.some(candidate =>
            label.includes(String(candidate).toLowerCase())
        )) {
            continue;
        }

        const value = normalizeWikipediaText(valueElement.textContent);
        if (value) return value;
    }

    return "";
}

function splitWikipediaSentences(text) {
    return normalizeWikipediaText(text)
        .split(/(?<=[.!?])\s+/)
        .map(sentence => sentence.trim())
        .filter(Boolean);
}

function findWikipediaSection(sections, candidates) {
    if (!sections) return "";

    const normalizedCandidates = candidates.map(candidate =>
        String(candidate).toLowerCase()
    );

    // Exact headings have the highest priority.
    for (const candidate of normalizedCandidates) {
        if (sections[candidate]) return sections[candidate];
    }

    // Then allow a heading such as "Diet and feeding" or
    // "Behavior and ecology" to match a requested field.
    for (const [heading, text] of Object.entries(sections)) {
        if (!text || heading === "__lead__") continue;

        if (normalizedCandidates.some(candidate =>
            heading.includes(candidate)
        )) {
            return text;
        }
    }

    return "";
}

function findWikipediaTextByKeywords(sections, keywordGroups) {
    if (!sections) return "";

    const groups = keywordGroups.map(group =>
        group.map(keyword => String(keyword).toLowerCase())
    );

    const matches = [];

    for (const [heading, text] of Object.entries(sections)) {
        if (!text || heading === "__lead__") continue;

        const sentences = splitWikipediaSentences(text);

        for (const sentence of sentences) {
            const lower = sentence.toLowerCase();

            // A sentence qualifies when it contains at least one keyword
            // from each semantic group. This lets us recover information
            // embedded in broad sections such as "Behavior and ecology".
            if (groups.every(group =>
                group.some(keyword => lower.includes(keyword))
            )) {
                matches.push(sentence);
            }
        }
    }

    // Avoid returning the same sentence repeatedly when it appears in
    // nested Wikipedia sections.
    return [...new Set(matches)].join(" ");
}

function getWikipediaStudyData(html) {
    const sections = extractWikipediaSections(html);

    // These fields are deliberately synonym-rich. Wikipedia does not use
    // one fixed heading for bird ecology: "Range", "Distribution and
    // habitat", "Food and feeding", "Behavior and ecology", etc. are all
    // common. The section pass runs first; keyword recovery then searches
    // the prose of every section, so a field can live under another heading.
    const data = {
        sections,
        habitat:
            findWikipediaSection(sections, [
                "distribution and habitat",
                "habitat",
                "ecology and habitat"
            ]),
        distribution:
            findWikipediaSection(sections, [
                "distribution",
                "range",
                "geographic range",
                "distribution and habitat"
            ]),
        diet:
            findWikipediaSection(sections, [
                "diet",
                "feeding",
                "food and feeding",
                "feeding ecology",
                "food"
            ]) ||
            findWikipediaTextByKeywords(sections, [
                ["diet", "feeding", "feeds", "food", "eats", "eat"],
                ["insect", "seed", "fruit", "nectar", "prey", "plant",
                 "fish", "vertebrate", "grain", "forage", "feeds on"]
            ]),
        behavior:
            findWikipediaSection(sections, [
                "behavior and ecology",
                "behaviour and ecology",
                "behavior",
                "behaviour",
                "ecology"
            ]),
        breeding:
            findWikipediaSection(sections, [
                "breeding",
                "reproduction",
                "nesting",
                "breeding biology"
            ]),
        conservation:
            findWikipediaSection(sections, [
                "conservation",
                "conservation status",
                "status",
                "threats"
            ]) ||
            findWikipediaInfoboxField(
                html,
                ["conservation status", "conservation"]
            )
    };

    // A broad section can contain the actual field without having a
    // dedicated heading. Recover those cases instead of showing "No
    // information" simply because Wikipedia chose a different layout.
    if (!data.habitat) {
        data.habitat = findWikipediaTextByKeywords(sections, [
            ["habitat", "inhabit", "lives", "found"],
            ["forest", "woodland", "grassland", "wetland", "savanna",
             "mountain", "coast", "island", "river", "shrubland"]
        ]);
    }

    if (!data.distribution) {
        data.distribution = findWikipediaTextByKeywords(sections, [
            ["range", "distribution", "found", "occurs", "native"],
            ["north", "south", "east", "west", "island", "islands",
             "africa", "asia", "europe", "australia", "america"]
        ]);
    }

    if (!data.breeding) {
        data.breeding = findWikipediaTextByKeywords(sections, [
            ["breed", "breeding", "nest", "egg", "incubat", "chick",
             "reproduct"],
            ["nest", "egg", "chick", "young", "incubat", "lay"]
        ]);
    }

    if (!data.behavior) {
        data.behavior = findWikipediaTextByKeywords(sections, [
            ["behavior", "behaviour", "social", "forag", "vocal",
             "territor", "roost", "migrat"],
            ["bird", "species", "individual", "male", "female"]
        ]);
    }

    return data;
}

function getWikipediaTitleFromTaxon(taxon, info) {
    if (info?.wikipedia) {
        try {
            const url = new URL(info.wikipedia);
            const wikiPath = url.pathname.match(/\/wiki\/(.+)$/);
            if (wikiPath?.[1]) {
                return decodeURIComponent(wikiPath[1]).replace(/_/g, " ");
            }
        } catch (error) {
            // Fall through to the taxon's own name.
        }
    }

    return taxon?.wikipediaTitle || taxon?.name || "";
}

function appendWikipediaImage(card, wiki, className) {
    if (!card || !wiki?.summary?.thumbnail?.source) return;

    const image = document.createElement("img");
    image.className = className;
    image.src = wiki.summary.thumbnail.source;
    image.alt = wiki.summary.title || "";
    image.loading = "lazy";
    card.appendChild(image);
}

function appendCardSection(card, heading, text) {
    if (!card || !text) return;

    const section = document.createElement("div");
    section.className = "taxon-card-wiki-section";

    const title = document.createElement("h4");
    title.textContent = heading;

    const paragraph = document.createElement("p");
    paragraph.textContent = text;

    section.appendChild(title);
    section.appendChild(paragraph);
    card.appendChild(section);
}

async function showBirdInTaxonCard(bird) {
    const card = document.getElementById("taxon-card");
    if (!card || !bird) return;

    gameState.selectedTaxonId = "species:" + (bird.scientificName || bird.commonName);
    const selectionId = gameState.selectedTaxonId;

    card.innerHTML = "<p>Loading bird information from Wikipedia...</p>";

    const wikiTitle = bird.wikipediaTitle || bird.commonName;
    const wiki = await fetchWikipediaPageData(wikiTitle, true, "bird");

    // Do not let a slower old request overwrite a newer selection.
    if (gameState.selectedTaxonId !== selectionId) return;

    renderBirdCard(bird, wiki);
}

function renderBirdCard(bird, wiki) {
    const card = document.getElementById("taxon-card");
    if (!card) return;

    card.innerHTML = "";

    const title = document.createElement("h3");
    title.textContent = bird.commonName;
    card.appendChild(title);

    const scientific = document.createElement("p");
    scientific.classList.add("taxon-card-rank");
    scientific.textContent = bird.scientificName || "Scientific name unavailable";
    card.appendChild(scientific);

    const rank = document.createElement("p");
    rank.classList.add("taxon-card-rank");
    rank.textContent = "SPECIES";
    card.appendChild(rank);

    const hasWikiSummary = Boolean(wiki?.summary?.extract);
    const description = hasWikiSummary
        ? wiki.summary.extract
        : "No information available on Wikipedia.";

    appendWikipediaImage(card, wiki, "taxon-card-image");

    if (!wiki?.summary?.thumbnail?.source) {
        appendCardSection(card, "Photo", "No photo available on Wikipedia.");
    }

    appendCardSection(card, "Description", description);

    // Taxonomy is intentionally shown only for species cards. Higher taxon
    // cards do not repeat their taxonomy because the tree already provides it.
    const taxonomySection = document.createElement("div");
    taxonomySection.className = "taxon-card-wiki-section taxon-card-species-taxonomy";

    const taxonomyHeading = document.createElement("h4");
    taxonomyHeading.textContent = "Taxonomy";
    taxonomySection.appendChild(taxonomyHeading);

    const taxonomyRows = [
        ["Class", bird.class || "Aves"],
        ["Order", bird.order],
        ["Family", bird.family],
        ["Genus", bird.genus],
        ["Species", bird.species || bird.scientificName]
    ];

    taxonomyRows.forEach(([label, value]) => {
        if (!value) return;

        const row = document.createElement("p");
        row.className = "taxon-card-taxonomy-row";

        const labelElement = document.createElement("strong");
        labelElement.textContent = label + ": ";

        row.appendChild(labelElement);
        row.appendChild(document.createTextNode(value));
        taxonomySection.appendChild(row);
    });

    card.appendChild(taxonomySection);

    const link = wiki?.summary?.content_urls?.desktop?.page;
    if (link) {
        const wikipediaLink = document.createElement("a");
        wikipediaLink.className = "taxon-card-wikipedia-link";
        wikipediaLink.href = link;
        wikipediaLink.target = "_blank";
        wikipediaLink.rel = "noopener noreferrer";
        wikipediaLink.textContent = "Wikipedia";
        card.appendChild(wikipediaLink);
    } else {
        appendCardSection(card, "Wikipedia", "No Wikipedia page available.");
    }
}

async function showTaxonInTaxonCard(taxon) {
    const card = document.getElementById("taxon-card");
    if (!card || !taxon) return;

    gameState.selectedTaxonId = taxon.id;
    const selectionId = taxon.id;

    if (taxon.rank === "clade") {
        card.innerHTML = "<p>Loading clade information from Wikipedia...</p>";

        const wiki = await fetchWikipediaPageData(
            getWikipediaTitleFromTaxon(taxon, {}),
            true,
            "bird"
        );

        if (gameState.selectedTaxonId !== selectionId) return;
        renderCladeCard(taxon, wiki);
        return;
    }

    renderTaxonCard(taxon);

    const info = gameState.taxonInfo?.[taxon.id] || {};
    const wikiTitle = getWikipediaTitleFromTaxon(taxon, info);
    const wiki = await fetchWikipediaPageData(wikiTitle, true);

    if (gameState.selectedTaxonId !== selectionId) return;

    const description = card.querySelector(".taxon-card-description");
    if (description) {
        description.textContent =
            wiki?.summary?.extract ||
            "No information available on Wikipedia.";
    }

    if (wiki?.summary?.thumbnail?.source) {
        const image = document.createElement("img");
        image.className = "taxon-card-image";
        image.src = wiki.summary.thumbnail.source;
        image.alt = wiki.summary.title || taxon.name;
        image.loading = "lazy";
        card.insertBefore(image, description || null);
    } else {
        appendCardSection(card, "Photo", "No photo available on Wikipedia.");
    }

    const wikiUrl = wiki?.summary?.content_urls?.desktop?.page;
    if (wikiUrl) {
        const link = document.createElement("a");
        link.className = "taxon-card-wikipedia-link";
        link.href = wikiUrl;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = "Wikipedia";
        card.appendChild(link);
    } else {
        appendCardSection(card, "Wikipedia", "No Wikipedia page available.");
    }
}

function selectTaxon(node) {
    if (node.type !== "taxon") return;

    let taxon = null;

    if (node.level === "clade") {
        taxon = gameState.clades?.[node.taxonId] || null;
    } else if (gameState.taxonomy) {
        taxon = Object.values(gameState.taxonomy).find(
            entry => entry.id === node.taxonId
        );
    }

    if (!taxon) return;

    showTaxonInTaxonCard(taxon);
}

function renderCladeCard(clade, wiki) {
    const card = document.getElementById("taxon-card");
    if (!card) return;

    card.innerHTML = "";

    const title = document.createElement("h3");
    title.textContent = clade.name;
    card.appendChild(title);

    const rank = document.createElement("p");
    rank.classList.add("taxon-card-rank");
    rank.textContent = "CLADE";
    card.appendChild(rank);

    if (wiki?.summary?.thumbnail?.source) {
        const image = document.createElement("img");
        image.className = "taxon-card-image";
        image.src = wiki.summary.thumbnail.source;
        image.alt = wiki.summary.title || clade.name;
        image.loading = "lazy";
        card.appendChild(image);
    } else {
        appendCardSection(card, "Photo", "No photo available on Wikipedia.");
    }

    const description = document.createElement("p");
    description.classList.add("taxon-card-description");
    description.textContent =
        wiki?.summary?.extract ||
        "No information available on Wikipedia.";
    card.appendChild(description);

    const linkUrl = wiki?.summary?.content_urls?.desktop?.page;
    if (linkUrl) {
        const link = document.createElement("a");
        link.className = "taxon-card-wikipedia-link";
        link.href = linkUrl;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = "Wikipedia";
        card.appendChild(link);
    } else {
        appendCardSection(card, "Wikipedia", "No Wikipedia page available.");
    }
}

function renderTaxonCard(taxon) {
    const card = document.getElementById("taxon-card");
    if (!card) return;

    const info = gameState.taxonInfo?.[taxon.id] || {};

    card.innerHTML = "";

    const title = document.createElement("h3");
    title.textContent = info.name || taxon.name;

    const rank = document.createElement("p");
    rank.classList.add("taxon-card-rank");
    rank.textContent = (info.rank || taxon.rank || "").toUpperCase();

    const common = document.createElement("p");
    if (info.commonName) {
        common.textContent = info.commonName;
    }

    const description = document.createElement("p");
    description.classList.add("taxon-card-description");
    description.textContent = "Loading information from Wikipedia…";

    card.appendChild(title);
    card.appendChild(rank);
    if (info.commonName) card.appendChild(common);
    card.appendChild(description);
}

function getMostUsefulTaxon() {
    if (!gameState.mysteryBird || !gameState.taxonomy) return null;

    if (gameState.guesses.length === 0) {
        return gameState.taxonomy["class:Aves"] || null;
    }

    const reveal = getMysteryRevealTaxon();

    if (reveal.level === "clade") {
        return gameState.clades?.[reveal.id] || null;
    }

    const id = `${reveal.level}:${reveal.value}`;

    return gameState.taxonomy[id]
        || Object.values(gameState.taxonomy).find(
            taxon =>
                taxon.rank === reveal.level &&
                taxon.name === reveal.value
        )
        || gameState.taxonomy["class:Aves"]
        || null;
}


function updateAutomaticTaxonCard() {
    const taxon = getMostUsefulTaxon();
    if (!taxon) return;

    gameState.selectedTaxonId = taxon.id;

    showTaxonInTaxonCard(taxon);
}



function getBirdRankValue(bird, level) {
    if (!bird) return "";

    if (level === "class") {
        return bird.class || "Aves";
    }

    return bird[level] || "";
}

function getCladeText(bird) {
    if (!bird || !Array.isArray(bird.cladePath) || !bird.cladePath.length) {
        return "";
    }

    return bird.cladePath.join(" → ");
}

function renderTaxonomyTable() {
    taxonomyTree.innerHTML = "";
    taxonomyTree.classList.add("table-mode");

    const wrapper = document.createElement("div");
    wrapper.className = "taxonomy-table-wrap";

    const table = document.createElement("table");
    table.className = "taxonomy-table";

    const levels = ["class", "order", "family", "genus"];

    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");

    ["Bird", "Clades", ...levels.map(level => level[0].toUpperCase() + level.slice(1)), "Shared with mystery"].forEach(label => {
        const th = document.createElement("th");
        th.textContent = label;
        headerRow.appendChild(th);
    });

    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");

    if (!gameState.guesses.length) {
        const row = document.createElement("tr");
        const cell = document.createElement("td");
        cell.className = "table-placeholder";
        cell.colSpan = 7;
        cell.textContent = "Your guesses will appear here.";
        row.appendChild(cell);
        tbody.appendChild(row);
        table.appendChild(tbody);
        wrapper.appendChild(table);
        taxonomyTree.appendChild(wrapper);
        return;
    }

    gameState.guesses.forEach(bird => {
        const row = document.createElement("tr");
        const shared = getDeepestSharedTaxon(bird, gameState.mysteryBird);

        const birdCell = document.createElement("td");
        birdCell.className = "table-bird";
        birdCell.textContent = bird.commonName;
        row.appendChild(birdCell);

        const cladeCell = document.createElement("td");
        cladeCell.className = "clade-cell";
        cladeCell.textContent = getCladeText(bird) || "—";
        if (shared.level === "clade") cladeCell.classList.add("shared-cell");
        row.appendChild(cladeCell);

        levels.forEach(level => {
            const td = document.createElement("td");
            const value = getBirdRankValue(bird, level);
            td.textContent = value || "—";

            const sharedNode = shared.level === level
                ? shared
                : getBirdPhylogenyPath(bird).find(node => node.level === level);

            const mysteryNode = getBirdPhylogenyPath(gameState.mysteryBird)
                .find(node => node.level === level);

            if (sharedNode && mysteryNode && sharedNode.id === mysteryNode.id) {
                td.classList.add("shared-cell");
            } else if (level !== "class") {
                td.classList.add("not-shared-cell");
            }

            row.appendChild(td);
        });

        const sharedCell = document.createElement("td");
        sharedCell.textContent = shared.value || "Aves";
        sharedCell.classList.add("shared-cell");
        row.appendChild(sharedCell);

        tbody.appendChild(row);
    });

    table.appendChild(tbody);
    wrapper.appendChild(table);
    taxonomyTree.appendChild(wrapper);
}

const taxonomyHorizontalScroll = document.getElementById("taxonomy-horizontal-scroll");
const taxonomyHorizontalScrollContent =
    taxonomyHorizontalScroll?.querySelector(".taxonomy-horizontal-scroll-content");

function syncTaxonomyHorizontalScroll() {
    if (!taxonomyHorizontalScroll || !taxonomyHorizontalScrollContent) return;

    const isTree = gameState.taxonomyView === "tree";
    const needsScroll = isTree && taxonomyTree.scrollWidth > taxonomyTree.clientWidth + 2;

    taxonomyHorizontalScroll.classList.toggle("visible", needsScroll);

    if (!needsScroll) {
        taxonomyHorizontalScroll.scrollLeft = 0;
        taxonomyTree.scrollLeft = 0;
        taxonomyHorizontalScrollContent.style.width = "1px";
        return;
    }

    taxonomyHorizontalScrollContent.style.width = taxonomyTree.scrollWidth + "px";
    taxonomyHorizontalScroll.scrollLeft = taxonomyTree.scrollLeft;
}

taxonomyTree.addEventListener("scroll", () => {
    if (taxonomyHorizontalScroll) {
        taxonomyHorizontalScroll.scrollLeft = taxonomyTree.scrollLeft;
    }
});

taxonomyHorizontalScroll?.addEventListener("scroll", () => {
    taxonomyTree.scrollLeft = taxonomyHorizontalScroll.scrollLeft;
});

window.addEventListener("resize", () => {
    requestAnimationFrame(syncTaxonomyHorizontalScroll);
});

function renderTaxonomyView() {
    if (gameState.taxonomyView === "table") {
        renderTaxonomyTable();
    } else {
        renderTaxonomyTree();
    }

    if (treeViewButton && tableViewButton) {
        treeViewButton.classList.toggle("active", gameState.taxonomyView === "tree");
        tableViewButton.classList.toggle("active", gameState.taxonomyView === "table");
    }

    requestAnimationFrame(syncTaxonomyHorizontalScroll);
}

function renderTaxonomyTree() {
    taxonomyTree.classList.remove("table-mode");
    taxonomyTree.innerHTML = "";

    if (!gameState.mysteryBird) return;

    const model = buildTreeModel();

    const canvas = document.createElement("div");
    canvas.classList.add("meta-tree-canvas");

    const svg = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "svg"
    );
    svg.classList.add("meta-tree-lines");

    const nodeLayer = document.createElement("div");
    nodeLayer.classList.add("meta-tree-nodes");

    canvas.appendChild(svg);
    canvas.appendChild(nodeLayer);
    taxonomyTree.appendChild(canvas);

    const levelGap = 96;
    const horizontalGap = 42;
    const sidePadding = 44;
    const positions = [];
    const measuredWidths = new Map();

    function measureNode(node) {
        if (measuredWidths.has(node)) return measuredWidths.get(node);

        const element = createTreeNodeElement(node);
        element.style.visibility = "hidden";
        element.style.position = "absolute";
        element.style.left = "-10000px";
        element.style.top = "0";
        nodeLayer.appendChild(element);

        const width = Math.max(
            element.offsetWidth || 74,
            node.type === "taxon" ? 84 : 78
        );

        element.remove();
        measuredWidths.set(node, width);
        return width;
    }

    function getSubtreeWidth(node) {
        const ownWidth = measureNode(node);

        if (!node.children || node.children.length === 0) {
            node.__treeWidth = ownWidth;
            return ownWidth;
        }

        const childrenWidth =
            node.children.reduce(
                (sum, child) => sum + getSubtreeWidth(child),
                0
            ) +
            horizontalGap * Math.max(0, node.children.length - 1);

        node.__treeWidth = Math.max(ownWidth, childrenWidth);
        return node.__treeWidth;
    }

    const treeContentWidth = getSubtreeWidth(model);

    function place(node, depth, left) {
        const subtreeWidth = node.__treeWidth || measureNode(node);
        const ownWidth = measureNode(node);

        let centerX;

        if (!node.children || node.children.length === 0) {
            centerX = left + subtreeWidth / 2;
        } else {
            const childWidths = node.children.map(
                child => child.__treeWidth || measureNode(child)
            );

            const totalChildrenWidth =
                childWidths.reduce((sum, width) => sum + width, 0) +
                horizontalGap * Math.max(0, childWidths.length - 1);

            let cursor =
                left +
                (subtreeWidth - totalChildrenWidth) / 2;

            const childCenters = [];

            node.children.forEach((child, index) => {
                const childCenter = place(child, depth + 1, cursor);
                childCenters.push(childCenter);
                cursor += childWidths[index] + horizontalGap;
            });

            centerX =
                childCenters.reduce((sum, x) => sum + x, 0) /
                childCenters.length;
        }

        positions.push({
            node,
            depth,
            x: centerX,
            width: ownWidth
        });

        return centerX;
    }

    const minimumContentWidth = treeContentWidth + sidePadding * 2;
    const canvasWidth = Math.max(
        taxonomyTree.clientWidth - 20,
        minimumContentWidth
    );

    const leftOffset = Math.max(
        sidePadding,
        (canvasWidth - treeContentWidth) / 2
    );

    place(model, 0, leftOffset);

    const maxDepth = Math.max(
        ...positions.map(position => position.depth),
        0
    );
    positions.forEach(position => {
        position.node.__renderDepth = position.depth;
        position.node.__renderMaxDepth = maxDepth;
    });

    const canvasHeight =
        56 + (maxDepth + 1) * levelGap;

    canvas.style.width = canvasWidth + "px";
    canvas.style.height = canvasHeight + "px";

    svg.setAttribute("width", canvasWidth);
    svg.setAttribute("height", canvasHeight);
    svg.setAttribute("viewBox", `0 0 ${canvasWidth} ${canvasHeight}`);

    const positioned = new Map();

    positions.forEach(position => {
        const element = createTreeNodeElement(position.node);

        const nodeHeight = element.offsetHeight || 34;
        const actualWidth = element.offsetWidth || position.width;

        const x = position.x - actualWidth / 2;
        const y =
            28 +
            position.depth * levelGap -
            nodeHeight / 2;

        element.style.left = x + "px";
        element.style.top = y + "px";
        element.style.setProperty(
            "--node-delay",
            `${position.depth * 0.95}s`
        );

        nodeLayer.appendChild(element);

        positioned.set(position.node, {
            x: x + element.offsetWidth / 2,
            y: y + element.offsetHeight / 2,
            width: element.offsetWidth,
            height: element.offsetHeight,
            depth: position.depth,
            element
        });
    });

    function drawConnections(node) {
        if (node.type !== "taxon") return;

        const parent = positioned.get(node);
        if (!parent) return;

        node.children.forEach(child => {
            const childPosition = positioned.get(child);
            if (!childPosition) return;

            const startX = parent.x;
            const startY = parent.y + parent.height / 2;
            const endX = childPosition.x;
            const endY = childPosition.y - childPosition.height / 2;

            const verticalDistance = Math.max(1, endY - startY);
            const curve = Math.max(26, verticalDistance * 0.48);

            const path = document.createElementNS(
                "http://www.w3.org/2000/svg",
                "path"
            );

            if (Math.abs(startX - endX) < 1) {
                path.setAttribute(
                    "d",
                    `M ${startX} ${startY} L ${endX} ${endY}`
                );
            } else {
                path.setAttribute(
                    "d",
                    `M ${startX} ${startY}
                     C ${startX} ${startY + curve},
                       ${endX} ${endY - curve},
                       ${endX} ${endY}`
                );
            }

            path.classList.add("meta-tree-connection");

            const pathLength = path.getTotalLength();
            path.style.strokeDasharray = pathLength;
            path.style.strokeDashoffset = pathLength;
            path.style.setProperty("--branch-length", pathLength);

            if (child.type === "taxon") {
                path.classList.add("meta-connection-taxon");
                const branchProximity = maxDepth > 0
                    ? Math.max(0, Math.min(1, childPosition.depth / maxDepth))
                    : 0;
                path.style.setProperty(
                    "--tree-proximity-hue",
                    Math.round(branchProximity * 120)
                );
            } else {
                path.classList.add("meta-connection-species");
            }

            svg.appendChild(path);

            const branchDelay =
                positioned.get(node).depth * 0.95 + 0.28;

            setTimeout(() => {
                path.classList.add("active");
            }, branchDelay * 1000);

            if (child.type === "taxon") {
                drawConnections(child);
            }
        });
    }

    drawConnections(model);

    positions.forEach(position => {
        delete position.node.__treeWidth;
    });
}


// ========================================
// Game Over Card
// ========================================

function getBirdTaxonomyText(bird) {
    return [
        bird.class,
        bird.order,
        bird.family,
        bird.genus
    ].filter(Boolean).join(" → ");
}

async function showGameOverCard(result) {
    const overlay = document.getElementById("game-over-overlay");
    const newGameButton = document.getElementById("new-game-button");
    const title = document.getElementById("game-over-title");
    const message = document.getElementById("game-over-message");
    const birdName = document.getElementById("study-bird-name");
    const scientificName = document.getElementById("study-scientific-name");
    const thaiName = document.getElementById("study-thai-name");
    const taxonomy = document.getElementById("study-taxonomy");

    const bird = gameState.mysteryBird;
    if (!overlay || !bird) return;

    const details = document.querySelector(".study-card-details");
    if (!details) return;

    details.querySelectorAll(".study-card-section").forEach(section => section.remove());

    gameState.gameStatus = result === "won" ? "won" : "lost";

    if (result === "won") {
        title.textContent = "You found the mystery bird!";
        message.textContent = "Congratulations!";
    } else {
        title.textContent = "Out of guesses!";
        message.textContent = "Here is the mystery bird.";
    }

    birdName.textContent = bird.commonName;
    scientificName.textContent = bird.scientificName || "Unknown";
    thaiName.textContent = "Loading Thai name...";
    taxonomy.innerHTML = "";

    const taxonomyRows = [
        ["Class", bird.class || "Aves"],
        [
            "Clades",
            Array.isArray(bird.cladePath) && bird.cladePath.length
                ? bird.cladePath.join(" → ")
                : null
        ],
        ["Order", bird.order],
        ["Family", bird.family],
        ["Genus", bird.genus],
        ["Species", bird.species || bird.scientificName]
    ];

    taxonomyRows.forEach(([label, value]) => {
        if (!value) return;

        const row = document.createElement("div");
        row.className = "study-taxonomy-row";

        const labelElement = document.createElement("span");
        labelElement.className = "study-taxonomy-label";
        labelElement.textContent = label;

        const valueElement = document.createElement("span");
        valueElement.className = "study-taxonomy-value";
        valueElement.textContent = value;

        row.appendChild(labelElement);
        row.appendChild(valueElement);
        taxonomy.appendChild(row);
    });

    const unavailable = "No information available on Wikipedia.";

    const addStudySection = (heading, value) => {
        const section = document.createElement("div");
        section.className = "study-card-section";
        section.dataset.studyHeading = heading.toLowerCase();

        const headingElement = document.createElement("h4");
        headingElement.textContent = heading;

        const text = document.createElement("p");
        text.textContent = value || unavailable;

        section.appendChild(headingElement);
        section.appendChild(text);
        details.appendChild(section);
    };

    const studyImage = document.getElementById("study-bird-image");
    if (studyImage) studyImage.remove();

    const photoPlaceholder = document.createElement("div");
    photoPlaceholder.id = "study-photo-placeholder";
    photoPlaceholder.className = "study-card-section";
    photoPlaceholder.dataset.studyHeading = "photo";

    const photoHeading = document.createElement("h4");
    photoHeading.textContent = "Photo";
    const photoText = document.createElement("p");
    photoText.textContent = "Loading photo from Wikipedia...";
    photoPlaceholder.appendChild(photoHeading);
    photoPlaceholder.appendChild(photoText);
    details.before(photoPlaceholder);

    addStudySection("Description", unavailable);
    addStudySection("Habitat", unavailable);
    addStudySection("Distribution", unavailable);
    addStudySection("Diet", unavailable);
    addStudySection("Behavior", unavailable);
    addStudySection("Breeding", unavailable);
    addStudySection("Conservation", unavailable);

    overlay.classList.add("visible");
    if (newGameButton) newGameButton.classList.add("visible");

    const wikiTitle = bird.wikipediaTitle || bird.commonName;
    const [wiki, onlineThaiName] = await Promise.all([
        fetchWikipediaPageData(wikiTitle, true),
        fetchOnlineThaiName(bird)
    ]);

    if (gameState.mysteryBird !== bird) return;

    thaiName.textContent =
        onlineThaiName ||
        bird.thaiName ||
        "No information available online.";

    const studyData = getWikipediaStudyData(wiki?.html);
    const description =
        wiki?.summary?.extract ||
        findWikipediaSection(
            studyData.sections,
            ["description", "appearance", "identification"]
        );

    const setStudyValue = (heading, value) => {
        const section = document.querySelector(
            `.study-card-section[data-study-heading="${heading.toLowerCase()}"]`
        );
        const paragraph = section?.querySelector("p");
        if (paragraph) paragraph.textContent = value || unavailable;
    };

    setStudyValue("Description", description);
    setStudyValue("Habitat", studyData.habitat);
    setStudyValue("Distribution", studyData.distribution);
    setStudyValue("Diet", studyData.diet);
    setStudyValue("Behavior", studyData.behavior);
    setStudyValue("Breeding", studyData.breeding);
    setStudyValue("Conservation", studyData.conservation);

    const placeholder = document.getElementById("study-photo-placeholder");
    const imageSource = wiki?.summary?.thumbnail?.source;

    if (placeholder) {
        if (imageSource) {
            placeholder.remove();

            const image = document.createElement("img");
            image.id = "study-bird-image";
            image.className = "study-card-image study-card-hero-image";
            image.src = imageSource;
            image.alt = bird.commonName;
            image.loading = "lazy";

            details.before(image);
        } else {
            const photoText = placeholder.querySelector("p");
            if (photoText) photoText.textContent = "No photo available on Wikipedia.";
        }
    }

    const wikiLink = wiki?.summary?.content_urls?.desktop?.page;
    if (wikiLink) {
        const wikiSection = document.createElement("div");
        wikiSection.className = "study-card-section";
        wikiSection.dataset.studyHeading = "wikipedia";

        const link = document.createElement("a");
        link.href = wikiLink;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = "Wikipedia →";

        wikiSection.appendChild(link);
        details.appendChild(wikiSection);
    }
}

function closeGameOverCard() {
    const overlay = document.getElementById("game-over-overlay");
    if (overlay) {
        overlay.classList.remove("visible");
    }
}

function replayGame() {
    const newGameButton = document.getElementById("new-game-button");

    if (newGameButton) {
        newGameButton.classList.remove("visible");
    }
    closeGameOverCard();

    gameState.guessesRemaining = gameState.maxGuesses;
    gameState.guesses = [];
    gameState.selectedTaxonId = null;
    gameState.gameStatus = "playing";

    // Start a fresh round with a new mystery species from the
    // currently loaded full dataset.
    gameState.mysteryBird =
        gameState.birds[Math.floor(Math.random() * gameState.birds.length)];

    searchInput.value = "";
    suggestions.innerHTML = "";

    updateGuessCounter();
    renderTaxonomyView();
    updateAutomaticTaxonCard();
}

document.getElementById("game-over-close").addEventListener(
    "click",
    closeGameOverCard
);

document.getElementById("game-over-replay").addEventListener(
    "click",
    replayGame
);

document.getElementById("new-game-button").addEventListener(
    "click",
    replayGame
);

document.getElementById("game-over-overlay").addEventListener(
    "click",
    event => {
        if (event.target.id === "game-over-overlay") {
            closeGameOverCard();
        }
    }
);


// ========================================
// Events
// ========================================

guessButton.addEventListener("click", makeGuess);

searchInput.addEventListener("keydown", event => {
    if (event.key === "ArrowDown") {
        if (moveSuggestionSelection(1)) event.preventDefault();
        return;
    }

    if (event.key === "ArrowUp") {
        if (moveSuggestionSelection(-1)) event.preventDefault();
        return;
    }

    if (event.key === "Escape") {
        suggestions.innerHTML = "";
        suggestions.classList.remove("visible");
        searchInput.setAttribute("aria-expanded", "false");
        return;
    }

    if (event.key === "Enter") {
        const selected = suggestions.querySelector(".suggestion.keyboard-selected");

        if (selected) {
            selected.click();
            event.preventDefault();
            return;
        }

        makeGuess();
    }
});

searchInput.addEventListener("input", () => {
    showSuggestions(searchInput.value);
});


treeViewButton?.addEventListener("click", () => {
    gameState.taxonomyView = "tree";
    renderTaxonomyView();
});

tableViewButton?.addEventListener("click", () => {
    gameState.taxonomyView = "table";
    renderTaxonomyView();
});

// ========================================
// Start game
// ========================================

async function startGame() {
    updateGuessCounter();
    await loadGameData();
}

startGame();
