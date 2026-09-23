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
    taxonomyView: "tree"
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
            infoResponse,
            cladeResponse
        ] = await Promise.all([
            fetch("data/birds.generated.json"),
            fetch("data/taxonomy.generated.json"),
            fetch("data/taxon_info.json"),
            fetch("data/clades.json")
        ]);

        if (
            !birdResponse.ok ||
            !taxonomyResponse.ok ||
            !infoResponse.ok ||
            !cladeResponse.ok
        ) {
            throw new Error("Could not load MetaAves data.");
        }

        gameState.birds = await birdResponse.json();
        gameState.taxonomy = await taxonomyResponse.json();
        gameState.taxonInfo = await infoResponse.json();
        gameState.clades = await cladeResponse.json();

        // Clade membership is derived from the canonical order → clade
        // backbone. Do not make the optional generated membership cache a
        // prerequisite for starting the game.
        const canonicalCladePaths =
            gameState.clades?._meta?.orderCladePaths || {};

        gameState.birds.forEach(bird => {
            bird.cladePath = canonicalCladePaths[bird.order]
                ? [...canonicalCladePaths[bird.order]]
                : [];
        });

        // The ranked hierarchy is intentionally fixed to the classic game model.
        // Do not derive extra ranks from the dataset.

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
// Corrected broad avian clade backbone
// ========================================
//
// Neoaves has a partially unresolved deep phylogeny, so MetaAves uses the
// well-supported named supraordinal groups without pretending that all of
// their relationships form one settled ladder.

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

function showSuggestions(searchText) {
    suggestions.innerHTML = "";

    if (searchText.trim() === "") {
        return;
    }

    const search = searchText.toLowerCase();

    const matches = gameState.birds.filter(bird => {
        return (
            bird.commonName.toLowerCase().includes(search) &&
            !hasAlreadyBeenGuessed(bird)
        );
    });

    matches.forEach(bird => {
        const suggestion = document.createElement("div");

        suggestion.classList.add("suggestion");
        suggestion.textContent = bird.commonName;

        suggestion.addEventListener("click", () => {
            searchInput.value = bird.commonName;
            suggestions.innerHTML = "";
            searchInput.focus();
        });

        suggestions.appendChild(suggestion);
    });
}


// ========================================
// Find deepest shared taxon
// ========================================

