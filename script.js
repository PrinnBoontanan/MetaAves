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
// Get HTML elements
// ========================================

const guessCountElement =
    document.getElementById("guess-count");

const searchInput =
    document.getElementById("bird-search");

const guessButton =
    document.getElementById("guess-button");

const taxonomyTree =
    document.getElementById("taxonomy-tree");

const suggestions =
    document.getElementById("suggestions");


// ========================================
// Temporary taxonomy levels
// ========================================
//
// Aves is the root.
//
// Later we will replace this with the REAL
// full taxonomy including clades, infraclass,
// suborder, etc.
// ========================================

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

        const response =
            await fetch("data/birds.json");

        if (!response.ok) {
            throw new Error(
                "Could not load bird database."
            );
        }

        gameState.birds =
            await response.json();


        // Temporary mystery bird
        //
        // Later this will be randomly selected.
        gameState.mysteryBird =
            gameState.birds.find(
                bird =>
                    bird.commonName ===
                    "Oriental Pied Hornbill"
            );


        updateGuessCounter();

        renderTaxonomyTree();


        console.log(
            "Bird database loaded:",
            gameState.birds
        );

        console.log(
            "Mystery bird:",
            gameState.mysteryBird
        );

    } catch (error) {

        console.error(
            "Error loading bird database:",
            error
        );

    }

}


// ========================================
// Update guess counter
// ========================================

function updateGuessCounter() {

    guessCountElement.textContent =
        gameState.guessesRemaining;

}


// ========================================
// Find bird by common name
// ========================================

function findBirdByName(name) {

    return gameState.birds.find(
        bird =>
            bird.commonName.toLowerCase() ===
            name.toLowerCase()
    );

}


// ========================================
// Check duplicate guess
// ========================================

