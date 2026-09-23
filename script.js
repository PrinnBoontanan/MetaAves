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


// ========================================
// HTML elements
// ========================================

const guessCountElement = document.getElementById("guess-count");
const searchInput = document.getElementById("bird-search");
const guessButton = document.getElementById("guess-button");
const taxonomyTree = document.getElementById("taxonomy-tree");
const suggestions = document.getElementById("suggestions");


// ========================================
// Temporary taxonomy
// ========================================
//
// Aves is the root.
// Later this will become the full taxonomy,
// including clades, infraclasses, etc.
//

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
        // We will randomize this later.
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
// Find bird
// ========================================

function findBirdByName(name) {
    return gameState.birds.find(
        bird =>
            bird.commonName.toLowerCase() ===
            name.toLowerCase()
    );
}


// ========================================
// Duplicate check
// ========================================

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
        const matchesSearch =
            bird.commonName.toLowerCase().includes(search);

        return matchesSearch && !hasAlreadyBeenGuessed(bird);
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
//
// Great Hornbill vs Oriental Pied Hornbill:
//
// Aves
// Bucerotiformes
// Bucerotidae  <- deepest shared taxon
//
// The displayed tree therefore starts:
//
// Aves
//  └── Bucerotidae
//
// We intentionally do not display every
// shared taxon on the way down.
//

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
            level: level,
            value: guessedBird[level],
            depth: i + 1
        };
    }

    return deepest;
}


// ========================================
// Get the deepest revealed taxon
// ========================================
//
// This is used to decide where the ONE
// mystery marker belongs.
//
// Example:
// Great Hornbill -> Bucerotidae
// House Sparrow -> Aves
//
// The mystery belongs under Bucerotidae,
// because that is the most specific clue
// revealed so far.
//

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

    if (input === "") {
        return;
    }

    if (gameState.guessesRemaining <= 0) {
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

    if (
        bird.commonName ===
        gameState.mysteryBird.commonName
    ) {
        console.log("Correct!");
    }
}


// ========================================
// Create taxon node
// ========================================

function createTaxonNode(name) {
    const node = document.createElement("div");

    node.classList.add("taxon-node");
    node.textContent = name;

    return node;
}


// ========================================
// Create species node
// ========================================

function createSpeciesNode(name, type) {
    const node = document.createElement("div");

    node.classList.add("species-node");

    if (type === "guess") {
        node.classList.add("guessed-species");
    }

    if (type === "mystery") {
        node.classList.add("mystery-species");
    }

    if (type === "correct") {
        node.classList.add("correct-species");
    }

    node.textContent = name;

    return node;
}


// ========================================
// Create branch container
// ========================================

function createBranchContainer() {
    const container = document.createElement("div");
    container.classList.add("tree-branch");
    return container;
}


// ========================================
// Add one guess
// ========================================
//
// IMPORTANT:
// A guess only creates its own species leaf.
// The mystery marker is added separately once
// after the whole tree has been built.
//

function addGuessToTree(rootContainer, guessedBird) {
    if (
        guessedBird.commonName ===
        gameState.mysteryBird.commonName
    ) {
        const correctSpecies = createSpeciesNode(
            guessedBird.commonName,
            "correct"
        );

        rootContainer.appendChild(correctSpecies);
        return;
    }

    const sharedTaxon = getDeepestSharedTaxon(
        guessedBird,
        gameState.mysteryBird
    );

    if (sharedTaxon.level === "class") {
        addSpeciesToContainer(rootContainer, guessedBird);
        return;
    }

    let taxonNode = [...rootContainer.children].find(
        child =>
            child.classList.contains("taxon-node") &&
            child.dataset.taxon === sharedTaxon.value
    );

    if (!taxonNode) {
        taxonNode = createTaxonNode(sharedTaxon.value);
        taxonNode.dataset.taxon = sharedTaxon.value;

        const branchContainer = createBranchContainer();
        taxonNode.appendChild(branchContainer);

        rootContainer.appendChild(taxonNode);
    }

    const branchContainer = taxonNode.querySelector(
        ":scope > .tree-branch"
    );

    addSpeciesToContainer(branchContainer, guessedBird);
}


// ========================================
// Add guessed species
// ========================================

function addSpeciesToContainer(container, guessedBird) {
    const existing = [...container.children].find(
        child =>
            child.classList.contains("species-node") &&
            child.dataset.species === guessedBird.commonName
    );

    if (existing) {
        return;
    }

    const species = createSpeciesNode(
        guessedBird.commonName,
        "guess"
    );

    species.dataset.species = guessedBird.commonName;
    container.appendChild(species);
}


// ========================================
// Add the ONE mystery marker
// ========================================

function addMysteryMarker(rootContainer) {
    if (!gameState.mysteryBird || gameState.guesses.length === 0) {
        return;
    }

    const revealTaxon = getMysteryRevealTaxon();

    if (revealTaxon.level === "class") {
        addMysterySpeciesToContainer(rootContainer);
        return;
    }

    const taxonNode = [...rootContainer.children].find(
        child =>
            child.classList.contains("taxon-node") &&
            child.dataset.taxon === revealTaxon.value
    );

    if (!taxonNode) {
        return;
    }

    const branchContainer = taxonNode.querySelector(
        ":scope > .tree-branch"
    );

    addMysterySpeciesToContainer(branchContainer);
}


// ========================================
// Add mystery species
// ========================================

function addMysterySpeciesToContainer(container) {
    const existing = container.querySelector(
        ":scope > .mystery-species"
    );

    if (existing) {
        return;
    }

    const mystery = createSpeciesNode(
        "???",
        "mystery"
    );

    container.appendChild(mystery);
}


// ========================================
// Render complete tree
// ========================================

function renderTaxonomyTree() {
    taxonomyTree.innerHTML = "";

    if (!gameState.mysteryBird) {
        return;
    }

    if (gameState.guesses.length === 0) {
        const placeholder = document.createElement("div");

        placeholder.classList.add("tree-placeholder");
        placeholder.textContent =
            "Your guesses will appear here.";

        taxonomyTree.appendChild(placeholder);
        return;
    }

    const root = createTaxonNode("Aves");
    root.classList.add("tree-root-node");

    const rootContainer = createBranchContainer();

    root.appendChild(rootContainer);
    taxonomyTree.appendChild(root);

    // First build all guessed species.
    gameState.guesses.forEach(guessedBird => {
        addGuessToTree(rootContainer, guessedBird);
    });

    // Then place the single mystery marker.
    addMysteryMarker(rootContainer);
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