function getBirdPhylogenyPath(bird) {
    if (!bird) return [];

    // Species IDs in generated taxonomy are sanitized, so never construct
    // an ID directly from the raw scientific name. Resolve the actual node.
    const speciesTaxon = Object.values(gameState.taxonomy || {}).find(
        taxon =>
            taxon.rank === "species" &&
            taxon.name === bird.scientificName
    );

    const rankedPath = [];
    let currentId = speciesTaxon?.id || null;
    const seen = new Set();

    while (
        currentId &&
        !seen.has(currentId) &&
        gameState.taxonomy?.[currentId]
    ) {
        seen.add(currentId);

        const taxon = gameState.taxonomy[currentId];

        rankedPath.unshift({
            id: taxon.id,
            level: taxon.rank,
            value: taxon.name,
            depth: 0
        });

        if (taxon.id === "class:Aves") break;
        currentId = taxon.parent;
    }

    // Safe fallback for a species that somehow has no generated node.
    if (!rankedPath.length || rankedPath[0]?.id !== "class:Aves") {
        rankedPath.length = 0;
        rankedPath.push({
            id: "class:Aves",
            level: "class",
            value: bird.class || "Aves",
            depth: 0
        });

        taxonomyLevels.forEach(level => {
            if (level === "class" || level === "species") return;

            const value = bird[level];
            if (!value) return;

            rankedPath.push({
                id: nodeIdForTaxon(level, value),
                level,
                value,
                depth: 0
            });
        });

        rankedPath.push({
            id: nodeIdForTaxon("species", bird.scientificName),
            level: "species",
            value: bird.scientificName,
            depth: 0
        });
    }

    // Clades are a separate layer, but their parent pointers give us the
    // correct root-to-leaf order. This fixes the old bug where clades were
    // simply appended before/after ranked taxonomy without regard to their
    // actual nesting.
    const cladeEntries = new Map();

    (Array.isArray(bird.cladePath) ? bird.cladePath : []).forEach(name => {
        const clade = Object.values(gameState.clades || {}).find(
            entry =>
                entry.rank === "clade" &&
                entry.name === name
        );

        if (clade) cladeEntries.set(clade.id, clade);
    });

    function cladeDepth(clade) {
        let depth = 0;
        let current = clade;
        const seenClades = new Set();

        while (
            current?.parent &&
            !seenClades.has(current.id)
        ) {
            seenClades.add(current.id);
            const parent = gameState.clades?.[current.parent];

            if (!parent || !cladeEntries.has(parent.id)) break;

            depth++;
            current = parent;
        }

        return depth;
    }

    const orderedClades = [...cladeEntries.values()]
        .sort((a, b) => cladeDepth(a) - cladeDepth(b));

    const result = [];
    const addNode = (id, level, value) => {
        if (!id || result.some(node => node.id === id)) return;

        result.push({
            id,
            level,
            value,
            depth: result.length
        });
    };

    // Aves is the immutable root.
    addNode("class:Aves", "class", "Aves");

    // Every clade supplied for the species sits between Aves and the first
    // ranked taxon below Aves. Parent pointers determine their ordering.
    orderedClades.forEach(clade => {
        addNode(clade.id, "clade", clade.name);
    });

    // Add the ranked taxonomy exactly as stored by the generated parent
    // relationships. No rank is invented when the source does not provide it.
    rankedPath.slice(1).forEach(node => {
        addNode(node.id, node.level, node.value);
    });

    return result.map((node, index) => ({
        ...node,
        depth: index
    }));
}

function nodeIdForTaxon(rank, value) {
    const safe = String(value || "")
        .replace(/[^A-Za-z0-9_-]+/g, "_")
        .replace(/^_+|_+$/g, "");

    return `${rank}:${safe}`;
}

function getDeepestSharedTaxon(guessedBird, mysteryBird) {
    const guessedPath = getBirdPhylogenyPath(guessedBird);
    const mysteryPath = getBirdPhylogenyPath(mysteryBird);

    // First compare the formal ranked taxonomy independently of the
    // phylogenetic clades. Clades are inserted into the path, so comparing
    // the paths by array index would make a shared family/order look like
    // Aves whenever the two birds have different clade branches.
    let deepestRanked = guessedPath[0] || {
        id: "class:Aves",
        level: "class",
        value: "Aves",
        depth: 0
    };

    for (const level of taxonomyLevels) {
        if (level === "class" || level === "species") {
            continue;
        }

        const guessedNode = guessedPath.find(node => node.level === level);
        const mysteryNode = mysteryPath.find(node => node.level === level);

        // A missing intermediate rank must not make a later populated rank
        // appear to be shared. Stop as soon as the formal hierarchy diverges.
        if (
            guessedNode &&
            mysteryNode &&
            guessedNode.id === mysteryNode.id
        ) {
            deepestRanked = mysteryNode;
        } else if (guessedNode || mysteryNode) {
            break;
        }
    }

    // If the birds only share Aves as a formal rank, use their deepest
    // shared clade as the visible branch point. This is what lets a bird
    // such as House Sparrow terminate at Telluraves while a hornbill branch
    // continues deeper to Bucerotidae.
    const guessedClades = guessedPath.filter(node => node.level === "clade");
    const mysteryClades = mysteryPath.filter(node => node.level === "clade");

    let deepestSharedClade = null;

    for (const clade of guessedClades) {
        if (mysteryClades.some(node => node.id === clade.id)) {
            deepestSharedClade = clade;
        } else {
            break;
        }
    }

    // A shared ranked taxon takes precedence over a clade. For example,
    // two hornbills share Bucerotidae, so Afroaves should not replace it.
    if (deepestRanked.level !== "class") {
        return deepestRanked;
    }

    return deepestSharedClade || deepestRanked;
}