function hasAlreadyBeenGuessed(bird) {

    return gameState.guesses.some(
        guessedBird =>
            guessedBird.commonName ===
            bird.commonName
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


    const search =
        searchText.toLowerCase();


    const matches =
        gameState.birds.filter(bird => {

            const matchesSearch =
                bird.commonName
                    .toLowerCase()
                    .includes(search);


            const alreadyGuessed =
                hasAlreadyBeenGuessed(bird);


            return (
                matchesSearch &&
                !alreadyGuessed
            );

        });


    matches.forEach(bird => {

        const suggestion =
            document.createElement("div");


        suggestion.classList.add(
            "suggestion"
        );


        // Only show English common name
        suggestion.textContent =
            bird.commonName;


        suggestion.addEventListener(
            "click",
            function () {

                searchInput.value =
                    bird.commonName;

                suggestions.innerHTML = "";

                searchInput.focus();

            }
        );


        suggestions.appendChild(
            suggestion
        );

    });

}


// ========================================
// Find deepest shared taxon
// ========================================
//
// Example:
//
// Great Hornbill
//       vs
// Oriental Pied Hornbill
//
// Shared:
//
// Aves
// Bucerotiformes
// Bucerotidae
//
// Deepest shared taxon:
// Bucerotidae
//
// Therefore:
//
// Aves
//  └── Bucerotidae
//       ├── Great Hornbill
//       └── ???
//
// Bucerotiformes is NOT displayed.
//
// ========================================

function getDeepestSharedTaxon(
    guessedBird,
    mysteryBird
) {

    let deepestSharedTaxon = {

        level: "class",

        value: "Aves"

    };


    for (
        const level of taxonomyLevels
    ) {

        if (
            guessedBird[level] !==
            mysteryBird[level]
        ) {

            break;

        }


        deepestSharedTaxon = {

            level: level,

            value: guessedBird[level]

        };

    }


    return deepestSharedTaxon;

}


// ========================================
// Make a guess
// ========================================

function makeGuess() {

    const input =
        searchInput.value.trim();


    if (input === "") {
        return;
    }


    if (
        gameState.guessesRemaining <= 0
    ) {

        return;

    }


    const bird =
        findBirdByName(input);


    // ====================================
    // Invalid bird
    // ====================================

    if (!bird) {

        console.log(
            "Please select a valid bird."
        );

        return;

    }


    // ====================================
    // Duplicate bird
    // ====================================

    if (
        hasAlreadyBeenGuessed(bird)
    ) {

        console.log(
            "You already guessed this bird."
        );

        searchInput.value = "";

        suggestions.innerHTML = "";

        return;

    }


    // ====================================
    // Save guess
    // ====================================

    gameState.guesses.push(bird);


    // One valid guess = one guess used
    gameState.guessesRemaining--;


    updateGuessCounter();


    // ====================================
    // Update tree
    // ====================================

    renderTaxonomyTree();


    // ====================================
    // Clear search
    // ====================================

    searchInput.value = "";

    suggestions.innerHTML = "";


    // ====================================
    // Correct answer
    // ====================================

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

    const node =
        document.createElement("div");


    node.classList.add(
        "taxon-node"
    );


    node.textContent =
        name;


    return node;

}


// ========================================
// Create species node
// ========================================

function createSpeciesNode(
    name,
    type
) {

    const node =
        document.createElement("div");


    node.classList.add(
        "species-node"
    );


    if (type === "guess") {

        node.classList.add(
            "guessed-species"
        );

    }


    if (type === "mystery") {

        node.classList.add(
            "mystery-species"
        );

    }


    if (type === "correct") {

        node.classList.add(
            "correct-species"
        );

    }


    node.textContent =
        name;


    return node;

}


// ========================================
// Create branch container
// ========================================

function createBranchContainer() {

    const container =
        document.createElement("div");


    container.classList.add(
        "tree-branch"
    );


    return container;

}


// ========================================
// Add guess to tree
// ========================================

function addGuessToTree(
    rootContainer,
    guessedBird
) {

    const mysteryBird =
        gameState.mysteryBird;


    // ====================================
    // Correct answer
    // ====================================

    if (
        guessedBird.commonName ===
        mysteryBird.commonName
    ) {

        const correctSpecies =
            createSpeciesNode(
                guessedBird.commonName,
                "correct"
            );


        rootContainer.appendChild(
            correctSpecies
        );


        return;

    }


    // ====================================
    // Find deepest shared taxon
    // ====================================

    const sharedTaxon =
        getDeepestSharedTaxon(
            guessedBird,
            mysteryBird
        );


    // ====================================
    // If only Aves is shared
    // ====================================

    if (
        sharedTaxon.level === "class"
    ) {

        addSpeciesPair(
            rootContainer,
            guessedBird
        );

        return;

    }


    // ====================================
    // Find existing taxon node
    // ====================================

    let taxonNode =
        [...rootContainer.children]
            .find(
                child =>

                    child.classList.contains(
                        "taxon-node"
                    )

                    &&

                    child.dataset.taxon ===
                    sharedTaxon.value
            );


    // ====================================
    // Create taxon if necessary
    // ====================================

    if (!taxonNode) {

        taxonNode =
            createTaxonNode(
                sharedTaxon.value
            );


        taxonNode.dataset.taxon =
            sharedTaxon.value;


        const branchContainer =
            createBranchContainer();


        taxonNode.appendChild(
            branchContainer
        );


        rootContainer.appendChild(
            taxonNode
        );

    }


    const branchContainer =
        taxonNode.querySelector(
            ":scope > .tree-branch"
        );


    // ====================================
    // Add species
    // ====================================

    addSpeciesPair(
        branchContainer,
        guessedBird
    );

}


// ========================================
// Add guessed species + mystery
// ========================================

function addSpeciesPair(
    container,
    guessedBird
) {

    // ====================================
    // Prevent duplicate branch
    // ====================================

    const existingGuess =
        [...container.children]
            .find(
                child =>

                    child.classList.contains(
                        "species-node"
                    )

                    &&

                    child.dataset.species ===
                    guessedBird.commonName
            );


    if (existingGuess) {

        return;

    }


    // ====================================
    // Guessed bird
    // ====================================

    const guessedSpecies =
        createSpeciesNode(
            guessedBird.commonName,
            "guess"
        );


    guessedSpecies.dataset.species =
        guessedBird.commonName;


    container.appendChild(
        guessedSpecies
    );


    // ====================================
    // Hidden mystery
    // ====================================

    const mysteryAlreadyExists =
        [...container.children]
            .some(
                child =>
                    child.classList.contains(
                        "mystery-species"
                    )
            );


    if (!mysteryAlreadyExists) {

        const mysterySpecies =
            createSpeciesNode(
                "???",
                "mystery"
            );


        container.appendChild(
            mysterySpecies
        );

    }

}


// ========================================
// Render complete taxonomy tree
// ========================================

function renderTaxonomyTree() {

    taxonomyTree.innerHTML = "";


    if (!gameState.mysteryBird) {
        return;
    }


    // ====================================
    // No guesses
    // ====================================

    if (
        gameState.guesses.length === 0
    ) {

        const placeholder =
            document.createElement("div");


        placeholder.classList.add(
            "tree-placeholder"
        );


        placeholder.textContent =
            "Your guesses will appear here.";


        taxonomyTree.appendChild(
            placeholder
        );


        return;

    }


    // ====================================
    // Aves is always root
    // ====================================

    const root =
        createTaxonNode("Aves");


    root.classList.add(
        "tree-root-node"
    );


    const rootContainer =
        createBranchContainer();


    root.appendChild(
        rootContainer
    );


    taxonomyTree.appendChild(
        root
    );


    // ====================================
    // Add every guess
    // ====================================

    gameState.guesses.forEach(
        guessedBird => {

            addGuessToTree(
                rootContainer,
                guessedBird
            );

        }
    );

}


// ========================================
// Guess button
// ========================================

guessButton.addEventListener(
    "click",
    makeGuess
);


// ========================================
// Enter key
// ========================================

searchInput.addEventListener(
    "keydown",
    function (event) {

        if (event.key === "Enter") {

            makeGuess();

        }

    }
);


// ========================================
// Search input
// ========================================

searchInput.addEventListener(
    "input",
    function () {

        showSuggestions(
            searchInput.value
        );

    }
);


// ========================================
// Start game
// ========================================

async function startGame() {

    updateGuessCounter();

    await loadBirdData();

}


startGame();