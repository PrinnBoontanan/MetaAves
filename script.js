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
    gameStatus: "playing"
};

const guessCountElement = document.getElementById("guess-count");
const searchInput = document.getElementById("bird-search");
const guessButton = document.getElementById("guess-button");
const taxonomyTree = document.getElementById("taxonomy-tree");
const suggestions = document.getElementById("suggestions");

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
        const [birdResponse, taxonomyResponse, infoResponse, cladeResponse] = await Promise.all([
            fetch("data/birds.json"),
            fetch("data/taxonomy.json"),
            fetch("data/taxon_info.json"),
            fetch("data/clades.json")
        ]);

        if (!birdResponse.ok || !taxonomyResponse.ok || !infoResponse.ok || !cladeResponse.ok) {
            throw new Error("Could not load MetaAves data.");
        }

        gameState.birds = await birdResponse.json();
        gameState.taxonomy = await taxonomyResponse.json();
        gameState.taxonInfo = await infoResponse.json();
        gameState.clades = await cladeResponse.json();

        // Temporary mystery for testing.
        gameState.mysteryBird = gameState.birds.find(
            bird => bird.commonName === "Oriental Pied Hornbill"
        );

        updateGuessCounter();
        renderTaxonomyTree();
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
// Find deepest shared taxon
// ========================================

function getBirdPhylogenyPath(bird) {
    if (!bird) return [];

    const path = [
        { id: "class:Aves", level: "class", value: "Aves", depth: 0 }
    ];

    const cladePath = Array.isArray(bird.cladePath)
        ? bird.cladePath
        : [];

    cladePath.forEach((cladeName, index) => {
        const clade = Object.values(gameState.clades || {}).find(
            entry => entry.rank === "clade" && entry.name === cladeName
        );

        if (clade) {
            path.push({
                id: clade.id,
                level: "clade",
                value: clade.name,
                depth: path.length
            });
        }
    });

    taxonomyLevels.forEach(level => {
        if (bird[level]) {
            const id = level === "class"
                ? "class:Aves"
                : `${level}:${bird[level]}`;

            if (!path.some(node => node.id === id)) {
                path.push({
                    id,
                    level,
                    value: bird[level],
                    depth: path.length
                });
            }
        }
    });

    return path;
}

function getDeepestSharedTaxon(guessedBird, mysteryBird) {
    const guessedPath = getBirdPhylogenyPath(guessedBird);
    const mysteryPath = getBirdPhylogenyPath(mysteryBird);

    let deepest = mysteryPath[0] || {
        id: "class:Aves",
        level: "class",
        value: "Aves",
        depth: 0
    };

    const limit = Math.min(guessedPath.length, mysteryPath.length);

    for (let i = 0; i < limit; i++) {
        if (guessedPath[i].id !== mysteryPath[i].id) {
            break;
        }
        deepest = mysteryPath[i];
    }

    return deepest;
}


// ========================================
// Get where the mystery belongs
// ========================================

function getMysteryRevealTaxon() {
    let deepest = {
        level: "class",
        value: "Aves",
        depth: 0
    };

    for (const guessedBird of gameState.guesses) {
        if (
            guessedBird.commonName ===
            gameState.mysteryBird.commonName
        ) {
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
    renderTaxonomyTree();
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

function buildTreeModel() {
    const root = {
        type: "taxon",
        name: "Aves",
        taxonId: "class:Aves",
        level: "class",
        children: []
    };

    // Before the first guess, reveal only the root Aves node.
    // The mystery bird must stay completely hidden until the player
    // makes a valid guess.
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

    function getDisplayPath(bird, endpoint) {
        const path = getEndpointPath(bird, endpoint);

        // The game intentionally hides intermediate ranked taxa.
        // Keep only Aves, the common clade anchor, and the deepest
        // shared taxon revealed for this bird.
        const result = [path[0]];

        if (commonAnchor.level !== "class") {
            result.push(commonAnchor);
        }

        if (endpoint.level !== "class" && endpoint.id !== commonAnchor.id) {
            result.push(endpoint);
        }

        return result;
    }

    function insertBird(bird, endpoint, nodeType) {
        const leaf = {
            type: "species",
            name: bird.commonName,
            nodeType,
            bird: nodeType === "correct" ? bird : bird
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

        // Guessed / solved species can be opened in the taxon card.
        if (node.bird) {
            element.classList.add("meta-species-clickable");
            element.style.pointerEvents = "auto";

            element.addEventListener("click", () => {
                // The solved mystery species reopens the full Bird Study Card.
                // Other species continue to open the lightweight Taxon Info card.
                if (node.nodeType === "correct") {
                    showGameOverCard("won");
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


function renderTaxonomyTree() {
    taxonomyTree.innerHTML = "";

    if (!gameState.mysteryBird) {
        return;
    }

    // Aves is always visible from the start.
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