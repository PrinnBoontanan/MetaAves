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
            cladeResponse,
            cladeMembershipResponse
        ] = await Promise.all([
            fetch("data/birds.generated.json"),
            fetch("data/taxonomy.generated.json"),
            fetch("data/taxon_info.json"),
            fetch("data/clades.json"),
            fetch("data/clade_membership.generated.json")
        ]);

        if (
            !birdResponse.ok ||
            !taxonomyResponse.ok ||
            !infoResponse.ok ||
            !cladeResponse.ok ||
            !cladeMembershipResponse.ok
        ) {
            throw new Error("Could not load MetaAves data.");
        }

        gameState.birds = await birdResponse.json();
        gameState.taxonomy = await taxonomyResponse.json();
        gameState.taxonInfo = await infoResponse.json();
        gameState.clades = await cladeResponse.json();

        const cladeMembership = await cladeMembershipResponse.json();
        const membershipBySpecies = cladeMembership.species || {};

        // Join the generated clade layer to the generated bird records.
        // The scientific name is the stable species key produced by AviList.
        gameState.birds.forEach(bird => {
            bird.cladePath = membershipBySpecies[bird.scientificName] || [];
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

    const clades = Array.isArray(bird.cladePath)
        ? bird.cladePath.map(name => cladeByName.get(name)).filter(Boolean)
        : [];

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
    const root = {
        type: "taxon",
        name: "Aves",
        taxonId: "class:Aves",
        level: "class",
        children: []
    };

    if (gameState.guesses.length === 0) return root;

    const solved = gameState.guesses.some(
        bird => bird.commonName === gameState.mysteryBird.commonName
    );

    const entries = [];

    for (const bird of gameState.guesses) {
        if (bird.commonName === gameState.mysteryBird.commonName) continue;

        entries.push({
            bird,
            endpoint: getDeepestSharedTaxon(
                bird,
                gameState.mysteryBird
            ),
            nodeType: "guess"
        });
    }

    entries.push({
        bird: gameState.mysteryBird,
        endpoint: getMysteryRevealTaxon(),
        nodeType: solved ? "correct" : "mystery"
    });

    const pathByBird = new Map();
    for (const entry of entries) {
        pathByBird.set(
            entry.bird.commonName,
            getBirdPhylogenyPath(entry.bird)
        );
    }

    const endpointIds = new Set(
        entries.map(entry => entry.endpoint.id)
    );
    const visibleIds = new Set(["class:Aves"]);

    // Endpoints are always visible.
    endpointIds.forEach(id => visibleIds.add(id));

    // Add only the lowest common ancestors needed to connect different
    // endpoint branches. This prevents the old "show every taxon" behavior.
    const endpointPaths = entries.map(entry => {
        const path = pathByBird.get(entry.bird.commonName) || [];
        const index = path.findIndex(
            node => node.id === entry.endpoint.id
        );
        return index >= 0 ? path.slice(0, index + 1) : [];
    }).filter(path => path.length);

    for (let i = 0; i < endpointPaths.length; i++) {
        for (let j = i + 1; j < endpointPaths.length; j++) {
            const left = endpointPaths[i];
            const right = endpointPaths[j];
            const limit = Math.min(left.length, right.length);

            for (let k = limit - 1; k >= 0; k--) {
                if (left[k].id === right[k].id) {
                    visibleIds.add(left[k].id);
                    break;
                }
            }
        }
    }

    function findTaxonChild(parent, id) {
        return parent.children.find(
            child => child.type === "taxon" && child.taxonId === id
        );
    }

    function insertEntry(entry) {
        const path = pathByBird.get(entry.bird.commonName) || [];
        const endpointIndex = path.findIndex(
            node => node.id === entry.endpoint.id
        );

        if (endpointIndex < 0) return;

        let parent = root;

        // Only insert visible nodes. Therefore:
        //   same endpoint -> same node -> multiple leaves
        //   nested endpoints -> endpoint becomes child of endpoint
        //   separate endpoints -> only their required LCA is shown
        for (let i = 1; i <= endpointIndex; i++) {
            const taxon = path[i];

            if (!visibleIds.has(taxon.id)) continue;

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

            parent = child;
        }

        const hidden =
            entry.nodeType === "mystery" &&
            gameState.gameStatus !== "lost";

        parent.children.push({
            type: "species",
            name: hidden ? "???" : entry.bird.commonName,
            nodeType: hidden ? "mystery" : entry.nodeType,
            bird: hidden ? null : entry.bird
        });
    }

    entries.forEach(insertEntry);

    return root;
}

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

    renderBirdCard(bird, wiki);
}