// ========================================
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

function getCommonCladeAnchor(birds) {
    if (!birds.length) {
        return {
            id: "class:Aves",
            level: "class",
            value: "Aves",
            depth: 0
        };
    }

    const paths = birds.map(getBirdPhylogenyPath);
    const firstClades = paths[0].filter(node => node.level === "clade");

    let deepest = {
        id: "class:Aves",
        level: "class",
        value: "Aves",
        depth: 0
    };

    for (const candidate of firstClades) {
        const sharedByAll = paths.every(path =>
            path.some(node => node.id === candidate.id)
        );

        if (sharedByAll) {
            deepest = candidate;
        } else {
            break;
        }
    }

    return deepest;
}

function getMysteryRevealTaxon() {
    let deepest = {
        id: "class:Aves",
        level: "class",
        value: "Aves",
        depth: 0
    };

    for (const guessedBird of gameState.guesses) {
        if (guessedBird.commonName === gameState.mysteryBird.commonName) {
            continue;
        }

        const shared = getDeepestSharedTaxon(
            guessedBird,
            gameState.mysteryBird
        );

        if (shared.depth > deepest.depth) {
            deepest = shared;
        }
    }

    return deepest;
}


function buildTreeModel() {
    const root = {
        type: "taxon",
        name: "Aves",
        taxonId: "class:Aves",
        level: "class",
        children: []
    };

    // At the start of a game, show only the root Aves node.
    // Do not reveal the mystery bird or any clade until the first guess.
    if (gameState.guesses.length === 0) {
        return root;
    }

    const activeBirds = [
        ...gameState.guesses.filter(
            bird => bird.commonName !== gameState.mysteryBird.commonName
        ),
        gameState.mysteryBird
    ];

    const commonAnchor = getCommonCladeAnchor(activeBirds);

    function findChild(parent, id) {
        return parent.children.find(
            child => child.type === "taxon" && child.taxonId === id
        );
    }

    function getEndpointPath(bird, endpoint) {
        const path = getBirdPhylogenyPath(bird);
        const endpointIndex = path.findIndex(node => node.id === endpoint.id);

        if (endpointIndex === -1) {
            return [endpoint];
        }

        return path.slice(0, endpointIndex + 1);
    }

    // A clade is shown when it is the common branching point
    // for the current tree. This matches the Metazooa-style behavior:
    // if one branch ends at the shared clade (e.g. House Sparrow at
    // Telluraves), that clade becomes the common parent of the other
    // deeper branch (e.g. Bucerotidae).
    const mysteryEndpointForTree = getMysteryRevealTaxon();

    const branchEndpoints = [
        ...gameState.guesses
            .filter(bird => bird.commonName !== gameState.mysteryBird.commonName)
            .map(bird => getDeepestSharedTaxon(bird, gameState.mysteryBird)),
        mysteryEndpointForTree
    ];

    const showCommonClade =
        commonAnchor.level !== "class" &&
        branchEndpoints.some(endpoint => endpoint.id === commonAnchor.id);

    function getDisplayPath(bird, endpoint) {
        const path = getBirdPhylogenyPath(bird);
        const endpointIndex = path.findIndex(node => node.id === endpoint.id);

        if (endpointIndex === -1) {
            return [path[0], endpoint];
        }

        // Keep the real hierarchy between the shared anchor and the
        // endpoint. The previous renderer jumped directly from Neornithes
        // to Aequornithes, for example, which incorrectly made Aequornithes
        // look like a sibling of Neoaves.
        //
        // Ranked endpoints show the ranked chain, while a clade endpoint
        // preserves the clade chain needed to show relationships such as:
        // Aves -> Neornithes -> Neoaves -> Aequornithes.
        const result = [path[0]];

        let anchorIndex = -1;

        if (showCommonClade) {
            anchorIndex = path.findIndex(
                node => node.id === commonAnchor.id
            );

            if (anchorIndex > 0) {
                result.push(commonAnchor);
            }
        }

        const startIndex = anchorIndex >= 0
            ? anchorIndex + 1
            : 1;

        for (let i = startIndex; i <= endpointIndex; i++) {
            const node = path[i];

            // When the endpoint is a ranked taxon, intermediate clades are
            // intentionally hidden unless the clade itself is the useful
            // visible endpoint. This preserves the existing "deeper ranked
            // taxon beats clade" behavior for cases such as hornbills.
            if (
                endpoint.level !== "clade" &&
                node.level === "clade"
            ) {
                continue;
            }

            if (!result.some(existing => existing.id === node.id)) {
                result.push(node);
            }
        }

        return result;
    }

    function insertBird(bird, endpoint, nodeType) {
        const mysteryRevealedAfterLoss =
            nodeType === "mystery" && gameState.gameStatus === "lost";

        const leaf = {
            type: "species",
            name: nodeType === "mystery" && !mysteryRevealedAfterLoss
                ? "???"
                : bird.commonName,
            nodeType: mysteryRevealedAfterLoss ? "revealed-lost" : nodeType,
            bird: nodeType === "mystery" && !mysteryRevealedAfterLoss
                ? null
                : bird
        };

        const displayPath = getDisplayPath(bird, endpoint);
        let parent = root;

        for (let i = 1; i < displayPath.length; i++) {
            const taxon = displayPath[i];

            let child = findChild(parent, taxon.id);

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

            parent = child;
        }

        parent.children.push(leaf);
    }

    // Guesses are placed at their deepest shared taxon.
    gameState.guesses.forEach(bird => {
        if (bird.commonName === gameState.mysteryBird.commonName) return;

        const endpoint = getDeepestSharedTaxon(
            bird,
            gameState.mysteryBird
        );

        insertBird(bird, endpoint, "guess");
    });

    const solved = gameState.guesses.some(
        bird => bird.commonName === gameState.mysteryBird.commonName
    );

    const mysteryEndpoint = getMysteryRevealTaxon();

    insertBird(
        gameState.mysteryBird,
        mysteryEndpoint,
        solved ? "correct" : "mystery"
    );

    // The mystery placeholder must not have a bird object while unsolved.
    if (!solved) {
        function removeMysteryBirdReference(node) {
            if (node.type === "species" && node.nodeType === "mystery") {
                node.bird = null;
                return;
            }

            if (node.children) {
                node.children.forEach(removeMysteryBirdReference);
            }
        }

        removeMysteryBirdReference(root);
    }

    return root;
}


