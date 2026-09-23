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
        const [birdResponse, taxonomyResponse, infoResponse] = await Promise.all([
            fetch("data/birds.json"),
            fetch("data/taxonomy.json"),
            fetch("data/taxon_info.json")
        ]);

        if (!birdResponse.ok || !taxonomyResponse.ok || !infoResponse.ok) {
            throw new Error("Could not load MetaAves data.");
        }

        gameState.birds = await birdResponse.json();
        gameState.taxonomy = await taxonomyResponse.json();
        gameState.taxonInfo = await infoResponse.json();

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

function getDeepestSharedTaxon(guessedBird, mysteryBird) {
    let deepest = {
        level: "class",
        value: "Aves",
        depth: 0
    };

    for (let i = 0; i < taxonomyLevels.length; i++) {
        const level = taxonomyLevels[i];

        if (guessedBird[level] !== mysteryBird[level]) {
            break;
        }

        deepest = {
            level,
            value: guessedBird[level],
            depth: i + 1
        };
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

    updateGuessCounter();
    renderTaxonomyTree();
    updateAutomaticTaxonCard();

    searchInput.value = "";
    suggestions.innerHTML = "";

    if (gameState.gameStatus === "won") {
        showGameOverCard("won");
    } else if (gameState.gameStatus === "lost") {
        showGameOverCard("lost");
    }
}


// ========================================
// Build the logical tree
// ========================================

function buildTreeModel() {
    const root = {
        type: "taxon",
        name: "Aves",
        taxonId: "class:Aves",
        level: "class",
        children: []
    };

    function findTaxon(name) {
        return root.children.find(
            child =>
                child.type === "taxon" &&
                child.name === name
        );
    }

    function addBird(bird, nodeType) {
        const sharedTaxon = getDeepestSharedTaxon(
            bird,
            gameState.mysteryBird
        );

        const leaf = {
            type: "species",
            name: bird.commonName,
            nodeType
        };

        if (sharedTaxon.level === "class") {
            root.children.push(leaf);
            return;
        }

        let taxon = findTaxon(sharedTaxon.value);

        if (!taxon) {
            taxon = {
                type: "taxon",
                name: sharedTaxon.value,
                taxonId: `${sharedTaxon.level}:${sharedTaxon.value}`,
                level: sharedTaxon.level,
                children: []
            };

            root.children.push(taxon);
        }

        taxon.children.push(leaf);
    }

    // Guessed birds create the visible branches.
    gameState.guesses.forEach(bird => {
        if (bird.commonName !== gameState.mysteryBird.commonName) {
            addBird(bird, "guess");
        }
    });

    // The mystery is always exactly one leaf.
    const solved = gameState.guesses.some(
        bird =>
            bird.commonName ===
            gameState.mysteryBird.commonName
    );

    const revealTaxon = getMysteryRevealTaxon();

    const mysteryLeaf = {
        type: "species",
        name: solved
            ? gameState.mysteryBird.commonName
            : "???",
        nodeType: solved ? "correct" : "mystery"
    };

    if (revealTaxon.level === "class") {
        root.children.push(mysteryLeaf);
    } else {
        const taxon = findTaxon(revealTaxon.value);

        if (taxon) {
            taxon.children.push(mysteryLeaf);
        }
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
    }

    return element;
}

function selectTaxon(node) {
    if (node.type !== "taxon" || !gameState.taxonomy) return;

    const taxon = Object.values(gameState.taxonomy).find(
        entry => entry.id === node.taxonId
    );

    if (!taxon) return;

    gameState.selectedTaxonId = taxon.id;
    renderTaxonCard(taxon);
}

function renderTaxonCard(taxon) {
    const card = document.getElementById("taxon-card");
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
    description.textContent = info.description || "No information available for this taxon yet.";

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
    if (!gameState.mysteryBird) return null;

    // Before any guess, the broadest useful taxon is Aves.
    if (gameState.guesses.length === 0) {
        return gameState.taxonomy?.["class:Aves"] || null;
    }

    // After guesses, show the deepest shared taxon currently revealed
    // by the guesses. This matches the information the tree has actually
    // learned about the mystery bird.
    const reveal = getMysteryRevealTaxon();
    const id = `${reveal.level}:${reveal.value}`;

    return gameState.taxonomy?.[id]
        || gameState.taxonomy?.["class:Aves"]
        || null;
}

function updateAutomaticTaxonCard() {
    const taxon = getMostUsefulTaxon();
    if (!taxon) return;

    gameState.selectedTaxonId = taxon.id;
    renderTaxonCard(taxon);
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
    canvas.appendChild(nodeLayer);
    taxonomyTree.appendChild(canvas);

    // Give every level enough room to resemble the
    // loose, organic Metazooa tree.
    const levelGap = 92;
    const horizontalGap = 150;
    const sidePadding = 70;

    const positions = [];
    let leafIndex = 0;

    function measureNode(node) {
        const element = createTreeNodeElement(node);
        nodeLayer.appendChild(element);

        const width = Math.max(
            element.offsetWidth,
            node.type === "taxon" ? 78 : 74
        );

        element.remove();
        return width;
    }

    function layout(node, depth) {
        if (node.type === "species") {
            const width = measureNode(node);
            const x = sidePadding + leafIndex * horizontalGap;
            leafIndex++;
            positions.push({
                node,
                depth,
                x,
                width
            });
            return x;
        }

        const width = measureNode(node);

        if (node.children.length === 0) {
            const x = sidePadding + leafIndex * horizontalGap;
            leafIndex++;
            positions.push({
                node,
                depth,
                x,
                width
            });
            return x;
        }

        const childXs = node.children.map(
            child => layout(child, depth + 1)
        );

        const x =
            (childXs[0] + childXs[childXs.length - 1]) / 2;

        positions.push({
            node,
            depth,
            x,
            width
        });

        return x;
    }

    layout(model, 0);

    const maxDepth = Math.max(
        ...positions.map(position => position.depth)
    );

    const minimumTreeWidth =
        sidePadding * 2 +
        Math.max(0, leafIndex - 1) * horizontalGap;

    const canvasWidth = Math.max(
        taxonomyTree.clientWidth - 20,
        minimumTreeWidth
    );

    // Center the whole tree inside the available area.
    // The layout starts with a fixed left padding, so shift every
    // node equally after we know the actual canvas width.
    const centerShift = Math.max(
        0,
        (canvasWidth - minimumTreeWidth) / 2
    );

    positions.forEach(position => {
        position.x += centerShift;
    });

    const canvasHeight =
        50 + (maxDepth + 1) * levelGap;

    canvas.style.width = `${canvasWidth}px`;
    canvas.style.height = `${canvasHeight}px`;
    svg.setAttribute("width", canvasWidth);
    svg.setAttribute("height", canvasHeight);
    svg.setAttribute("viewBox", `0 0 ${canvasWidth} ${canvasHeight}`);

    const positioned = new Map();

    positions.forEach(position => {
        const element = createTreeNodeElement(position.node);

        const nodeHeight = element.offsetHeight || 34;
        const x = position.x - position.width / 2;
        const y =
            24 +
            position.depth * levelGap -
            nodeHeight / 2;

        element.style.left = `${x}px`;
        element.style.top = `${y}px`;

        // The tree grows one generation at a time.
        // A node must finish appearing before the branches
        // leading to the next generation are allowed to grow.
        //
        // Depth 0 = Aves
        // Depth 1 = Bucerotidae / House Sparrow
        // Depth 2 = Great Hornbill / ???
        const generationDuration = 0.95;
        const nodeRevealDuration = 0.32;
        const nodeDelay = position.depth * generationDuration;

        element.style.setProperty(
            "--node-delay",
            `${nodeDelay}s`
        );

        nodeLayer.appendChild(element);

        positioned.set(position.node, {
            x: position.x,
            y: y + nodeHeight / 2,
            width: position.width,
            height: nodeHeight,
            depth: position.depth,
            element
        });
    });

    function drawConnections(node) {
        if (node.type !== "taxon") {
            return;
        }

        const parent = positioned.get(node);

        node.children.forEach(child => {
            const childPosition = positioned.get(child);

            if (!parent || !childPosition) {
                return;
            }

            const startX = parent.x;
            const startY = parent.y + parent.height / 2 - 1;
            const endX = childPosition.x;
            const endY = childPosition.y - childPosition.height / 2 + 1;

            const curve = Math.max(
                30,
                Math.abs(endY - startY) * 0.55
            );

            const path = document.createElementNS(
                "http://www.w3.org/2000/svg",
                "path"
            );

            path.setAttribute(
                "d",
                `M ${startX} ${startY}
                 C ${startX} ${startY + curve},
                   ${endX} ${endY - curve},
                   ${endX} ${endY}`
            );

            path.classList.add("meta-tree-connection");

            // Draw the branch progressively instead of making it
            // appear instantly.
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

            // Grow the tree strictly from top to bottom.
            //
            // A branch leading to depth 1 starts after Aves has
            // appeared. A branch leading to depth 2 waits until
            // the depth-1 taxon/species nodes have appeared.
            //
            // This prevents all branches from growing together.
            const parentDepth = positioned.get(node).depth;
            const generationDuration = 0.95;
            const nodeRevealDuration = 0.32;

            // A branch starts only after its parent node has finished
            // appearing. This makes the growth happen generation by
            // generation from the top of the tree.
            const animationDelay =
                parentDepth * generationDuration +
                nodeRevealDuration;

            // Start each branch explicitly. This prevents the browser
            // from starting every SVG animation when the tree is rendered.
            setTimeout(() => {
                path.classList.add("active");
            }, animationDelay * 1000);

            drawConnections(child);
        });
    }

    drawConnections(model);
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
    const title = document.getElementById("game-over-title");
    const message = document.getElementById("game-over-message");
    const birdName = document.getElementById("study-bird-name");
    const scientificName = document.getElementById("study-scientific-name");
    const thaiName = document.getElementById("study-thai-name");
    const taxonomy = document.getElementById("study-taxonomy");

    const bird = gameState.mysteryBird;
    if (!overlay || !bird) return;

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
    taxonomy.textContent = getBirdTaxonomyText(bird);

    overlay.classList.add("visible");
}

function closeGameOverCard() {
    const overlay = document.getElementById("game-over-overlay");
    if (overlay) {
        overlay.classList.remove("visible");
    }
}

function replayGame() {
    closeGameOverCard();

    gameState.guessesRemaining = gameState.maxGuesses;
    gameState.guesses = [];
    gameState.selectedTaxonId = null;
    gameState.gameStatus = "playing";

    // Temporary mystery selection until the full game
    // uses a randomized bird dataset.
    gameState.mysteryBird = gameState.birds.find(
        bird => bird.commonName === "Oriental Pied Hornbill"
    );

    searchInput.value = "";
    suggestions.innerHTML = "";

    updateGuessCounter();
    renderTaxonomyTree();
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


// ========================================
// Start game
// ========================================

async function startGame() {
    updateGuessCounter();
    await loadGameData();
}

startGame();
