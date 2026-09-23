// ========================================
// MetaAves - Game State
// ========================================

const gameState = {
    mode: "world",
    maxGuesses: 12,
    guessesRemaining: 12,
    birds: [],
    mysteryBird: null,
    guesses: []
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

async function loadBirdData() {
    try {
        const response = await fetch("data/birds.json");

        if (!response.ok) {
            throw new Error("Could not load bird database.");
        }

        gameState.birds = await response.json();

        // Temporary mystery for testing.
        gameState.mysteryBird = gameState.birds.find(
            bird => bird.commonName === "Oriental Pied Hornbill"
        );

        updateGuessCounter();
        renderTaxonomyTree();

        console.log("Bird database loaded:", gameState.birds);
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

    if (input === "" || gameState.guessesRemaining <= 0) {
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

    updateGuessCounter();
    renderTaxonomyTree();

    searchInput.value = "";
    suggestions.innerHTML = "";

    if (bird.commonName === gameState.mysteryBird.commonName) {
        console.log("Correct!");
    }
}


// ========================================
// Build the logical tree
// ========================================

function buildTreeModel() {
    const root = {
        type: "taxon",
        name: "Aves",
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
        element.dataset.level = node.level;
        element.textContent = node.name;
    } else {
        element.classList.add("meta-species-node");
        element.classList.add(`meta-species-${node.nodeType}`);
        element.textContent = node.name;
    }

    return element;
}

function renderTaxonomyTree() {
    taxonomyTree.innerHTML = "";

    if (!gameState.mysteryBird) {
        return;
    }

    if (gameState.guesses.length === 0) {
        const placeholder = document.createElement("div");
        placeholder.classList.add("tree-placeholder");
        placeholder.textContent = "Your guesses will appear here.";
        taxonomyTree.appendChild(placeholder);
        return;
    }

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

        nodeLayer.appendChild(element);

        positioned.set(position.node, {
            x: position.x,
            y: y + nodeHeight / 2,
            width: position.width,
            height: nodeHeight,
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

            if (child.type === "taxon") {
                path.classList.add("meta-connection-taxon");
            } else {
                path.classList.add("meta-connection-species");
            }

            svg.appendChild(path);

            // Deeper branches start shortly after their parent branch.
            const animationDelay = child.type === "taxon"
                ? child.children.length * 0.04
                : 0.12;

            path.style.animationDelay = `${animationDelay}s`;

            drawConnections(child);
        });
    }

    drawConnections(model);
}


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
    await loadBirdData();
}

startGame();