// ========================================
// Metazooa-style tree renderer
// ========================================

function createTreeNodeElement(node) {
    const element = document.createElement("div");

    element.classList.add("meta-tree-node");

    if (node.type === "taxon") {
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
                if (
                    node.nodeType === "correct" ||
                    node.nodeType === "revealed-lost"
                ) {
                    showGameOverCard(
                        node.nodeType === "revealed-lost" ? "lost" : "won"
                    );
                    return;
                }

                showBirdInTaxonCard(node.bird);
            });
        }
    }

    return element;
}

async function showBirdInTaxonCard(bird) {
    const card = document.getElementById("taxon-card");
    if (!card || !bird) return;

    card.innerHTML = "<p>Loading bird information...</p>";

    const wikiTitle = bird.wikipediaTitle || bird.commonName;
    let wiki = null;
    let wikiDetails = {};

    try {
        const [summaryResponse, htmlResponse] = await Promise.all([
            fetch(
                "https://en.wikipedia.org/api/rest_v1/page/summary/" +
                encodeURIComponent(wikiTitle)
            ),
            fetch(
                "https://en.wikipedia.org/w/rest.php/v1/page/" +
                encodeURIComponent(wikiTitle) +
                "/html"
            )
        ]);

        if (summaryResponse.ok) {
            wiki = await summaryResponse.json();
        }

        if (htmlResponse.ok) {
            const html = await htmlResponse.text();
            wikiDetails = parseWikipediaBirdDetails(html);
        }
    } catch (error) {
        console.warn("Wikipedia bird details could not be loaded:", error);
    }

    renderBirdCard(bird, wiki, wikiDetails);
}