function renderBirdCard(bird, wiki) {
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

    const description = document.createElement("p");
    description.textContent =
        wiki?.extract ||
        "No Wikipedia summary is available for this species yet.";
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

function showGameOverCard(result) {
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

    // Reset only the dynamic sections from any previous game.
    // Keep the permanent Thai name and taxonomy fields.
    const details = document.querySelector(".study-card-details");
    if (details) {
        details.querySelectorAll(".study-card-section").forEach(section => {
            section.remove();
        });
    }

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
    thaiName.textContent =
        bird.thaiName || "No established Thai name found.";
    taxonomy.innerHTML = "";

    const taxonomyRows = [
        ["Class", bird.class],
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

    const addStudySection = (heading, value) => {
        if (!details || !value) return;

        const section = document.createElement("div");
        section.className = "study-card-section";

        const title = document.createElement("h4");
        title.textContent = heading;

        const text = document.createElement("p");
        text.textContent = value;

        section.appendChild(title);
        section.appendChild(text);
        details.appendChild(section);
    };

    const unavailable =
        "Detailed information is not available in the current dataset.";

    addStudySection(
        "Description",
        bird.description || "Fetching the species description from Wikipedia…"
    );
    addStudySection("Habitat", bird.habitat || unavailable);
    addStudySection("Distribution", bird.distribution || unavailable);
    addStudySection("Diet", bird.diet || unavailable);
    addStudySection("Behavior", bird.behavior || unavailable);
    addStudySection("Breeding", bird.breeding || unavailable);
    addStudySection("Conservation", bird.conservation || unavailable);

    if (Array.isArray(bird.interestingFacts) && bird.interestingFacts.length) {
        const section = document.createElement("div");
        section.className = "study-card-section";

        const title = document.createElement("h4");
        title.textContent = "Interesting facts";

        const list = document.createElement("ul");
        bird.interestingFacts.forEach(fact => {
            const item = document.createElement("li");
            item.textContent = fact;
            list.appendChild(item);
        });

        section.appendChild(title);
        section.appendChild(list);
        details.appendChild(section);
    }

    const studyImage = document.getElementById("study-bird-image");
    const studyDescription = document.getElementById("study-bird-description");
    if (studyImage) studyImage.remove();
    if (studyDescription) studyDescription.remove();

    fetch(
        "https://en.wikipedia.org/api/rest_v1/page/summary/" +
        encodeURIComponent(bird.wikipediaTitle || bird.commonName)
    )
        .then(response => response.ok ? response.json() : null)
        .then(wiki => {
            if (!wiki) return;

            const imageSource = wiki.thumbnail?.source;

            const image = imageSource
                ? document.createElement("img")
                : null;

            if (image) {
                image.id = "study-bird-image";
                image.className = "study-card-image";
                image.src = imageSource;
                image.alt = bird.commonName;
            }

            const description = document.createElement("p");
            description.id = "study-bird-description";
            description.textContent = wiki.extract || "";

            const details = document.querySelector(".study-card-details");
            if (details) {
                if (image) {
                    image.classList.add("study-card-hero-image");
                    const existingImage = details.parentElement?.querySelector(
                        ".study-card-hero-image"
                    );
                    if (!existingImage) {
                        details.before(image);
                    }
                }

                // Use the Wikipedia introduction to replace the temporary
                // description when the dataset does not contain one.
                if (!bird.description && wiki.extract && details) {
                    const descriptionSection = [...details.querySelectorAll(".study-card-section")]
                        .find(section =>
                            section.querySelector("h4")?.textContent === "Description"
                        );

                    const descriptionParagraph =
                        descriptionSection?.querySelector("p");

                    if (descriptionParagraph) {
                        descriptionParagraph.textContent = wiki.extract;
                    }
                }

                if (wiki.content_urls?.desktop?.page) {
                    const wikiSection = document.createElement("div");
                    wikiSection.className = "study-card-section";

                    const wikiLink = document.createElement("a");
                    wikiLink.href = wiki.content_urls.desktop.page;
                    wikiLink.target = "_blank";
                    wikiLink.rel = "noopener noreferrer";
                    wikiLink.textContent = "Wikipedia →";

                    wikiSection.appendChild(wikiLink);
                    details.appendChild(wikiSection);
                }
            }
        })
        .catch(() => {});

    overlay.classList.add("visible");

    // The main-menu New Game button only appears once the current
    // game has ended. It remains available after the study card is closed.
    if (newGameButton) {
        newGameButton.classList.add("visible");
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
    if (event.key === "Enter") {
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