function cleanWikipediaText(value) {
    return (value || "")
        .replace(/\\[nrt]/g, " ")
        .replace(/\\s+/g, " ")
        .replace(/\\[[^\]]+\\]/g, "")
        .trim();
}

function parseWikipediaBirdDetails(html) {
    const details = {};
    if (!html) return details;

    const doc = new DOMParser().parseFromString(html, "text/html");

    // Wikipedia infobox labels vary between species, so accept common
    // spellings and both US/UK forms.
    const labelMap = {
        habitat: ["habitat", "habitats"],
        diet: ["diet", "food"],
        behavior: ["behavior", "behaviour", "activity"],
        breeding: ["breeding", "reproduction", "breeding season"],
        distribution: ["distribution", "range", "range map"],
        conservation: ["conservation status", "status", "iucn status"]
    };

    doc.querySelectorAll("table.infobox tr").forEach(row => {
        const label = row.querySelector("th");
        const value = row.querySelector("td");
        if (!label || !value) return;

        const key = cleanWikipediaText(label.textContent).toLowerCase();
        const text = cleanWikipediaText(value.textContent);
        if (!text) return;

        for (const [field, labels] of Object.entries(labelMap)) {
            if (labels.includes(key)) {
                details[field] = text;
                break;
            }
        }
    });

    // Some bird pages put useful information in sections instead of the
    // infobox. Only use these as fallbacks, never overwrite a real infobox.
    const sectionMap = {
        habitat: ["habitat"],
        diet: ["diet", "feeding", "food"],
        behavior: ["behavior", "behaviour"],
        breeding: ["breeding", "reproduction"],
        distribution: ["distribution", "range"]
    };

    doc.querySelectorAll("h2, h3").forEach(heading => {
        const headingText = cleanWikipediaText(heading.textContent)
            .replace(/\\[edit\\]/gi, "")
            .trim()
            .toLowerCase();

        const field = Object.entries(sectionMap).find(([, names]) =>
            names.includes(headingText)
        )?.[0];

        if (!field || details[field]) return;

        let text = "";
        let node = heading.nextElementSibling;
        while (node && !/^H[23]$/i.test(node.tagName)) {
            if (node.tagName === "P") {
                text += " " + cleanWikipediaText(node.textContent);
            }
            node = node.nextElementSibling;
        }

        if (text.trim()) {
            details[field] = text.trim().slice(0, 1200);
        }
    });

    return details;
}

function appendBirdDetail(card, label, value) {
    const heading = document.createElement("h4");
    heading.textContent = label;
    card.appendChild(heading);

    const text = document.createElement("p");
    text.textContent = value;
    card.appendChild(text);
}

function renderBirdCard(bird, wiki, wikiDetails = {}) {
    const card = document.getElementById("taxon-card");
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

    const taxonomyHeading = document.createElement("h4");
    taxonomyHeading.textContent = "Taxonomy";
    card.appendChild(taxonomyHeading);

    const taxonomyText = document.createElement("p");
    const taxonomyParts = [
        bird.class,
        ...((Array.isArray(bird.cladePath) && bird.cladePath.length)
            ? bird.cladePath
            : []),
        bird.order,
        bird.family,
        bird.genus,
        bird.species || bird.scientificName
    ].filter(Boolean);
    taxonomyText.textContent = taxonomyParts.join(" → ");
    card.appendChild(taxonomyText);

    if (wiki?.thumbnail?.source) {
        const image = document.createElement("img");
        image.className = "taxon-card-image";
        image.src = wiki.thumbnail.source;
        image.alt = bird.commonName;
        image.loading = "lazy";
        card.appendChild(image);
    }

    appendBirdDetail(
        card,
        "Description",
        wiki?.extract || "No external species summary is available."
    );

    const details = [
        ["Habitat", bird.habitat || wikiDetails.habitat],
        ["Diet", bird.diet || wikiDetails.diet],
        ["Behavior", bird.behavior || wikiDetails.behavior],
        ["Breeding", bird.breeding || wikiDetails.breeding],
        ["Distribution", bird.distribution || wikiDetails.distribution],
        ["Conservation", bird.conservation || wikiDetails.conservation]
    ];

    details.forEach(([label, value]) => {
        if (value) appendBirdDetail(card, label, value);
    });

    const shownFields = details.filter(([, value]) => Boolean(value)).length;
    if (shownFields === 0) {
        const note = document.createElement("p");
        note.className = "taxon-card-muted";
        note.textContent = "Detailed natural-history data is not available from the current sources.";
        card.appendChild(note);
    }

    if (wiki?.content_urls?.desktop?.page) {
        const link = document.createElement("a");
        link.href = wiki.content_urls.desktop.page;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = "Wikipedia";
        card.appendChild(link);
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

    gameState.selectedTaxonId = taxon.id;

    if (taxon.rank === "clade") {
        showCladeInTaxonCard(taxon);
    } else {
        renderTaxonCard(taxon);
    }
}

async function showCladeInTaxonCard(clade) {
    const card = document.getElementById("taxon-card");
    if (!card || !clade) return;

    card.innerHTML = "<p>Loading clade information...</p>";

    const wikiTitle = clade.wikipediaTitle || clade.name;
    let wiki = null;

    try {
        const response = await fetch(
            "https://en.wikipedia.org/api/rest_v1/page/summary/" +
            encodeURIComponent(wikiTitle)
        );

        if (response.ok) {
            wiki = await response.json();
        }
    } catch (error) {
        console.warn("Wikipedia information could not be loaded:", error);
    }

    renderCladeCard(clade, wiki);
}

function renderCladeCard(clade, wiki) {
    const card = document.getElementById("taxon-card");
    card.innerHTML = "";

    const title = document.createElement("h3");
    title.textContent = clade.name;
    card.appendChild(title);

    const rank = document.createElement("p");
    rank.classList.add("taxon-card-rank");
    rank.textContent = "CLADE";
    card.appendChild(rank);

    const description = document.createElement("p");
    description.textContent =
        wiki?.extract ||
        clade.description ||
        "No Wikipedia summary is available for this clade yet.";
    card.appendChild(description);

    if (wiki?.content_urls?.desktop?.page) {
        const link = document.createElement("a");
        link.href = wiki.content_urls.desktop.page;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = "Wikipedia";
        card.appendChild(link);
    }
}


function renderTaxonCard(taxon) {
    const card = document.getElementById("taxon-card");
    const info = gameState.taxonInfo?.[taxon.id] || {};
    const isClade = taxon.rank === "clade";

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
    description.textContent =
        info.description ||
        taxon.description ||
        (isClade ? "Phylogenetic clade information is not available yet." : "No information available for this taxon yet.");

    card.appendChild(title);
    card.appendChild(rank);
    if (info.commonName) card.appendChild(common);
    card.appendChild(description);

    if (Array.isArray(info.keyCharacteristics) && info.keyCharacteristics.length > 0) {
        const heading = document.createElement("h4");
        heading.textContent = "Key characteristics";
        card.appendChild(heading);

        const list = document.createElement("ul");
        info.keyCharacteristics.forEach(item => {
            const li = document.createElement("li");
            li.textContent = item;
            list.appendChild(li);
        });
        card.appendChild(list);
    }

    if (info.distributionHabitat) {
        const heading = document.createElement("h4");
        heading.textContent = "Distribution & habitat";
        card.appendChild(heading);

        const text = document.createElement("p");
        text.textContent = info.distributionHabitat;
        card.appendChild(text);
    }

    if (info.wikipedia) {
        const link = document.createElement("a");
        link.href = info.wikipedia;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = "Wikipedia";
        card.appendChild(link);
    }
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

    if (taxon.rank === "clade") {
        showCladeInTaxonCard(taxon);
    } else {
        renderTaxonCard(taxon);
    }
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
}

function renderTaxonomyTree() {
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

        element.style.left = x + "px";})}