// ========================================
// MetaAves - Game State
// ========================================

const gameState = {
    mode: null,
    maxGuesses: 12,
    guessesRemaining: 12,
    birds: [],
    allBirds: [],
    thailandBirdKeys: null,
    mysteryBird: null,
    guesses: [],
    taxonomy: null,
    taxonInfo: null,
    clades: null,
    selectedTaxonId: null,
    gameStatus: "playing",
    taxonomyView: "tree",
    wikipediaCache: new Map(),
    thaiNameCache: new Map(),
    taxonCardRequestId: 0,
    hintCache: new Map(),
    hintRequestId: 0
};

const guessCountElement = document.getElementById("guess-count");
const searchInput = document.getElementById("bird-search");
const guessButton = document.getElementById("guess-button");
const taxonomyTree = document.getElementById("taxonomy-tree");
const suggestions = document.getElementById("suggestions");
const treeViewButton = document.getElementById("tree-view-button");
const tableViewButton = document.getElementById("table-view-button");
const modeDisplay = document.getElementById("mode-display");
const gameModeElement = document.getElementById("game-mode");
const modeOverlay = document.getElementById("mode-overlay");
const modeClose = document.getElementById("mode-close");
const worldModeButton = document.getElementById("world-mode-button");
const thailandModeButton = document.getElementById("thailand-mode-button");
const thailandModeStatus = document.getElementById("thailand-mode-status");
const thaiTranslatorButton = document.getElementById("thai-translator-button");
const thaiTranslatorPanel = document.getElementById("thai-translator-panel");
const thaiTranslatorClose = document.getElementById("thai-translator-close");
const thaiTranslatorSearch = document.getElementById("thai-translator-search");
const thaiTranslatorResults = document.getElementById("thai-translator-results");
const birdSearchClear = document.getElementById("bird-search-clear");
const thaiTranslatorClear = document.getElementById("thai-translator-clear");


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
            fetch("data/birds.generated.json?v=20260927-taxonomy"),
            fetch("data/taxonomy.generated.json?v=20260927-taxonomy"),
            fetch("data/taxonomy_overrides.json?v=20260927-taxonomy"),
            fetch("data/taxon_info.json?v=20260927-taxonomy"),
            fetch("data/clades.json?v=20260927-taxonomy"),
            fetch("data/clade_membership.generated.json?v=20260927-taxonomy")
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

        gameState.allBirds = await birdResponse.json();
        gameState.birds = [];
        gameState.taxonomy = await taxonomyResponse.json();
        gameState.taxonomyOverrides = await taxonomyOverrideResponse.json();
        gameState.taxonInfo = await infoResponse.json();
        gameState.clades = await cladeResponse.json();

        const cladeMembership = await cladeMembershipResponse.json();
        const membershipBySpecies = cladeMembership.species || {};
        const postOrderMembershipBySpecies =
            cladeMembership.postOrderSpecies || {};

        // Join both parts of the generated clade layer to the generated bird
        // records. The scientific name is the stable species key produced by
        // AviList.
        const passerineFamilyCladePaths =
            gameState.clades?._meta?.passerineFamilyCladePaths || {};

        gameState.allBirds.forEach(bird => {
            bird.cladePath = membershipBySpecies[bird.scientificName] || [];

            const generatedPostOrder =
                postOrderMembershipBySpecies[bird.scientificName];

            const fallbackPostOrder =
                bird.order === "Passeriformes"
                    ? passerineFamilyCladePaths[bird.family]
                    : null;

            // Always merge the family fallback with generated data.
            // This makes the detailed passerine clade layer resilient when
            // the generated membership file is older than clades.json.
            bird.postOrderCladePath = [
                ...(Array.isArray(generatedPostOrder) ? generatedPostOrder : []),
                ...(Array.isArray(fallbackPostOrder) ? fallbackPostOrder : [])
            ].filter(
                (name, index, values) => values.indexOf(name) === index
            );
        });

        try {
            await loadThailandBirdList();

            if (thailandModeButton) thailandModeButton.disabled = false;
            if (thailandModeStatus) thailandModeStatus.textContent = "Thailand bird list ready";
        } catch (error) {
            console.warn("Thailand bird list unavailable:", error);
            if (thailandModeButton) thailandModeButton.disabled = true;
            if (thailandModeStatus) thailandModeStatus.textContent = "Thailand bird list unavailable";
        }

        gameState.mode = null;
        gameState.mysteryBird = null;
        gameState.birds = [];
        updateModeDisplay();
        updateGuessCounter();
        renderTaxonomyView();
        updateAutomaticTaxonCard();

        openModeSelector(true);
    } catch (error) {
        console.error("Error loading bird database:", error);
        showDataLoadError(error);
    }
}

function showDataLoadError(error) {
    let panel = document.getElementById("data-load-error");

    if (!panel) {
        panel = document.createElement("section");
        panel.id = "data-load-error";
        panel.setAttribute("role", "alert");
        panel.innerHTML = `
            <strong>MetaAves could not load its bird database.</strong>
            <p>Please refresh the page and try again.</p>
        `;
        document.body.prepend(panel);
    }

    panel.dataset.error = error?.message || "Unknown data loading error";
}


// ========================================
// Game modes
// ========================================

function normalizeBirdIdentity(value) {
    return String(value || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/grey/g, "gray")
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}

function normalizeScientificSpecies(value) {
    const words = String(value || "")
        .trim()
        .split(/\s+/)
        .filter(Boolean);

    return words.length >= 2
        ? `${words[0].toLowerCase()} ${words[1].toLowerCase()}`
        : "";
}

function parseThailandBirdList(htmlText) {
    const wrapper = document.createElement("div");
    wrapper.innerHTML = htmlText;

    const scientificNames = new Set();
    const commonNames = new Set();

    wrapper.querySelectorAll("table tr").forEach(row => {
        const cells = [...row.querySelectorAll("td")];
        if (cells.length < 2) return;

        const commonName = cells[0].textContent
            .replace(/\[[^\]]+\]/g, " ")
            .replace(/\s+/g, " ")
            .trim();

        const scientificCell = cells[1].textContent
            .replace(/\[[^\]]+\]/g, " ")
            .replace(/\s+/g, " ")
            .trim();

        const scientific = normalizeScientificSpecies(scientificCell);
        if (!scientific) return;

        scientificNames.add(scientific);
        if (commonName) commonNames.add(normalizeBirdIdentity(commonName));
    });

    if (scientificNames.size < 100) {
        throw new Error("Thailand bird list could not be parsed reliably.");
    }

    return { scientificNames, commonNames };
}

async function loadThailandBirdList() {
    const endpoints = [
        "https://en.wikipedia.org/api/rest_v1/page/html/List_of_birds_of_Thailand",
        "https://en.wikipedia.org/w/api.php?action=parse&page=List_of_birds_of_Thailand&prop=text&format=json&origin=*"
    ];

    let lastError = null;

    for (const endpoint of endpoints) {
        try {
            const response = await fetch(endpoint);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const contentType = response.headers.get("content-type") || "";
            let htmlText = "";

            if (contentType.includes("application/json")) {
                const payload = await response.json();
                htmlText =
                    payload?.parse?.text?.["*"] ||
                    payload?.parse?.text ||
                    "";
            } else {
                htmlText = await response.text();
            }

            gameState.thailandBirdKeys = parseThailandBirdList(htmlText);
            return gameState.thailandBirdKeys;
        } catch (error) {
            lastError = error;
        }
    }

    throw lastError || new Error("Could not load Thailand bird list.");
}

function getBirdPoolForMode(mode) {
    if (mode === "world") return gameState.allBirds;

    if (mode === "thailand" && gameState.thailandBirdKeys) {
        const { scientificNames, commonNames } = gameState.thailandBirdKeys;

        return gameState.allBirds.filter(bird =>
            scientificNames.has(normalizeScientificSpecies(bird.scientificName)) ||
            commonNames.has(normalizeBirdIdentity(bird.commonName))
        );
    }

    return [];
}

function updateModeDisplay() {
    if (!gameModeElement) return;

    gameModeElement.textContent =
        gameState.mode === "thailand"
            ? "Thailand Birds"
            : gameState.mode === "world"
                ? "World Birds"
                : "Choose mode";
}

function openModeSelector(initial = false) {
    if (!modeOverlay) return;

    modeOverlay.classList.add("visible");
    modeOverlay.setAttribute("aria-hidden", "false");
    modeOverlay.dataset.initial = initial ? "true" : "false";

    if (initial) {
        modeClose?.setAttribute("disabled", "true");
    } else {
        modeClose?.removeAttribute("disabled");
    }
}

function closeModeSelector(force = false) {
    if (!modeOverlay || (!force && modeOverlay.dataset.initial === "true")) return;

    modeOverlay.classList.remove("visible");
    modeOverlay.setAttribute("aria-hidden", "true");
    modeOverlay.dataset.initial = "false";
}

function startNewRoundForMode(mode) {
    const pool = getBirdPoolForMode(mode);

    if (!pool.length) {
        console.error("No birds available for mode:", mode);
        return;
    }

    gameState.mode = mode;
    gameState.birds = pool;
    gameState.guessesRemaining = gameState.maxGuesses;
    gameState.guesses = [];
    gameState.selectedTaxonId = null;
    gameState.gameStatus = "playing";
    gameState.mysteryBird = pool[Math.floor(Math.random() * pool.length)];

    gameState.hintCache.clear();
    gameState.hintRequestId++;
    gameState.taxonCardRequestId++;

    searchInput.value = "";
    suggestions.innerHTML = "";
    suggestions.classList.remove("visible");
    searchInput.setAttribute("aria-expanded", "false");
    updateClearButtonVisibility(birdSearchClear, searchInput);

    closeGameOverCard();

    const newGameButton = document.getElementById("new-game-button");
    newGameButton?.classList.remove("visible");

    updateModeDisplay();
    updateGuessCounter();
    renderTaxonomyView();
    updateAutomaticTaxonCard();
    closeModeSelector(true);

    // Thai names are fetched on demand for the study card/helper.
    // Do not fire thousands of external requests when a Thailand round starts.
}

let pendingGameMode = null;

function openForfeitConfirmation(mode) {
    const overlay = document.getElementById("forfeit-overlay");
    if (!overlay) {
        // Defensive fallback: never use the browser's confirm dialog.
        return;
    }

    pendingGameMode = mode;
    overlay.classList.add("visible");
    overlay.setAttribute("aria-hidden", "false");
}

function closeForfeitConfirmation() {
    const overlay = document.getElementById("forfeit-overlay");
    if (!overlay) return;

    pendingGameMode = null;
    overlay.classList.remove("visible");
    overlay.setAttribute("aria-hidden", "true");
}

function confirmForfeitAndChangeMode() {
    const mode = pendingGameMode;
    if (!mode) return;

    closeForfeitConfirmation();
    startNewRoundForMode(mode);
}

function chooseGameMode(mode) {
    if (mode === "thailand" && !gameState.thailandBirdKeys) return;
    if (mode === gameState.mode) {
        closeModeSelector();
        return;
    }

    const activeGame =
        gameState.mode &&
        gameState.gameStatus === "playing";

    if (activeGame) {
        closeModeSelector();
        openForfeitConfirmation(mode);
        return;
    }

    startNewRoundForMode(mode);
}


function updateClearButtonVisibility(button, input) {
    if (!button || !input) return;
    button.hidden = !input.value.trim();
}

function clearBirdSearch() {
    searchInput.value = "";
    suggestions.innerHTML = "";
    suggestions.classList.remove("visible");
    searchInput.setAttribute("aria-expanded", "false");
    updateClearButtonVisibility(birdSearchClear, searchInput);
    searchInput.focus();
}

function clearThaiTranslatorSearch() {
    if (!thaiTranslatorSearch) return;
    thaiTranslatorSearch.value = "";
    renderThaiTranslatorResults("");
    updateClearButtonVisibility(thaiTranslatorClear, thaiTranslatorSearch);
    thaiTranslatorSearch.focus();
}

function normalizeThaiSearchText(value) {
    return String(value || "")
        .toLowerCase()
        .normalize("NFC")
        .replace(/\s+/g, " ")
        .trim();
}

async function searchThaiTranslator(query) {
    const normalized = normalizeThaiSearchText(query);
    if (!normalized) return [];

    const englishMatches = gameState.allBirds
        .filter(bird =>
            normalizeSearchText(bird.commonName).includes(normalized) ||
            normalizeThaiSearchText(bird.thaiName || "").includes(normalized)
        )
        .slice(0, 12);

    await Promise.all(englishMatches.map(async bird => {
        if (!bird.thaiName) {
            try {
                const thaiName = await fetchOnlineThaiName(bird);
                if (thaiName) bird.thaiName = thaiName;
            } catch (error) {
                console.warn("Translator Thai-name lookup failed:", bird.scientificName, error);
            }
        }
    }));

    let matches = englishMatches.filter(bird =>
        normalizeSearchText(bird.commonName).includes(normalized) ||
        normalizeThaiSearchText(bird.thaiName || "").includes(normalized)
    );

    // For a Thai-only query, ask Wikidata directly for Thai labels. This
    // allows the helper to discover the English/scientific bird even when
    // the local bird record has not been given a Thai name yet.
    if (!matches.length) {
        try {
            const url =
                "https://www.wikidata.org/w/api.php?action=wbsearchentities" +
                "&search=" + encodeURIComponent(query) +
                "&language=th&uselang=th&limit=20&format=json&origin=*";

            const response = await fetch(url);
            if (response.ok) {
                const payload = await response.json();
                const ids = (payload.search || [])
                    .map(item => item.id)
                    .filter(Boolean);

                if (ids.length) {
                    const entityUrl =
                        "https://www.wikidata.org/w/api.php?action=wbgetentities" +
                        "&ids=" + encodeURIComponent(ids.join("|")) +
                        "&props=labels|claims&languages=th|en&format=json&origin=*";

                    const entityResponse = await fetch(entityUrl);
                    if (entityResponse.ok) {
                        const entityData = await entityResponse.json();

                        for (const entity of Object.values(entityData.entities || {})) {
                            const thaiLabel = entity.labels?.th?.value;
                            const englishLabel = entity.labels?.en?.value;
                            const scientificClaim =
                                entity.claims?.P225?.[0]?.mainsnak?.datavalue?.value;

                            if (!thaiLabel || !scientificClaim) continue;

                            const scientific = normalizeScientificSpecies(scientificClaim);
                            const localBird = gameState.allBirds.find(bird =>
                                normalizeScientificSpecies(bird.scientificName) === scientific
                            );

                            if (localBird) {
                                localBird.thaiName = thaiLabel;
                                matches.push(localBird);
                                continue;
                            }

                            if (englishLabel) {
                                const englishBird = gameState.allBirds.find(bird =>
                                    normalizeSearchText(bird.commonName) === normalizeSearchText(englishLabel)
                                );
                                if (englishBird) {
                                    englishBird.thaiName = thaiLabel;
                                    matches.push(englishBird);
                                }
                            }
                        }
                    }
                }
            }
        } catch (error) {
            console.warn("Wikidata Thai translator search failed:", error);
        }
    }

    return [...new Map(
        matches.map(bird => [bird.scientificName, bird])
    ).values()].slice(0, 30);
}

function renderThaiTranslatorResults(query, results = null) {
    if (!thaiTranslatorResults) return;

    thaiTranslatorResults.innerHTML = "";

    if (!query.trim()) {
        thaiTranslatorResults.innerHTML =
            '<div class="thai-translator-empty">Start typing a Thai or English bird name.</div>';
        return;
    }

    if (!results?.length) {
        thaiTranslatorResults.innerHTML =
            '<div class="thai-translator-empty">No matching bird names found.</div>';
        return;
    }

    results.forEach(bird => {
        const item = document.createElement("div");
        item.className = "thai-translator-result";

        const english = document.createElement("div");
        english.className = "thai-translator-english";
        english.textContent = bird.commonName;

        const thai = document.createElement("div");
        thai.className = "thai-translator-thai";
        thai.textContent = bird.thaiName || "Thai name not available";

        item.append(english, thai);

        if (bird.scientificName) {
            const scientific = document.createElement("div");
            scientific.className = "thai-translator-scientific";
            scientific.textContent = bird.scientificName;
            item.appendChild(scientific);
        }

        thaiTranslatorResults.appendChild(item);
    });
}

async function updateThaiTranslatorResults(query) {
    if (!query.trim()) {
        renderThaiTranslatorResults("");
        return;
    }

    thaiTranslatorResults.innerHTML =
        '<div class="thai-translator-empty">Looking up bird names…</div>';

    const results = await searchThaiTranslator(query);
    // Ignore stale searches when the user has already typed something else.
    if (thaiTranslatorSearch?.value !== query) return;

    renderThaiTranslatorResults(query, results);
}

function openThaiTranslator() {
    if (!thaiTranslatorPanel) return;
    thaiTranslatorPanel.classList.add("visible");
    thaiTranslatorPanel.setAttribute("aria-hidden", "false");
    thaiTranslatorButton?.setAttribute("aria-expanded", "true");
    thaiTranslatorSearch?.focus();
    renderThaiTranslatorResults("");
}

function closeThaiTranslator() {
    if (!thaiTranslatorPanel) return;
    thaiTranslatorPanel.classList.remove("visible");
    thaiTranslatorPanel.setAttribute("aria-hidden", "true");
    thaiTranslatorButton?.setAttribute("aria-expanded", "false");

    // Closing the helper always starts it fresh next time.
    if (thaiTranslatorSearch) thaiTranslatorSearch.value = "";
    if (thaiTranslatorResults) renderThaiTranslatorResults("");
    updateClearButtonVisibility(thaiTranslatorClear, thaiTranslatorSearch);
}

function initializeSearchClearButtons() {
    birdSearchClear?.addEventListener("click", clearBirdSearch);
    thaiTranslatorClear?.addEventListener("click", clearThaiTranslatorSearch);

    // Keep both clear controls synchronized from the first paint onward.
    // They should be hidden only when their corresponding field is empty.
    updateClearButtonVisibility(birdSearchClear, searchInput);
    updateClearButtonVisibility(thaiTranslatorClear, thaiTranslatorSearch);

    searchInput?.addEventListener("input", () => {
        updateClearButtonVisibility(birdSearchClear, searchInput);
    });

    thaiTranslatorSearch?.addEventListener("input", () => {
        updateClearButtonVisibility(thaiTranslatorClear, thaiTranslatorSearch);
    });
}

initializeSearchClearButtons();

function initializeThaiTranslator() {
    thaiTranslatorButton?.addEventListener("click", () => {
        if (thaiTranslatorPanel?.classList.contains("visible")) {
            closeThaiTranslator();
        } else {
            openThaiTranslator();
        }
    });

    thaiTranslatorClose?.addEventListener("click", closeThaiTranslator);

    thaiTranslatorSearch?.addEventListener("input", () => {
        updateThaiTranslatorResults(thaiTranslatorSearch.value);
    });

    document.addEventListener("click", event => {
        if (
            thaiTranslatorPanel?.classList.contains("visible") &&
            !thaiTranslatorPanel.contains(event.target) &&
            !thaiTranslatorButton?.contains(event.target)
        ) {
            closeThaiTranslator();
        }
    });
}

initializeThaiTranslator();

function initializeModeSelector() {
    worldModeButton?.addEventListener("click", () => chooseGameMode("world"));
    thailandModeButton?.addEventListener("click", () => chooseGameMode("thailand"));
    modeDisplay?.addEventListener("click", () => openModeSelector(false));
    modeClose?.addEventListener("click", closeModeSelector);

    modeOverlay?.addEventListener("click", event => {
        if (event.target === modeOverlay && modeOverlay.dataset.initial !== "true") {
            closeModeSelector();
        }
    });
}

initializeModeSelector();

function initializeForfeitConfirmation() {
    const overlay = document.getElementById("forfeit-overlay");
    const close = document.getElementById("forfeit-close");
    const cancel = document.getElementById("forfeit-cancel");
    const confirm = document.getElementById("forfeit-confirm");

    close?.addEventListener("click", closeForfeitConfirmation);
    cancel?.addEventListener("click", closeForfeitConfirmation);
    confirm?.addEventListener("click", confirmForfeitAndChangeMode);

    overlay?.addEventListener("click", event => {
        if (event.target === overlay) {
            closeForfeitConfirmation();
        }
    });

    document.addEventListener("keydown", event => {
        if (event.key === "Escape" && overlay?.classList.contains("visible")) {
            closeForfeitConfirmation();
        }
    });
}

initializeForfeitConfirmation();


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
    const normalizedName = normalizeSearchText(name);

    return gameState.birds.find(
        bird => normalizeSearchText(bird.commonName) === normalizedName
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
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9\s-]/g, " ")
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
            .filter(entry =>
                entry?.id?.startsWith("clade:") &&
                entry?.name
            )
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
        rankedPath.slice(1).forEach(node => {
            addNode(node.id, node.level, node.value);

            // Some useful phylogenetic clades live *inside* a ranked order,
            // rather than above it. Insert them after the order and before
            // family/genus/species. This preserves the biological lineage
            // without changing the deepest-shared-node mechanic.
            if (node.level === "order") {
                // Wikipedia taxoboxes can provide useful intermediate ranked
                // groups that are absent from the compact AviList hierarchy.
                // Add only ranks that were actually verified on the species
                // page. This enriches the lineage without changing the
                // deepest-shared-node rule.
                const detailed = bird.wikipediaDetailedTaxonomy || {};
                const intermediateOrder = [
                    "suborder",
                    "infraorder",
                    "parvorder",
                    "superfamily",
                    "subfamily",
                    "tribe",
                    "subtribe"
                ];

                intermediateOrder.forEach(rank => {
                    const entry = detailed[rank];
                    if (!entry?.name) return;

                    const id = nodeIdForTaxon(rank, entry.name);
                    addNode(id, rank, entry.name);
                });
            }

            if (node.level === "order") {
                const fallbackFamilyPath =
                    bird.order === "Passeriformes"
                        ? gameState.clades?._meta?.passerineFamilyCladePaths?.[bird.family]
                        : null;

                const postOrderPath = [
                    ...(Array.isArray(bird.postOrderCladePath)
                        ? bird.postOrderCladePath
                        : []),
                    ...(Array.isArray(fallbackFamilyPath)
                        ? fallbackFamilyPath
                        : [])
                ].filter(
                    (name, index, values) => values.indexOf(name) === index
                );

                postOrderPath.forEach(cladeName => {
                    const clade = cladeByName.get(cladeName);
                    if (!clade || seen.has(clade.id)) return;
                    addNode(clade.id, "clade", clade.name);
                });
            }
        });
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
        clearBirdSearch();
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
    suggestions.classList.remove("visible");
    searchInput.setAttribute("aria-expanded", "false");
    updateClearButtonVisibility(birdSearchClear, searchInput);

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
        // Start every round with the hidden mystery leaf already visible:
        // Aves → ???. This gives the player the same visual starting point
        // as the normal revealed tree without exposing any taxonomy beyond
        // the Aves root.
        if (gameState.mysteryBird) {
            root.children.push({
                type: "species",
                name: "???",
                nodeType: "mystery",
                bird: null
            });
        }

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

            // Side branches are deliberately summarized at FAMILY level.
            // This keeps the tree readable and matches the Metazooa-style
            // presentation: two guesses can reveal their shared family
            // without exposing every subfamily/genus node that happens to
            // sit below it. Species/genus closeness to the mystery itself is
            // still handled by the normal guess -> mystery path.
            const commonIndex = leftPath.findIndex(
                node => node.id === common.id
            );
            const familyNode =
                commonIndex >= 0
                    ? [...leftPath.slice(0, commonIndex + 1)]
                        .reverse()
                        .find(node => node.level === "family")
                    : null;
            const sideBranchEndpoint = familyNode || common;

            // If the pair's shared branch is not deeper than both mystery
            // relationships, it adds no new information and stays collapsed.
            if (sideBranchEndpoint.depth <= mysteryDepth) continue;

            revealAncestors(leftPath, sideBranchEndpoint.id);
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

    // Color represents biological closeness to the mystery, not how many
    // visible UI levels happen to be between this node and Aves.
    //
    // A node on the mystery's revealed lineage gets a progressively greener
    // color as it approaches the mystery. A side branch inherits the color of
    // the point where that branch joins the mystery lineage, so adding extra
    // taxa such as Bucerotiformes -> Bucerotidae -> Bucerotinae cannot make
    // that side branch look artificially closer.
    if (Number.isFinite(node.__proximity)) {
        return Math.max(0, Math.min(1, node.__proximity));
    }

    return 0;
}

function assignTreeNodeProximity(root) {
    if (!root) return;

    const mysteryPath = getBirdPhylogenyPath(gameState.mysteryBird);
    if (!mysteryPath.length) return;

    // Proximity is based on the mystery bird's ACTUAL full lineage.
    // Do not normalize against the currently revealed/visible part of the
    // tree, because that makes a shallow reveal look artificially close.
    const mysteryIndexById = new Map(
        mysteryPath.map((taxon, index) => [taxon.id, index])
    );

    const fullMysteryDepth = Math.max(1, mysteryPath.length - 1);

    function walk(node, inheritedProximity = 0) {
        if (!node || node.type !== "taxon") return;

        const mysteryIndex = mysteryIndexById.get(node.taxonId);

        if (mysteryIndex !== undefined) {
            // Aves = 0; deeper shared taxonomy = closer to the real mystery.
            node.__proximity = Math.max(
                0,
                Math.min(1, mysteryIndex / fullMysteryDepth)
            );
        } else {
            // A side branch keeps the proximity of the point where it
            // diverges from the mystery lineage.
            node.__proximity = inheritedProximity;
        }

        (node.children || []).forEach(child => {
            if (child.type === "taxon") {
                walk(child, node.__proximity);
            } else {
                // Species leaves stay neutral. This value is only used by
                // their final connector.
                child.__proximity = node.__proximity;
            }
        });
    }

    walk(root, 0);
}

function getProximityColor(proximity) {
    const t = Math.max(0, Math.min(1, Number(proximity) || 0));

    // Restore MetaAves' earlier, earthier palette. These were the
    // original colors before the brighter recent revision:
    // distant = deep red, then burnt orange, olive, and forest green.
    if (t < 0.25) return "rgb(158, 48, 24)";
    if (t < 0.50) return "rgb(190, 99, 24)";
    if (t < 0.75) return "rgb(145, 139, 25)";
    return "rgb(76, 125, 48)";
}

function createTreeNodeElement(node) {
    const element = document.createElement("div");

    element.classList.add("meta-tree-node");

    if (node.type === "taxon") {
        const proximity = getTreeNodeProximity(node);
        const proximityColor = getProximityColor(proximity);
        element.style.setProperty("--tree-proximity-color", proximityColor);
        element.style.setProperty(
            "--tree-proximity-hue",
            Math.round(proximity * 120)
        );
        element.style.setProperty("--tree-proximity-saturation", "68%");
        element.style.setProperty("--tree-proximity-lightness", "38%");
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

            element.addEventListener("mouseenter", event => {
                showSpeciesHint(node.bird, event.currentTarget);
            });
            element.addEventListener("mousemove", event => {
                positionSpeciesHint(event.currentTarget);
            });
            element.addEventListener("mouseleave", hideSpeciesHint);

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
        // 1. BirdNET+ Taxonomy. Its current taxonomy dataset
        // stores localized common names and is based on AviList for birds.
        // Thai is available under the "th" locale for a large number of
        // Thailand species and is a better first source than guessing a
        // translation from the English name.
        try {
            const birdnetUrl =
                "https://birdnet.cornell.edu/taxonomy/api/species/" +
                encodeURIComponent(scientificName);

            const birdnetResponse = await fetch(birdnetUrl);
            if (birdnetResponse.ok) {
                const birdnetData = await birdnetResponse.json();

                const findThaiName = value => {
                    if (!value) return null;

                    if (Array.isArray(value)) {
                        const match = value.find(entry => {
                            const locale = String(
                                entry?.locale ||
                                entry?.language ||
                                entry?.lang ||
                                entry?.code ||
                                ""
                            ).toLowerCase();
                            return locale === "th" || locale === "tha" || locale.startsWith("th-");
                        });

                        if (match) {
                            return (
                                match.name ||
                                match.value ||
                                match.label ||
                                match.vernacularName ||
                                null
                            );
                        }

                        for (const entry of value) {
                            const nested = findThaiName(entry);
                            if (nested) return nested;
                        }

                        return null;
                    }

                    if (typeof value === "object") {
                        const direct =
                            value.th ||
                            value.tha ||
                            value["th-th"] ||
                            value["th-TH"];

                        if (typeof direct === "string" && direct.trim()) {
                            return direct.trim();
                        }

                        for (const key of [
                            "commonNames",
                            "common_names",
                            "names",
                            "translations",
                            "vernacularNames",
                            "vernacular_names"
                        ]) {
                            const nested = findThaiName(value[key]);
                            if (nested) return nested;
                        }

                        return null;
                    }

                    return null;
                };

                const thai = findThaiName(
                    birdnetData?.commonNames ||
                    birdnetData?.common_names ||
                    birdnetData?.names ||
                    birdnetData?.translations ||
                    birdnetData?.vernacularNames ||
                    birdnetData?.vernacular_names
                );

                if (thai) return String(thai).trim();
            }
        } catch (error) {
            console.warn("BirdNET Thai-name lookup failed:", scientificName, error);
        }

        // 2. GBIF ChecklistBank / Taxonomic Backbone.
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

        // 3. Wikidata fallback.
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
        "aves",
        // Wikipedia often describes bird pages by their specific group
        // instead of literally saying "bird". For example, Tropical
        // screech owl is described as "Species of owl".
        "owl",
        "owls",
        "penguin",
        "penguins",
        "parrot",
        "parrots",
        "macaw",
        "macaws",
        "cockatoo",
        "cockatoos",
        "pigeon",
        "pigeons",
        "dove",
        "doves",
        "duck",
        "ducks",
        "goose",
        "geese",
        "swan",
        "swans",
        "heron",
        "herons",
        "egret",
        "egrets",
        "stork",
        "storks",
        "ibis",
        "ibises",
        "kingfisher",
        "kingfishers",
        "hornbill",
        "hornbills",
        "woodpecker",
        "woodpeckers",
        "hummingbird",
        "hummingbirds",
        "toucan",
        "toucans",
        "flamingo",
        "flamingos",
        "crane",
        "cranes",
        "rail",
        "rails",
        "galliform",
        "galliforms",
        "pheasant",
        "pheasants",
        "grouse",
        "grouses",
        "quail",
        "quails",
        "falcon",
        "falcons",
        "hawk",
        "hawks",
        "eagle",
        "eagles",
        "kite",
        "kites",
        "vulture",
        "vultures",
        "harrier",
        "harriers",
        "tern",
        "terns",
        "gull",
        "gulls",
        "albatross",
        "albatrosses",
        "petrel",
        "petrels",
        "cuckoo",
        "cuckoos",
        "nightjar",
        "nightjars",
        "swift",
        "swifts",
        "kinglet",
        "kinglets",
        "warbler",
        "warblers",
        "thrush",
        "thrushes",
        "sparrow",
        "sparrows",
        "finch",
        "finches",
        "tit",
        "tits",
        "wren",
        "wrens",
        "starling",
        "starlings",
        "monarch",
        "monarchs"
    ];

    return birdSignals.some(signal => text.includes(signal));
}

function wikipediaLookupCandidates(title, scientificName = "") {
    const cleanTitle = String(title || "").trim();
    const cleanScientificName = String(scientificName || "").trim();
    const candidates = [];
    const add = value => {
        const clean = String(value || "").trim();
        if (!clean) return;
        if (!candidates.some(candidate => candidate.toLowerCase() === clean.toLowerCase())) {
            candidates.push(clean);
        }
    };

    // Try the current MetaAves common name first.
    add(cleanTitle);

    // Some bird articles use a "(bird)" disambiguator.
    if (cleanTitle && !/\(bird\)$/i.test(cleanTitle)) {
        add(cleanTitle + " (bird)");
    }

    // Common names change between checklists. The scientific name is much
    // more stable, so always try it as an independent Wikipedia title.
    add(cleanScientificName);

    return candidates;
}

async function searchWikipediaBirdByScientificName(scientificName) {
    const scientific = String(scientificName || "").trim();
    if (!scientific) return [];

    try {
        const url =
            "https://en.wikipedia.org/w/api.php?" +
            new URLSearchParams({
                action: "query",
                list: "search",
                srsearch: '"' + scientific + '"',
                srlimit: "5",
                redirects: "1",
                format: "json",
                formatversion: "2",
                origin: "*"
            }).toString();

        const response = await fetch(url, {
            headers: {
                "Api-User-Agent":
                    "MetaAves/1.0 (https://github.com/PrinnBoontanan/MetaAves)"
            }
        });

        if (!response.ok) return [];

        const data = await response.json();
        return (data?.query?.search || [])
            .map(item => item.title)
            .filter(Boolean);
    } catch (error) {
        console.warn("Wikipedia scientific-name search failed:", scientific, error);
        return [];
    }
}

async function fetchWikipediaMediaWikiFallback(normalizedTitle, includeHtml) {
    const title = String(normalizedTitle || "").replace(/_/g, " ");
    if (!title) return null;

    const result = {
        summary: null,
        html: null,
        wikitext: null
    };

    try {
        // The Action API is a reliable browser-side fallback because anonymous
        // cross-origin requests can explicitly opt into CORS with origin=*.
        const summaryUrl =
            "https://en.wikipedia.org/w/api.php?" +
            new URLSearchParams({
                action: "query",
                prop: "extracts|pageimages|info",
                exintro: "1",
                explaintext: "1",
                inprop: "url",
                piprop: "thumbnail",
                pithumbsize: "600",
                redirects: "1",
                titles: title,
                format: "json",
                origin: "*"
            }).toString();

        const summaryResponse = await fetch(summaryUrl, {
            headers: {
                "Api-User-Agent":
                    "MetaAves/1.0 (https://github.com/PrinnBoontanan/MetaAves)"
            }
        });

        if (summaryResponse.ok) {
            const summaryData = await summaryResponse.json();
            const page = Object.values(summaryData?.query?.pages || {})[0];

            if (page && !page.missing) {
                result.summary = {
                    title: page.title || title,
                    extract: page.extract || "",
                    description: page.extract
                        ? page.extract.split(/(?<=[.!?])\s+/)[0]
                        : "",
                    thumbnail: page.thumbnail?.source
                        ? { source: page.thumbnail.source }
                        : null,
                    content_urls: {
                        desktop: {
                            page: page.fullurl ||
                                "https://en.wikipedia.org/wiki/" +
                                encodeURIComponent(
                                    String(page.title || title).replace(/ /g, "_")
                                )
                        }
                    }
                };
            }
        }
    } catch (error) {
        console.warn("Wikipedia Action API summary fallback failed:", normalizedTitle, error);
    }

    if (includeHtml) {
        try {
            // Get the actual page source from the latest revision. This is
            // the same MediaWiki API pattern used by established Wikipedia
            // parsers: query -> revisions -> main slot -> content.
            const revisionUrl =
                "https://en.wikipedia.org/w/api.php?" +
                new URLSearchParams({
                    action: "query",
                    prop: "revisions",
                    titles: title,
                    rvprop: "content",
                    rvslots: "main",
                    rvlimit: "1",
                    redirects: "1",
                    format: "json",
                    formatversion: "2",
                    origin: "*"
                }).toString();

            const revisionResponse = await fetch(revisionUrl, {
                headers: {
                    "Api-User-Agent":
                        "MetaAves/1.0 (https://github.com/PrinnBoontanan/MetaAves)"
                }
            });

            if (revisionResponse.ok) {
                const revisionData = await revisionResponse.json();
                const page = revisionData?.query?.pages?.[0];
                result.wikitext =
                    page?.revisions?.[0]?.slots?.main?.content || null;
            }
        } catch (error) {
            console.warn("Wikipedia revision source fetch failed:", normalizedTitle, error);
        }

        // Keep MediaWiki's parse endpoint as the HTML fallback. It is useful
        // when the REST HTML endpoint is unavailable, while conservation
        // parsing itself uses the raw revision source above.
        try {
            const parseUrl =
                "https://en.wikipedia.org/w/api.php?" +
                new URLSearchParams({
                    action: "parse",
                    page: title,
                    prop: "text",
                    redirects: "1",
                    format: "json",
                    formatversion: "2",
                    origin: "*"
                }).toString();

            const parseResponse = await fetch(parseUrl, {
                headers: {
                    "Api-User-Agent":
                        "MetaAves/1.0 (https://github.com/PrinnBoontanan/MetaAves)"
                }
            });

            if (parseResponse.ok) {
                const parseData = await parseResponse.json();
                result.html = parseData?.parse?.text || null;
            }
        } catch (error) {
            console.warn("Wikipedia Action API HTML fallback failed:", normalizedTitle, error);
        }
    }

    if (!result.summary && !result.html && !result.wikitext) return null;
    return result;
}

async function fetchWikipediaPageData(
    title,
    includeHtml = false,
    expectedType = "bird",
    scientificName = "",
    requireThumbnail = false
) {
    // Fast path: try the exact/common Wikipedia title first. The previous
    // implementation searched by scientific name BEFORE trying this, which
    // added an unnecessary network round trip to almost every card open.
    let candidates = wikipediaLookupCandidates(title, scientificName);

    const loadCandidate = async normalizedTitle => {
        let data = gameState.wikipediaCache.get(normalizedTitle);

        if (!data) {
            data = {
                summary: null,
                html: null,
                wikitext: null,
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

        if (!data.summary) {
            const fallback = await fetchWikipediaMediaWikiFallback(
                normalizedTitle,
                false
            );

            if (fallback?.summary) data.summary = fallback.summary;
        }

        if (!data.summary) return null;

        if (expectedType === "bird") {
            data.validatedBird = isWikipediaBirdPage(data.summary);
            if (!data.validatedBird) return null;
        }

        if (!includeHtml) return data;

        // Detailed article data is deliberately loaded only after the fast
        // summary is available. This keeps card opening responsive.
        if (!data.wikitext || !data.html) {
            const [sourceFallback, restHtml] = await Promise.all([
                !data.wikitext
                    ? fetchWikipediaMediaWikiFallback(normalizedTitle, true)
                    : Promise.resolve(null),
                !data.html
                    ? fetch(
                        "https://en.wikipedia.org/w/rest.php/v1/page/" +
                        encodeURIComponent(normalizedTitle) +
                        "/html",
                        {
                            headers: {
                                "Api-User-Agent":
                                    "MetaAves/1.0 (https://github.com/PrinnBoontanan/MetaAves)"
                            }
                        }
                    )
                        .then(response => response.ok ? response.text() : null)
                        .catch(() => null)
                    : Promise.resolve(data.html)
            ]);

            if (sourceFallback?.wikitext) {
                data.wikitext = sourceFallback.wikitext;
            }
            if (sourceFallback?.html && !data.html) {
                data.html = sourceFallback.html;
            }
            if (restHtml) {
                data.html = restHtml;
            }

            // Only make the parsed-HTML fallback request when the REST page
            // actually failed or omitted the infobox conservation field.
            if (
                data.html &&
                !findWikipediaConservationStatus(data.html) &&
                !data.wikitext
            ) {
                const fallback = await fetchWikipediaMediaWikiFallback(
                    normalizedTitle,
                    true
                );
                if (fallback?.html) data.html = fallback.html;
                if (fallback?.wikitext) data.wikitext = fallback.wikitext;
            }
        }

        return data;
    };

    // First pass: direct titles only. Keep searching when a valid page has
    // no image and this card explicitly requested a thumbnail.
    let firstValidData = null;

    for (const candidateTitle of candidates) {
        const normalizedTitle = wikipediaCacheKey(candidateTitle);
        if (!normalizedTitle) continue;

        const data = await loadCandidate(normalizedTitle);
        if (!data) continue;

        if (!firstValidData) firstValidData = data;

        if (!requireThumbnail || data?.summary?.thumbnail?.source) {
            return data;
        }
    }

    // Slow fallback when the direct title attempts failed to produce the
    // requested image (or failed completely).
    if (expectedType === "bird" && scientificName) {
        const searchedTitles = await searchWikipediaBirdByScientificName(
            scientificName
        );

        for (const searchedTitle of searchedTitles) {
            const normalizedTitle = wikipediaCacheKey(searchedTitle);
            if (!normalizedTitle) continue;

            const data = await loadCandidate(normalizedTitle);
            if (!data) continue;

            if (!firstValidData) firstValidData = data;

            if (!requireThumbnail || data?.summary?.thumbnail?.source) {
                return data;
            }
        }
    }

    return firstValidData;
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

function cleanWikipediaNode(node) {
    if (!node) return "";

    const clone = node.cloneNode(true);

    // Remove the section's own heading. The heading is metadata for our
    // parser, not article prose, so it must never appear inside a Study Card
    // value such as "Description".
    clone.querySelectorAll(
        ":scope > .mw-heading, " +
        ":scope > h1, :scope > h2, :scope > h3, " +
        ":scope > h4, :scope > h5, :scope > h6"
    ).forEach(element => element.remove());

    // Child sections are parsed separately. Keeping them here would make a
    // parent such as "Behaviour and ecology" swallow Diet and Breeding.
    clone.querySelectorAll(
        "section, table, style, script, noscript, " +
        ".navbox, .reflist, .reference, .mw-references-wrap, " +
        ".mw-editsection, .metadata, .shortdescription"
    ).forEach(element => element.remove());

    return normalizeWikipediaText(clone.textContent);
}

function extractWikipediaSections(html) {
    if (!html) return {};

    const documentRoot = new DOMParser().parseFromString(html, "text/html");
    const content =
        documentRoot.querySelector(".mw-parser-output") ||
        documentRoot.body;

    if (!content) return {};

    const sections = {
        __lead__: ""
    };

    const wrappedSections = [
        ...content.querySelectorAll("section[data-mw-section-id]")
    ];

    if (wrappedSections.length) {
        wrappedSections.forEach(section => {
            const heading = section.querySelector(
                ":scope > .mw-heading > h1, " +
                ":scope > .mw-heading > h2, " +
                ":scope > .mw-heading > h3, " +
                ":scope > .mw-heading > h4, " +
                ":scope > .mw-heading > h5, " +
                ":scope > h1, :scope > h2, :scope > h3, " +
                ":scope > h4, :scope > h5"
            );

            const id = section.getAttribute("data-mw-section-id");
            const text = cleanWikipediaNode(section);

            if (!heading) {
                if (id === "0" || id === "-1" || id === "-2") {
                    sections.__lead__ = text;
                }
                return;
            }

            const headingText = normalizeWikipediaHeading(heading.textContent);
            if (headingText && text) {
                sections[headingText] = text;
            }
        });

        return sections;
    }

    const headings = [
        ...content.querySelectorAll("h1, h2, h3, h4, h5")
    ];

    headings.forEach(heading => {
        const headingText = normalizeWikipediaHeading(heading.textContent);
        if (!headingText) return;

        const level = Number(heading.tagName.substring(1));
        const parts = [];
        let sibling = heading.nextElementSibling;

        while (sibling) {
            if (sibling.matches("h1, h2, h3, h4, h5")) {
                const siblingLevel =
                    Number(sibling.tagName.substring(1));
                if (siblingLevel <= level) break;
            }

            if (!sibling.matches("table, style, script, noscript")) {
                const text = cleanWikipediaNode(sibling);
                if (text) parts.push(text);
            }

            sibling = sibling.nextElementSibling;
        }

        const text = normalizeWikipediaText(parts.join(" "));
        if (text) sections[headingText] = text;
    });

    const firstHeading = headings[0];
    const leadParts = [];
    let leadNode = content.firstElementChild;

    while (leadNode && leadNode !== firstHeading) {
        if (!leadNode.matches("table, style, script, noscript")) {
            const text = cleanWikipediaNode(leadNode);
            if (text) leadParts.push(text);
        }
        leadNode = leadNode.nextElementSibling;
    }

    sections.__lead__ = normalizeWikipediaText(leadParts.join(" "));
    return sections;
}

function findWikipediaInfoboxField(html, candidates) {
    if (!html) return "";

    const documentRoot = new DOMParser().parseFromString(html, "text/html");
    const normalizedCandidates = candidates.map(candidate =>
        normalizeWikipediaText(candidate).toLowerCase()
    );

    const rows = documentRoot.querySelectorAll(
        ".infobox tr, table.infobox tr"
    );

    for (const row of rows) {
        const cells = [...row.children].filter(cell =>
            /^(TH|TD)$/i.test(cell.tagName)
        );

        if (cells.length < 2) continue;

        const label = normalizeWikipediaText(cells[0].textContent)
            .toLowerCase();

        if (!normalizedCandidates.some(candidate =>
            label === candidate ||
            label.includes(candidate)
        )) {
            continue;
        }

        const value = normalizeWikipediaText(
            cells.slice(1).map(cell => cell.textContent).join(" ")
        );

        if (value) return value;
    }

    const labels = documentRoot.querySelectorAll(
        ".infobox .infobox-label, " +
        ".infobox .infobox-label-title, " +
        ".infobox [class*=\"label\"]"
    );

    for (const labelElement of labels) {
        const label = normalizeWikipediaText(labelElement.textContent)
            .toLowerCase();

        if (!normalizedCandidates.some(candidate =>
            label === candidate ||
            label.includes(candidate)
        )) {
            continue;
        }

        const container = labelElement.parentElement;
        const valueElement =
            container?.querySelector(".infobox-data, [class*=\"data\"]") ||
            labelElement.nextElementSibling;

        const value = normalizeWikipediaText(
            valueElement?.textContent || ""
        );

        if (value) return value;
    }

    return "";
}

function splitWikipediaSentences(text) {
    return normalizeWikipediaText(text)
        // Wikipedia prose occasionally loses a sentence boundary when
        // references/HTML are stripped. Conjunctions such as "However,"
        // commonly start a new sentence in those cases.
        .replace(/\s+(?=(?:However|Nevertheless|Although|But)\b)/g, ". ")
        .split(/(?<=[.!?])\s+/)
        .map(sentence => sentence.trim())
        .filter(Boolean);
}

function findWikipediaSection(sections, candidates) {
    if (!sections) return "";

    const normalizedCandidates = candidates.map(candidate =>
        normalizeWikipediaText(candidate).toLowerCase()
    );

    for (const candidate of normalizedCandidates) {
        if (sections[candidate]) return sections[candidate];
    }

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

function collectWikipediaSentences(sections) {
    const results = [];

    for (const [heading, text] of Object.entries(sections || {})) {
        if (!text || heading === "__lead__") continue;

        for (const sentence of splitWikipediaSentences(text)) {
            results.push({
                heading,
                sentence,
                lower: sentence.toLowerCase()
            });
        }
    }

    return results;
}

function isDedicatedWikipediaHeading(heading, category) {
    const h = String(heading || "").toLowerCase();

    // A heading containing multiple study-card concepts is a combined
    // section. Its sentences must be classified individually rather than
    // copying the entire section into one category.
    const categoryTerms = {
        description: ["description", "appearance", "identification"],
        habitat: ["habitat"],
        distribution: ["distribution", "range", "geographic range"],
        diet: ["diet", "feeding", "food"],
        behavior: ["behavior", "behaviour"],
        breeding: ["breeding", "reproduction", "nesting"],
        conservation: ["conservation", "threat", "status"]
    };

    const terms = categoryTerms[category] || [];
    if (!terms.some(term => h.includes(term))) return false;

    const allTerms = Object.values(categoryTerms).flat();
    const otherTerms = allTerms.filter(term =>
        !terms.includes(term) && h.includes(term)
    );

    // "Ecology" is a broad umbrella heading. It commonly contains diet,
    // behaviour and breeding together, so it must never be treated as a
    // dedicated section for one of those categories.
    if (
        h.includes("ecology") &&
        ["behavior", "behaviour", "diet", "feeding", "food",
         "breeding", "reproduction", "nesting", "habitat"]
            .some(term => terms.includes(term))
    ) {
        return false;
    }

    return otherTerms.length === 0;
}

function wikipediaSentenceMatchesCategory(sentence, category) {
    const text = sentence.toLowerCase();

    const rules = {
        habitatDistribution: [
            ["habitat", "distribution", "range", "distributed", "endemic to",
             "native to", "inhabit", "lives in", "found in", "found on",
             "occurs in", "occurs at", "forest", "woodland", "grassland",
             "wetland", "savanna", "montane", "highland", "lowland",
             "coast", "coastal", "river", "shrubland", "altitude",
             "elevation", "north", "south", "east", "west", "island",
             "islands", "region", "country", "new guinea", "africa",
             "asia", "europe", "australia", "america"]
        ],

        diet: [
            ["diet", "feeds", "feed on", "feeding", "eats", "eat",
             "consumes", "consist of", "made up of", "food includes",
             "foods include", "primarily", "mainly", "mostly"],
            ["seeds", "berries", "fruit", "fruits", "insects",
             "invertebrates", "nectar", "fish", "prey", "grubs",
             "worms", "spiders", "arthropods", "vertebrates", "carrion"]
        ],

        behavior: [
            ["behavior", "behaviour", "shy", "secretive", "quiet",
             "social", "solitary", "flock", "flocks", "pair", "pairs",
             "territor", "roost", "migrat", "vocal", "call", "calls",
             "flight", "flies", "forages", "courtship", "display"]
        ],

        breeding: [
            ["breed", "breeding", "nest", "nesting", "egg", "eggs",
             "clutch", "incubat", "chick", "young", "offspring",
             "lay", "lays", "reproduct", "juvenile"]
        ],

        conservation: [
            ["iucn", "conservation", "threatened", "near-threatened",
             "least concern", "vulnerable", "endangered", "population",
             "declin", "habitat loss", "deforestation", "logging",
             "hunting", "trapped", "trapping", "illegal wildlife",
             "bycatch", "snare", "protected area", "protected areas",
             "conservation", "captivity", "captive", "reintroduc",
             "released", "release into the wild"]
        ]
    };

    if (category === "diet") {
        // Food words by themselves are not enough: an article can mention
        // "insects", "spiders", etc. while discussing habitat, threats, or
        // another subject. Require an actual diet/feeding construction.
        const strongDietSignals = [
            "diet", "feeds", "feed on", "feeding", "eats", "eat",
            "consumes", "consist of", "made up of", "food includes",
            "foods include", "diet includes", "diet consists",
            "primarily", "mainly", "mostly"
        ];

        const foodSignals = [
            "seeds", "berries", "fruit", "fruits", "insects",
            "invertebrates", "nectar", "fish", "prey", "grubs",
            "worms", "spiders", "arthropods", "vertebrates", "carrion"
        ];

        const hasStrongDietSignal = strongDietSignals.some(signal =>
            text.includes(signal)
        );
        const hasFoodSignal = foodSignals.some(signal =>
            text.includes(signal)
        );

        if (!hasStrongDietSignal) return false;

        // Reject sentences that are clearly about conservation/habitat rather
        // than feeding. This prevents phrases such as "habitat loss" from
        // leaking into Diet when Wikipedia uses broad mixed sections.
        const unrelatedSignals = [
            "habitat loss", "threatened", "threat", "ecoregion",
            "conservation", "protected area", "protected areas",
            "deforestation", "logging", "hunting", "population decline",
            "iucn", "endangered", "vulnerable", "least concern"
        ];

        if (
            unrelatedSignals.some(signal => text.includes(signal)) &&
            !(
                text.includes("diet") ||
                text.includes("feeds") ||
                text.includes("feed on") ||
                text.includes("eats") ||
                text.includes("consumes") ||
                text.includes("food includes")
            )
        ) {
            return false;
        }

        return hasFoodSignal || hasStrongDietSignal;
    }

    return (rules[category] || []).some(group =>
        group.some(keyword => text.includes(keyword))
    );
}

function limitWikipediaSentences(text, maxSentences = 3, maxCharacters = 1800) {
    const sentences = splitWikipediaSentences(text)
        .slice(0, maxSentences);

    let result = "";

    for (const sentence of sentences) {
        const candidate = result ? result + " " + sentence : sentence;

        if (candidate.length > maxCharacters) {
            break;
        }

        result = candidate;
    }

    // If the first sentence itself is unusually long, keep it readable
    // instead of allowing a single Wikipedia paragraph to fill the card.
    if (!result && sentences[0]) {
        result = sentences[0].slice(0, maxCharacters).trim();

        const lastSpace = result.lastIndexOf(" ");
        if (lastSpace > Math.floor(maxCharacters * 0.8)) {
            result = result.slice(0, lastSpace);
        }

        result += "…";
    }

    return result;
}

function isWikipediaNonContentSection(heading) {
    const normalized = String(heading || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();

    if (!normalized) return false;

    // Never treat bibliography/citation/navigation material as biological
    // evidence. Reference-book titles can contain words such as "forest",
    // "range", "habitat", "feeding", etc., which would otherwise trigger the
    // loose sentence classifier below.
    return [
        "references",
        "reference",
        "notes",
        "citations",
        "bibliography",
        "further reading",
        "external links",
        "see also",
        "sources",
        "works cited"
    ].some(blocked => normalized === blocked);
}

function extractWikipediaCategoryText(sections, category, dedicatedHeadings) {
    const values = [];
    const sentences = collectWikipediaSentences(sections);

    for (const [heading, text] of Object.entries(sections || {})) {
        if (!text || heading === "__lead__" || isWikipediaNonContentSection(heading)) continue;

        const isDedicated = dedicatedHeadings.some(candidate =>
            heading === candidate ||
            (
                heading.includes(candidate) &&
                isDedicatedWikipediaHeading(heading, category)
            )
        );

        if (isDedicated) {
            if (category === "diet") {
                // Wikipedia sections such as "Feeding" often mix actual diet
                // with foraging behaviour, habitat, or other ecology details.
                // Keep only sentences that contain clear food/diet evidence.
                for (const sentence of splitWikipediaSentences(text)) {
                    if (wikipediaSentenceMatchesCategory(sentence, category)) {
                        values.push(sentence);
                    }
                }
            } else {
                values.push(text);
            }
        }
    }

    // Do not add sentences from a section that has already supplied its
    // complete text. This prevents the same Wikipedia prose being appended
    // twice.
    for (const item of sentences) {
        if (
            isWikipediaNonContentSection(item.heading) ||
            dedicatedHeadings.some(candidate => item.heading === candidate)
        ) {
            continue;
        }

        if (isDedicatedWikipediaHeading(item.heading, category)) {
            continue;
        }

        if (wikipediaSentenceMatchesCategory(item.sentence, category)) {
            values.push(item.sentence);
        }
    }

    const unique = [...new Set(values)].join(" ");

    // Study Card fields are meant to be concise clues, not a full Wikipedia
    // article. Keep the most relevant first few sentences.
    return limitWikipediaSentences(unique, category === "diet" ? 3 : 4);
}

function extractIucnStatusFromWikipediaValue(rawValue) {
    if (!rawValue) return "";

    let value = String(rawValue)
        .replace(/<!--.*?-->/gs, " ")
        .replace(/<ref[^>]*>.*?<\/ref>/gis, " ")
        .replace(/<ref[^>]*\/>/gi, " ");

    // IUCN status is frequently wrapped in templates such as
    // {{IUCN status|LC}} or {{IUCN3.1|LC}}. Extract the argument before
    // stripping templates so the actual status is not lost.
    const iucnTemplateMatch = value.match(
        /\{\{\s*[^{}]*iucn[^{}]*\|([^{}|]+)(?:\|[^{}]*)?\}\}/i
    );

    if (iucnTemplateMatch?.[1]) {
        value += " " + iucnTemplateMatch[1];
    }

    // Keep template arguments because a status template can contain the
    // actual code/name as its argument.
    value = value
        .replace(/\{\{[^{}]*\}\}/g, " ")
        .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
        .replace(/\[\[([^\]]+)\]\]/g, "$1")
        .replace(/'''?/g, " ")
        .replace(/&nbsp;/gi, " ");

    return normalizeWikipediaText(value);
}

function findWikipediaConservationStatusFromCategories(wikitext) {
    if (!wikitext) return "";

    const categoryMatches = String(wikitext).matchAll(
        /\[\[Category:([^\]]+)\]\]/gi
    );

    const statusPatterns = [
        [/critically\s+endangered/i, "CR"],
        [/endangered/i, "EN"],
        [/vulnerable/i, "VU"],
        [/near\s+threatened/i, "NT"],
        [/least\s+concern/i, "LC"],
        [/data\s+deficient/i, "DD"],
        [/not\s+evaluated/i, "NE"],
        [/extinct\s+in\s+the\s+wild/i, "EW"],
        [/extinct/i, "EX"],
        [/conservation\s+dependent/i, "CD"]
    ];

    for (const match of categoryMatches) {
        const category = String(match[1] || "").replace(/_/g, " ");
        // Only use categories that explicitly describe IUCN/Red List status.
        // This avoids interpreting unrelated categories such as "Endangered
        // birds" as a global IUCN assessment.
        if (!/(?:IUCN|Red List)/i.test(category)) continue;

        for (const [pattern, code] of statusPatterns) {
            if (pattern.test(category)) {
                return code;
            }
        }
    }

    return "";
}

function findWikipediaConservationStatusFromPlainWikitext(wikitext) {
    if (!wikitext) return "";

    const statusNames = [
        ["Critically Endangered", "CR"],
        ["Endangered", "EN"],
        ["Vulnerable", "VU"],
        ["Near Threatened", "NT"],
        ["Least Concern", "LC"],
        ["Data Deficient", "DD"],
        ["Not Evaluated", "NE"],
        ["Extinct in the Wild", "EW"],
        ["Extinct", "EX"],
        ["Conservation Dependent", "CD"]
    ];

    const source = String(wikitext)
        .replace(/<!--[\s\S]*?-->/g, " ")
        .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, " ")
        .replace(/<ref[^>]*\/\s*>/gi, " ");

    // Catch simple infobox fields even when the page uses a non-standard
    // infobox template that the structured template parser does not recognise.
    const fieldPattern =
        /(?:^|\n|\|)\s*(?:status|conservation_status|iucn_status|iucn_red_list)\s*=\s*([^\n|]+)/i;
    const fieldMatch = source.match(fieldPattern);

    if (fieldMatch?.[1]) {
        const value = extractIucnStatusFromWikipediaValue(fieldMatch[1]);
        const codeMatch = value.match(
            /\b(CR|EN|VU|NT|LC|DD|NE|EW|EX|CD)\b/i
        );
        if (codeMatch) return codeMatch[1].toUpperCase();

        for (const [name, code] of statusNames) {
            if (value.toLowerCase().includes(name.toLowerCase())) return code;
        }
    }

    return "";
}

function findWikipediaConservationStatusFromWikitext(wikitext) {
    if (!wikitext) return "";

    const statusNames = [
        ["Critically Endangered", "CR"],
        ["Endangered", "EN"],
        ["Vulnerable", "VU"],
        ["Near Threatened", "NT"],
        ["Least Concern", "LC"],
        ["Data Deficient", "DD"],
        ["Not Evaluated", "NE"],
        ["Extinct in the Wild", "EW"],
        ["Extinct", "EX"],
        ["Conservation Dependent", "CD"]
    ];

    const statusCodes = new Set(statusNames.map(([, code]) => code));

    function readStatus(value) {
        const cleaned = extractIucnStatusFromWikipediaValue(value);

        const codeMatch = cleaned.match(
            /\b(CR|EN|VU|NT|LC|DD|NE|EW|EX|CD)\b/i
        );

        if (codeMatch && statusCodes.has(codeMatch[1].toUpperCase())) {
            return codeMatch[1].toUpperCase();
        }

        for (const [name] of statusNames) {
            if (cleaned.toLowerCase().includes(name.toLowerCase())) {
                return name;
            }
        }

        return "";
    }

    function findTemplateEnd(source, start) {
        let depth = 0;

        for (let i = start; i < source.length - 1; i++) {
            if (source[i] === "{" && source[i + 1] === "{") {
                depth++;
                i++;
            } else if (source[i] === "}" && source[i + 1] === "}") {
                depth--;
                i++;

                if (depth === 0) return i + 1;
            }
        }

        return -1;
    }

    function parseTopLevelFields(templateText) {
        const fields = {};
        let depth = 0;
        let linkDepth = 0;
        let fieldStart = 0;

        const save = field => {
            const separator = field.indexOf("=");

            if (separator < 0) return;

            const key = field
                .slice(0, separator)
                .trim()
                .toLowerCase()
                .replace(/[\s-]+/g, "_");

            if (!key) return;

            fields[key] = field.slice(separator + 1).trim();
        };

        for (let i = 0; i < templateText.length - 1; i++) {
            if (templateText[i] === "{" && templateText[i + 1] === "{") {
                depth++;
                i++;
                continue;
            }

            if (templateText[i] === "}" && templateText[i + 1] === "}") {
                depth = Math.max(0, depth - 1);
                i++;
                continue;
            }

            if (templateText[i] === "[" && templateText[i + 1] === "[") {
                linkDepth++;
                i++;
                continue;
            }

            if (templateText[i] === "]" && templateText[i + 1] === "]") {
                linkDepth = Math.max(0, linkDepth - 1);
                i++;
                continue;
            }

            if (templateText[i] === "|" && depth === 0 && linkDepth === 0) {
                save(templateText.slice(fieldStart, i));
                fieldStart = i + 1;
            }
        }

        save(templateText.slice(fieldStart));
        return fields;
    }

    const templatePattern =
        /\{\{\s*(speciesbox|subspeciesbox|infobox\b[^|\n]*|taxobox|automatic\s+taxobox)\b/i;

    let cursor = 0;

    while (cursor < wikitext.length) {
        const relative = wikitext.slice(cursor).search(templatePattern);
        if (relative < 0) break;

        const start = cursor + relative;
        const end = findTemplateEnd(wikitext, start);

        if (end < 0) break;

        const template = wikitext.slice(start, end);
        const fields = parseTopLevelFields(template);

        // Wikipedia bird pages generally expose exactly this pair:
        //   | status = LC
        //   | status_system = IUCN3.1
        //
        // Do not require status_system to exist, because some valid older
        // pages only retain the status field.
        const statusKeys = [
            "status",
            "conservation_status",
            "iucn_status",
            "iucn_red_list"
        ];

        for (const key of statusKeys) {
            if (!fields[key]) continue;

            const status = readStatus(fields[key]);
            if (status) return status;
        }

        for (const [key, value] of Object.entries(fields)) {
            if (!/iucn/i.test(key)) continue;

            const status = readStatus(value);
            if (status) return status;
        }

        cursor = end;
    }

    return "";
}

function findWikipediaConservationStatus(html) {
    if (!html) return "";

    const documentRoot = new DOMParser().parseFromString(html, "text/html");

    // Wikipedia bird infoboxes are not completely uniform. Depending on the
    // page/template, the rendered table may have .infobox, .infobox-label,
    // plain <th>/<td> cells, or another table class. Do NOT require a
    // particular CSS class here. We only accept a status when it is associated
    // with IUCN inside the same table.
    const tables = documentRoot.querySelectorAll("table");

    for (const table of tables) {
        const tableText = normalizeWikipediaText(table.textContent);
        if (!/IUCN/i.test(tableText)) continue;

        const rows = table.querySelectorAll("tr");

        for (const row of rows) {
            const cells = [...row.children].filter(cell =>
                /^(TH|TD)$/i.test(cell.tagName)
            );

            if (cells.length < 2) continue;

            const cellTexts = cells.map(cell =>
                normalizeWikipediaText(cell.textContent)
            );

            for (let index = 0; index < cellTexts.length - 1; index++) {
                const label = cellTexts[index].toLowerCase();

                const isStatusLabel =
                    /^(?:conservation\s+status|iucn\s+status|iucn\s+red\s+list|status)$/.test(label) ||
                    /^status\s+(?:system|ref|reference|assessment)/.test(label);

                if (!isStatusLabel) continue;

                // "Status System: IUCN3.1" is metadata, not the actual status.
                if (/^status\s+system/.test(label)) continue;

                const value = cellTexts.slice(index + 1).join(" ").trim();
                if (value) return value;
            }
        }
    }

    // Second pass for infobox layouts where the label/value relationship is
    // represented by arbitrary elements rather than a normal table row.
    const labels = documentRoot.querySelectorAll(
        ".infobox-label, .infobox-label-title, [class*=\"infobox-label\"]"
    );

    for (const labelElement of labels) {
        const label = normalizeWikipediaText(labelElement.textContent)
            .toLowerCase();

        if (!/^(?:conservation\s+status|iucn\s+status|iucn\s+red\s+list|status)$/.test(label)) {
            continue;
        }

        const container = labelElement.parentElement;
        const valueElement =
            container?.querySelector(".infobox-data, [class*=\"infobox-data\"]") ||
            labelElement.nextElementSibling;

        const value = normalizeWikipediaText(valueElement?.textContent || "");
        const surroundingTable = labelElement.closest("table");
        const surroundingText = normalizeWikipediaText(
            surroundingTable?.textContent || ""
        );

        if (value && /IUCN/i.test(surroundingText)) {
            return value;
        }
    }

    return "";
}

function formatWikipediaConservationStatus(rawValue) {
    const value = normalizeWikipediaText(rawValue || "");
    if (!value) return "";

    const normalized = value
        .replace(/\bIUCN(?:\s+Red\s+List)?(?:\s+version\s+3\.1)?\b/gi, "")
        .replace(/\bIUCN\s*3\.1\b/gi, "")
        .replace(/\s+/g, " ")
        .trim();

    const codeMatch = normalized.match(
        /\b(CR|EN|VU|NT|LC|DD|NE|EW|EX|CD)\b/i
    );

    const statusNames = [
        ["Critically Endangered", "CR"],
        ["Endangered", "EN"],
        ["Vulnerable", "VU"],
        ["Near Threatened", "NT"],
        ["Least Concern", "LC"],
        ["Data Deficient", "DD"],
        ["Not Evaluated", "NE"],
        ["Extinct in the Wild", "EW"],
        ["Extinct", "EX"],
        ["Conservation Dependent", "CD"]
    ];

    let statusName = "";
    let statusCode = codeMatch?.[1]?.toUpperCase() || "";

    for (const [name, code] of statusNames) {
        if (normalized.toLowerCase().includes(name.toLowerCase())) {
            statusName = name;
            if (!statusCode) statusCode = code;
            break;
        }
    }

    if (!statusName && statusCode) {
        const match = statusNames.find(([, code]) => code === statusCode);
        statusName = match?.[0] || "";
    }

    if (statusCode && statusName) {
        return statusCode + " - " + statusName;
    }

    return "";
}

function extractWikipediaWikitextSection(wikitext, candidates) {
    if (!wikitext) return "";

    const normalizedCandidates = candidates.map(candidate =>
        normalizeWikipediaText(candidate).toLowerCase()
    );

    const lines = String(wikitext).replace(/\r/g, "").split("\n");

    const headingRegex = /^(={2,6})\s*(.*?)\s*\1\s*$/;
    let bestText = "";
    let bestScore = -1;

    for (let i = 0; i < lines.length; i++) {
        const match = lines[i].match(headingRegex);
        if (!match) continue;

        const level = match[1].length;
        const heading = normalizeWikipediaText(match[2])
            .replace(/\[edit\]/gi, "")
            .toLowerCase();

        let score = -1;
        for (let j = 0; j < normalizedCandidates.length; j++) {
            const candidate = normalizedCandidates[j];
            if (heading === candidate) {
                score = 1000 - j;
                break;
            }
            if (heading.includes(candidate)) {
                score = 500 - j;
            }
        }

        if (score < 0) continue;

        const body = [];
        for (let j = i + 1; j < lines.length; j++) {
            const next = lines[j].match(headingRegex);
            if (next && next[1].length <= level) break;
            body.push(lines[j]);
        }

        let text = body.join("\n");

        // Remove references, comments, files, templates and wiki markup.
        text = text
            .replace(/<!--(?:.|\n)*?-->/gs, " ")
            .replace(/<ref(?:\s[^>]*)?>[\s\S]*?<\/ref>/gi, " ")
            .replace(/<ref\s*\/\s*>/gi, " ")
            .replace(/<[^>]+>/g, " ")
            .replace(/\[\[(?:File|Image):[^\]]+\]\]/gi, " ")
            .replace(/\{\{[\s\S]*?\}\}/g, " ")
            .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
            .replace(/\[\[([^\]]+)\]\]/g, "$1")
            .replace(/\[\[[^\]]+\]\]/g, " ")
            .replace(/'{2,}/g, "")
            .replace(/&nbsp;/gi, " ");

        text = normalizeWikipediaText(text);

        if (text && score > bestScore) {
            bestText = text;
            bestScore = score;
        }
    }

    return bestText;
}

function getWikipediaStudyData(html, wikitext = "") {
    const sections = extractWikipediaSections(html);
    const lead = sections.__lead__ || "";
    const leadSentences = splitWikipediaSentences(lead);

    const wikipediaIucnStatus = formatWikipediaConservationStatus(
        findWikipediaConservationStatus(html) ||
        findWikipediaConservationStatusFromWikitext(wikitext) ||
        findWikipediaConservationStatusFromPlainWikitext(wikitext) ||
        findWikipediaConservationStatusFromCategories(wikitext)
    );

    const data = {
        sections,

        description: limitWikipediaSentences(
            findWikipediaSection(sections, [
                "description",
                "description and identification",
                "description and appearance",
                "appearance",
                "identification"
            ]) || lead,
            7,
            1800
        ),

        habitatDistribution: extractWikipediaCategoryText(
            sections,
            "habitatDistribution",
            [
                "distribution and habitat",
                "habitat and distribution",
                "habitat",
                "distribution",
                "range",
                "geographic range",
                "ecology and habitat"
            ]
        ),

        diet: extractWikipediaCategoryText(sections, "diet", [
            "diet",
            "feeding",
            "food and feeding",
            "feeding ecology",
            "food"
        ]),

        behavior: extractWikipediaCategoryText(sections, "behavior", [
            "behavior",
            "behaviour",
            "behavior and ecology",
            "behaviour and ecology",
            "ecology"
        ]),

        breeding: extractWikipediaCategoryText(sections, "breeding", [
            "breeding",
            "reproduction",
            "nesting",
            "breeding biology",
            "reproductive behavior",
            "reproductive behaviour"
        ]),

        // Prefer the article's actual conservation/status section because
        // Wikipedia bird pages commonly put the useful conservation detail
        // in prose rather than the infobox. Fall back to the infobox only
        // when no relevant conservation section exists.
        // Prefer the explicit IUCN status when Wikipedia provides it in
        // the infobox or categories. This prevents a generic conservation
        // paragraph from hiding a clearly available "LC - Least Concern",
        // "VU - Vulnerable", etc. status.
        conservation: wikipediaIucnStatus ||
            limitWikipediaSentences(
                extractWikipediaWikitextSection(wikitext, [
                    "conservation status",
                    "habitat and conservation status",
                    "habitat and conservation",
                    "status and conservation",
                    "status and threats",
                    "status",
                    "conservation",
                    "threats"
                ]),
                3
            ) || limitWikipediaSentences(
                findWikipediaSection(sections, [
                    "conservation status",
                    "habitat and conservation status",
                    "habitat and conservation",
                    "status and conservation",
                    "status and threats",
                    "status",
                    "conservation",
                    "threats"
                ]),
                3
            )
    };

    // Very short Wikipedia articles sometimes have no content sections at
    // all. Their useful information lives entirely in the lead paragraph.
    // Classify those lead sentences individually so habitat and conservation
    // clues are still available without inventing information for diet,
    // behaviour, or breeding.
    const leadMatches = category => leadSentences.filter(sentence =>
        wikipediaSentenceMatchesCategory(sentence, category)
    );

    if (!data.habitatDistribution) {
        data.habitatDistribution =
            leadMatches("habitatDistribution").slice(0, 2).join(" ");
    }

    if (!data.diet) {
        data.diet =
            leadMatches("diet").slice(0, 3).join(" ");
    }

    if (!data.behavior) {
        data.behavior =
            leadMatches("behavior").slice(0, 3).join(" ");
    }

    if (!data.breeding) {
        data.breeding =
            leadMatches("breeding").slice(0, 3).join(" ");
    }

    // Conservation is read from a dedicated Wikipedia conservation/status
    // section first, with the infobox as a fallback. We do not invent a
    // status from unrelated prose such as ordinary population or habitat text.

    return data;
}


function cleanWikipediaTaxonomyValue(value) {
    if (!value) return "";

    let cleaned = String(value)
        .replace(/<!--[\s\S]*?-->/g, " ")
        .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, " ")
        .replace(/<ref[^>]*\/>/gi, " ")
        .replace(/<br\s*\/?>/gi, " ")
        .replace(/\{\{[\s\S]*?\}\}/g, " ")
        .replace(/\[\[([^|\]]+)\|([^\]]+)\]\]/g, "$2")
        .replace(/\[\[([^\]]+)\]\]/g, "$1")
        .replace(/<[^>]+>/g, " ")
        .replace(/'{2,}/g, "")
        .replace(/&nbsp;/gi, " ")
        .replace(/\s+/g, " ")
        .trim();

    // Taxobox fields sometimes contain a trailing citation or parenthetical
    // reference marker. Keep the taxon name itself, not the citation markup.
    cleaned = cleaned.replace(/\s*\[[0-9]+\]\s*$/g, "").trim();

    return cleaned;
}

function parseWikipediaDetailedTaxonomy(wikitext) {
    if (!wikitext) return {};

    function findTemplateEnd(source, start) {
        let depth = 0;

        for (let i = start; i < source.length - 1; i++) {
            if (source[i] === "{" && source[i + 1] === "{") {
                depth++;
                i++;
            } else if (source[i] === "}" && source[i + 1] === "}") {
                depth--;
                i++;

                if (depth === 0) return i + 1;
            }
        }

        return -1;
    }

    function parseFields(templateText) {
        const fields = {};
        let depth = 0;
        let linkDepth = 0;
        let fieldStart = 0;

        const save = field => {
            const separator = field.indexOf("=");
            if (separator < 0) return;

            const key = field
                .slice(0, separator)
                .trim()
                .toLowerCase()
                .replace(/[\s-]+/g, "_");

            if (!key) return;
            fields[key] = field.slice(separator + 1).trim();
        };

        for (let i = 0; i < templateText.length - 1; i++) {
            if (templateText[i] === "{" && templateText[i + 1] === "{") {
                depth++;
                i++;
                continue;
            }

            if (templateText[i] === "}" && templateText[i + 1] === "}") {
                depth = Math.max(0, depth - 1);
                i++;
                continue;
            }

            if (templateText[i] === "[" && templateText[i + 1] === "[") {
                linkDepth++;
                i++;
                continue;
            }

            if (templateText[i] === "]" && templateText[i + 1] === "]") {
                linkDepth = Math.max(0, linkDepth - 1);
                i++;
                continue;
            }

            if (templateText[i] === "|" && depth === 0 && linkDepth === 0) {
                save(templateText.slice(fieldStart, i));
                fieldStart = i + 1;
            }
        }

        save(templateText.slice(fieldStart));
        return fields;
    }

    // These are the useful intermediate ranks between the broad AviList
    // order/family/genus levels. We deliberately do not treat every possible
    // informal grouping as a taxonomic rank.
    const rankDefinitions = [
        ["subclass", "Subclass"],
        ["infraclass", "Infraclass"],
        ["superorder", "Superorder"],
        ["clade", "Clade"],
        ["suborder", "Suborder"],
        ["infraorder", "Infraorder"],
        ["parvorder", "Parvorder"],
        ["superfamily", "Superfamily"],
        ["subfamily", "Subfamily"],
        ["tribe", "Tribe"],
        ["subtribe", "Subtribe"]
    ];

    const templatePattern =
        /\{\{\s*(speciesbox|subspeciesbox|infobox\b[^|\n]*|taxobox|automatic\s+taxobox)\b/i;

    let cursor = 0;

    while (cursor < wikitext.length) {
        const relative = wikitext.slice(cursor).search(templatePattern);
        if (relative < 0) break;

        const start = cursor + relative;
        const end = findTemplateEnd(wikitext, start);
        if (end < 0) break;

        const template = wikitext.slice(start, end);
        const fields = parseFields(template);

        const result = {};
        let found = false;

        for (const [field, label] of rankDefinitions) {
            const value = cleanWikipediaTaxonomyValue(fields[field]);
            if (!value) continue;

            result[field] = {
                rank: field,
                label,
                name: value
            };
            found = true;
        }

        // Wikipedia taxoboxes can expose several phylogenetic clades as
        // clade, clade1, clade2, ... . Keep every one as its own entry.
        Object.keys(fields)
            .filter(field => /^clade\\d*$/i.test(field))
            .sort((a, b) => {
                const aNumber = a.toLowerCase() === "clade"
                    ? 0
                    : Number(a.replace(/[^0-9]/g, "")) || 0;
                const bNumber = b.toLowerCase() === "clade"
                    ? 0
                    : Number(b.replace(/[^0-9]/g, "")) || 0;
                return aNumber - bNumber;
            })
            .forEach(field => {
                const value = cleanWikipediaTaxonomyValue(fields[field]);
                if (!value) return;

                const key = field.toLowerCase();
                result[key] = {
                    rank: "clade",
                    label: "Clade",
                    name: value
                };
                found = true;
            });

        if (found) return result;

        cursor = end;
    }

    return {};
}


async function fetchWikidataDetailedTaxonomy(bird) {
    const scientificName = String(bird?.scientificName || "").trim();
    if (!scientificName) return {};

    const cacheKey = "wikidata-taxonomy:" + scientificName.toLowerCase();
    gameState.wikipediaCache ||= new Map();
    const cached = gameState.wikipediaCache.get(cacheKey);
    if (cached?.detailedTaxonomy) return cached.detailedTaxonomy;

    // Wikidata's P105/P171 pair is particularly useful here: P105 tells us
    // the actual rank of a taxon and P171 links it to its closest parent.
    // This lets MetaAves recover intermediate ranks that AviList deliberately
    // does not publish, including superfamily and subfamily.
    const rankLabels = new Map([
        ["subclass", "Subclass"],
        ["infraclass", "Infraclass"],
        ["superorder", "Superorder"],
        ["order", "Order"],
        ["suborder", "Suborder"],
        ["infraorder", "Infraorder"],
        ["parvorder", "Parvorder"],
        ["superfamily", "Superfamily"],
        ["family", "Family"],
        ["subfamily", "Subfamily"],
        ["tribe", "Tribe"],
        ["subtribe", "Subtribe"],
        ["supertribe", "Supertribe"],
        ["genus", "Genus"],
        ["subgenus", "Subgenus"],
        ["species", "Species"]
    ]);

    const normalizeRank = value =>
        String(value || "")
            .toLowerCase()
            .replace(/[^a-z]/g, "");

    const canonicalRankFromLabel = value => {
        const normalized = normalizeRank(value);
        if (!normalized) return null;

        for (const rank of rankLabels.keys()) {
            if (normalized === normalizeRank(rank)) return rank;
        }

        return null;
    };

    async function fetchEntity(entityId) {
        if (!entityId) return null;

        const entityUrl =
            "https://www.wikidata.org/w/api.php?" +
            new URLSearchParams({
                action: "wbgetentities",
                ids: entityId,
                props: "claims|labels",
                languages: "en",
                format: "json",
                origin: "*"
            }).toString();

        const response = await fetch(entityUrl);
        if (!response.ok) return null;

        const data = await response.json();
        return data?.entities?.[entityId] || null;
    }

    async function fetchExactEntityId(label) {
        const search = String(label || "").trim();
        if (!search) return null;

        const searchUrl =
            "https://www.wikidata.org/w/api.php?" +
            new URLSearchParams({
                action: "wbsearchentities",
                search,
                language: "en",
                uselang: "en",
                type: "item",
                limit: "10",
                format: "json",
                origin: "*"
            }).toString();

        const response = await fetch(searchUrl);
        if (!response.ok) return null;

        const data = await response.json();
        const candidates = data?.search || [];

        return (
            candidates.find(
                item =>
                    String(item?.label || "").trim().toLowerCase() ===
                    search.toLowerCase()
            )?.id || null
        );
    }

    async function collectParentChain(entityId, rows) {
        let currentId = entityId;
        const visited = new Set();

        for (
            let depth = 0;
            depth < 30 && currentId && !visited.has(currentId);
            depth++
        ) {
            visited.add(currentId);

            const entity = await fetchEntity(currentId);
            if (!entity) break;

            const rankClaims = entity.claims?.P105 || [];
            const orderedRankClaims = [
                ...rankClaims.filter(claim => claim?.rank === "preferred"),
                ...rankClaims.filter(claim => claim?.rank === "normal"),
                ...rankClaims.filter(claim => claim?.rank === "deprecated")
            ];

            const rankId = orderedRankClaims
                .map(claim => claim?.mainsnak?.datavalue?.value?.id)
                .find(Boolean);

            if (rankId) {
                const rankEntity = await fetchEntity(rankId);
                const rankName =
                    rankEntity?.labels?.en?.value || "";

                const canonicalRank = canonicalRankFromLabel(rankName);

                if (
                    canonicalRank &&
                    !rows.some(row => row.rank === canonicalRank)
                ) {
                    rows.push({
                        rank: canonicalRank,
                        label: rankLabels.get(canonicalRank),
                        name:
                            entity.labels?.en?.value ||
                            entityId
                    });
                }
            }

            const parentClaims = entity.claims?.P171 || [];
            const orderedParents = [
                ...parentClaims.filter(claim => claim?.rank === "preferred"),
                ...parentClaims.filter(claim => claim?.rank === "normal"),
                ...parentClaims.filter(claim => claim?.rank === "deprecated")
            ];

            const parentId = orderedParents
                .map(claim => claim?.mainsnak?.datavalue?.value?.id)
                .find(Boolean);

            if (!parentId || parentId === currentId) break;
            currentId = parentId;
        }
    }

    try {
        // First follow the bird itself. This is the normal path and preserves
        // the most specific classification available for the species.
        const entityId = await fetchExactEntityId(scientificName);
        if (!entityId) return {};

        const rows = [];
        await collectParentChain(entityId, rows);

        // A species chain can legitimately stop at a family when Wikidata
        // does not model that family's intermediate ranks. In that case,
        // follow the family item separately so the family can contribute
        // superfamily/subfamily information without inventing a rank.
        const hasSuperfamily = rows.some(row => row.rank === "superfamily");
        const hasSubfamily = rows.some(row => row.rank === "subfamily");

        if (
            (!hasSuperfamily || !hasSubfamily) &&
            bird?.family
        ) {
            const familyId = await fetchExactEntityId(bird.family);

            if (familyId) {
                await collectParentChain(familyId, rows);
            }

            // Wikipedia family pages are a second independent fallback.
            // They often expose a superfamily/subfamily in the taxobox even
            // when the individual species page does not.
            if (!rows.some(row => row.rank === "superfamily") ||
                !rows.some(row => row.rank === "subfamily")) {
                try {
                    const familyWiki = await fetchWikipediaPageData(
                        bird.family,
                        true,
                        "bird"
                    );
                    const familyDetailed = parseWikipediaDetailedTaxonomy(
                        familyWiki?.wikitext || ""
                    );

                    ["superfamily", "subfamily", "tribe", "subtribe"].forEach(
                        rank => {
                            const entry = familyDetailed?.[rank];
                            if (!entry?.name) return;

                            if (!rows.some(row => row.rank === rank)) {
                                rows.push({
                                    rank,
                                    label: rankLabels.get(rank),
                                    name: entry.name
                                });
                            }
                        }
                    );
                } catch (error) {
                    console.warn(
                        "Family Wikipedia taxonomy fallback failed:",
                        bird.family,
                        error
                    );
                }
            }
        }

        const ordered = rows.reverse();

        const detailed = {};
        for (const row of ordered) {
            detailed[row.rank] = {
                rank: row.rank,
                label: row.label,
                name: row.name
            };
        }

        gameState.wikipediaCache.set(cacheKey, {
            detailedTaxonomy: detailed
        });

        return detailed;
    } catch (error) {
        console.warn(
            "Wikidata detailed taxonomy lookup failed:",
            scientificName,
            error
        );
        return {};
    }
}

function mergeDetailedTaxonomyRows(bird, wiki, wikidataDetailed = {}) {
    const rows = [];
    const seenValues = new Set();

    const wikipediaDetailed = parseWikipediaDetailedTaxonomy(wiki?.wikitext);
    const detailed = {
        ...wikipediaDetailed,
        ...(bird?.wikipediaDetailedTaxonomy || {}),
        ...wikidataDetailed
    };

    const rankByName = new Map();

    // The generated clade catalog is the authoritative source for the
    // formal rank of named phylogenetic groups. Wikipedia/Wikidata often
    // calls these groups simply "clade", even when MetaAves deliberately
    // models them as a formal rank (for example Neognathae, Passeri,
    // Passerides and Passerida).
    Object.values(gameState.clades || {}).forEach(entry => {
        if (!entry?.name || !entry?.rank) return;

        const key = String(entry.name).trim().toLowerCase();
        rankByName.set(key, {
            name: entry.name,
            rank: entry.rank,
            label:
                entry.rank === "infraclass"
                    ? "Infraclass"
                    : entry.rank === "suborder"
                        ? "Suborder"
                        : entry.rank === "infraorder"
                            ? "Infraorder"
                            : entry.rank === "parvorder"
                                ? "Parvorder"
                                : entry.rank === "superfamily"
                                    ? "Superfamily"
                                    : entry.rank === "subfamily"
                                        ? "Subfamily"
                                        : entry.rank === "tribe"
                                            ? "Tribe"
                                            : entry.rank === "subtribe"
                                                ? "Subtribe"
                                                : "Clade"
        });
    });

    // Add Wikipedia/Wikidata metadata only when the generated clade catalog
    // does not already define that name. This prevents a generic Wikipedia
    // "clade" label from overwriting a formal MetaAves rank.
    Object.values(detailed).forEach(entry => {
        if (!entry?.name || !entry?.label) return;

        const key = String(entry.name).trim().toLowerCase();

        if (!rankByName.has(key)) {
            rankByName.set(key, entry);
            return;
        }

        const existing = rankByName.get(key);
        if (existing.rank === "clade" && entry.rank !== "clade") {
            rankByName.set(key, entry);
        }
    });

    const add = (label, value) => {
        const cleaned = cleanWikipediaTaxonomyValue(value);
        if (!cleaned) return;

        const key = cleaned.toLowerCase();
        if (seenValues.has(key)) return;

        seenValues.add(key);
        rows.push([label, cleaned]);
    };

    const addTaxon = (value, fallbackLabel = "Clade") => {
        const cleaned = cleanWikipediaTaxonomyValue(value);
        if (!cleaned) return;

        const entry = rankByName.get(cleaned.toLowerCase());
        add(entry?.label || fallbackLabel, cleaned);
    };

    // Keep the taxonomy in biological order. The important difference from
    // the old renderer is that every name uses its actual rank metadata.
    add("Class", bird?.class || "Aves");

    for (const rank of ["subclass", "infraclass", "superorder"]) {
        const entry = detailed[rank];
        if (entry?.name) add(entry.label, entry.name);
    }

    // The generated clade backbone contains the complete phylogenetic path.
    // If Wikidata says a member is actually an infraclass/suborder/etc.,
    // addTaxon() uses that real rank instead of calling it "Clade".
    [
        ...(bird?.cladePath || []),
    ].forEach(name => addTaxon(name));

    add("Order", bird?.order || detailed.order?.name);

    [
        ...(bird?.postOrderCladePath || [])
    ].forEach(name => addTaxon(name));

    for (const rank of [
        "suborder",
        "infraorder",
        "parvorder",
        "superfamily"
    ]) {
        const entry = detailed[rank];
        if (entry?.name) add(entry.label, entry.name);
    }

    add("Family", bird?.family || detailed.family?.name);

    for (const rank of ["subfamily", "tribe", "subtribe"]) {
        const entry = detailed[rank];
        if (entry?.name) add(entry.label, entry.name);
    }

    add("Genus", bird?.genus || detailed.genus?.name);

    // Keep a formally recognized subgenus when a detailed source provides
    // one. AviList does not currently publish this intermediary rank.
    const subgenus = detailed.subgenus;
    if (subgenus?.name) {
        add(subgenus.label || "Subgenus", subgenus.name);
    }

    add(
        "Species",
        bird?.species || bird?.scientificName || detailed.species?.name
    );

    return rows;
}

function getDetailedSpeciesTaxonomyRows(bird, wiki, wikidataDetailed = {}) {
    return mergeDetailedTaxonomyRows(bird, wiki, wikidataDetailed);
}

function renderSpeciesTaxonomyRows(container, bird, wiki, wikidataDetailed = {}) {
    if (!container || !bird) return;

    container.innerHTML = "";

    mergeDetailedTaxonomyRows(bird, wiki, wikidataDetailed).forEach(([label, value]) => {
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
        container.appendChild(row);
    });
}

function attachDetailedTaxonomyToBird(bird, wiki) {
    if (!bird || !wiki?.wikitext) return;

    const detailed = parseWikipediaDetailedTaxonomy(wiki.wikitext);
    if (Object.keys(detailed).length) {
        bird.wikipediaDetailedTaxonomy = detailed;
    }
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

function appendTaxonCardPhoto(card, wiki) {
    if (!card || !wiki?.summary?.thumbnail?.source) return;

    const wrapper = document.createElement("div");
    wrapper.className = "taxon-card-photo";

    const image = document.createElement("img");
    image.className = "taxon-card-image";
    image.src = wiki.summary.thumbnail.source;
    image.alt = wiki.summary.title || "";
    image.loading = "lazy";

    wrapper.appendChild(image);
    card.appendChild(wrapper);
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
    const requestId = ++gameState.taxonCardRequestId;

    card.innerHTML = "<p>Loading bird information…</p>";
    card.classList.remove("clade-card");
    card.classList.add("species-card");

    // Render from local data + the lightweight Wikipedia summary first.
    // Full article parsing and Wikidata enrichment happen after the card is
    // already usable.
    const wikiSummary = await fetchWikipediaPageData(
        bird.wikipediaTitle || bird.commonName,
        false,
        "bird",
        bird.scientificName,
        true
    );

    if (
        gameState.selectedTaxonId !== selectionId ||
        gameState.taxonCardRequestId !== requestId
    ) return;

    renderBirdCard(
        bird,
        wikiSummary,
        {},
        gameState.mode === "thailand" ? (bird.thaiName || "") : ""
    );

    // Enrich the already-visible card in the background.
    Promise.all([
        fetchWikipediaPageData(
            bird.wikipediaTitle || bird.commonName,
            true,
            "bird",
            bird.scientificName,
            true
        ),
        fetchWikidataDetailedTaxonomy(bird),
        gameState.mode === "thailand"
            ? fetchOnlineThaiName(bird)
            : Promise.resolve("")
    ]).then(([wiki, wikidataDetailed, thaiName]) => {
        if (
            gameState.selectedTaxonId !== selectionId ||
            gameState.taxonCardRequestId !== requestId
        ) return;

        const displayThaiName =
            gameState.mode === "thailand"
                ? (thaiName || bird.thaiName || "")
                : "";

        if (displayThaiName) bird.thaiName = displayThaiName;
        attachDetailedTaxonomyToBird(bird, wiki);

        renderBirdCard(
            bird,
            wiki || wikiSummary,
            wikidataDetailed || {},
            displayThaiName
        );
    }).catch(error => {
        console.warn("Bird taxon enrichment failed:", error);
    });
}

function renderBirdCard(
    bird,
    wiki,
    wikidataDetailed = {},
    thaiName = bird?.thaiName || ""
) {
    const card = document.getElementById("taxon-card");
    if (!card) return;

    card.innerHTML = "";
    card.classList.remove("species-card", "clade-card");
    card.classList.add("species-card");

    const title = document.createElement("h3");
    title.textContent = bird.commonName;
    card.appendChild(title);

    if (gameState.mode === "thailand") {
        const thai = document.createElement("p");
        thai.classList.add("taxon-card-thai-name");
        thai.textContent = thaiName || "Thai name unavailable";
        card.appendChild(thai);
    }

    const scientific = document.createElement("p");
    scientific.classList.add("taxon-card-rank", "taxon-card-scientific");
    scientific.textContent = bird.scientificName || "Scientific name unavailable";
    card.appendChild(scientific);

    const rank = document.createElement("p");
    rank.classList.add("taxon-card-rank", "taxon-card-species-rank");
    rank.textContent = "SPECIES";
    card.appendChild(rank);

    const hasWikiSummary = Boolean(wiki?.summary?.extract);
    const description = hasWikiSummary
        ? limitWikipediaSentences(wiki.summary.extract, 6, 1400)
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

    const taxonomyRows = getDetailedSpeciesTaxonomyRows(
        bird,
        wiki,
        wikidataDetailed
    );

    const columnCount = 2;
    const rowsPerColumn = Math.ceil(taxonomyRows.length / columnCount);

    for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
        const column = document.createElement("div");
        column.className = "taxon-card-taxonomy-column";

        taxonomyRows
            .slice(
                columnIndex * rowsPerColumn,
                (columnIndex + 1) * rowsPerColumn
            )
            .forEach(([label, value]) => {
                const row = document.createElement("p");
                row.className = "taxon-card-taxonomy-row";

                const labelElement = document.createElement("strong");
                labelElement.textContent = label + ": ";

                row.appendChild(labelElement);
                row.appendChild(document.createTextNode(value));
                column.appendChild(row);
            });

        taxonomySection.appendChild(column);
    }

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

    card.classList.remove("species-card", "clade-card");

    gameState.selectedTaxonId = taxon.id;
    const selectionId = taxon.id;
    const requestId = ++gameState.taxonCardRequestId;

    if (taxon.rank === "clade") {
        card.classList.add("clade-card");
        card.innerHTML = "<p>Loading clade information from Wikipedia...</p>";

        // Clade cards only use Wikipedia's top section, image, and link.
        // Avoid downloading the full article HTML.
        const wiki = await fetchWikipediaPageData(
            getWikipediaTitleFromTaxon(taxon, {}),
            false,
            "taxon",
            "",
            true
        );

        if (
            gameState.selectedTaxonId !== selectionId ||
            gameState.taxonCardRequestId !== requestId
        ) return;
        renderCladeCard(taxon, wiki);
        return;
    }

    renderTaxonCard(taxon);

    const info = gameState.taxonInfo?.[taxon.id] || {};
    const wikiTitle = getWikipediaTitleFromTaxon(taxon, info);
    const wiki = await fetchWikipediaPageData(
        wikiTitle,
        true,
        taxon.rank === "species" ? "bird" : "taxon",
        taxon.rank === "species" ? taxon.scientificName : "",
        true
    );

    if (
        gameState.selectedTaxonId !== selectionId ||
        gameState.taxonCardRequestId !== requestId
    ) return;

    // Remove dynamic content from the previous selection BEFORE building
    // the current species taxonomy. Otherwise the cleanup would delete the
    // taxonomy we just created.
    card.querySelectorAll(
        ".taxon-card-image, .taxon-card-wikipedia-link, [data-taxon-card-dynamic='true']"
    ).forEach(element => element.remove());

    if (taxon.rank === "species") {
        card.classList.add("species-card");

        const [wikidataDetailed, thaiName] = await Promise.all([
            fetchWikidataDetailedTaxonomy(taxon),
            gameState.mode === "thailand"
                ? fetchOnlineThaiName(taxon)
                : Promise.resolve("")
        ]);

        const displayThaiName =
            gameState.mode === "thailand"
                ? (thaiName || taxon.thaiName || "")
                : "";

        if (displayThaiName) taxon.thaiName = displayThaiName;
        attachDetailedTaxonomyToBird(taxon, wiki);

        // The dynamic Thai-name line belongs only to Thailand mode.
        if (gameState.mode === "thailand") {
            const title = card.querySelector("h3");
            if (title) {
                const thai = document.createElement("p");
                thai.className = "taxon-card-thai-name";
                thai.textContent = displayThaiName || "Thai name unavailable";
                title.insertAdjacentElement("afterend", thai);
            }
        }

        const description = card.querySelector(".taxon-card-description");
        if (description) {
            description.textContent =
                limitWikipediaSentences(
                    wiki?.summary?.extract || "",
                    6,
                    1400
                ) ||
                "No information available on Wikipedia.";
        }

        const taxonomySection = document.createElement("div");
        taxonomySection.className =
            "taxon-card-wiki-section taxon-card-species-taxonomy";
        taxonomySection.dataset.taxonCardDynamic = "true";

        const heading = document.createElement("h4");
        heading.textContent = "Taxonomy";
        taxonomySection.appendChild(heading);

        const taxonomyRows = mergeDetailedTaxonomyRows(
            taxon,
            wiki,
            wikidataDetailed
        );

        const columnCount = 2;
        const rowsPerColumn = Math.ceil(taxonomyRows.length / columnCount);

        for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
            const column = document.createElement("div");
            column.className = "taxon-card-taxonomy-column";

            taxonomyRows
                .slice(
                    columnIndex * rowsPerColumn,
                    (columnIndex + 1) * rowsPerColumn
                )
                .forEach(([label, value]) => {
                    const row = document.createElement("p");
                    row.className = "taxon-card-taxonomy-row";

                    const labelElement = document.createElement("strong");
                    labelElement.textContent = label + ": ";

                    row.appendChild(labelElement);
                    row.appendChild(document.createTextNode(value));
                    column.appendChild(row);
                });

            taxonomySection.appendChild(column);
        }

        card.appendChild(taxonomySection);
    }

    const description = card.querySelector(".taxon-card-description");
    if (description) {
        description.textContent =
            limitWikipediaSentences(
                wiki?.summary?.extract || "",
                6,
                1400
            ) ||
            "No information available on Wikipedia.";
    }

    if (wiki?.summary?.thumbnail?.source) {
        const photo = document.createElement("div");
        photo.className = "taxon-card-photo";

        const image = document.createElement("img");
        image.className = "taxon-card-image";
        image.src = wiki.summary.thumbnail.source;
        image.alt = wiki.summary.title || taxon.name;
        image.loading = "lazy";

        photo.appendChild(image);
        card.insertBefore(photo, description || null);
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

    // Detailed ranked nodes such as subfamily/tribe/suborder can come from
    // Wikipedia/Wikidata enrichment rather than the compact generated
    // AviList taxonomy. They are still real clickable tree taxa, so create a
    // lightweight taxon record when they are not present in the main catalog.
    if (!taxon && node.taxonId && node.name) {
        taxon = {
            id: node.taxonId,
            name: node.name,
            rank: node.level || "clade"
        };
    }

    if (!taxon) return;

    showTaxonInTaxonCard(taxon);
}

function renderCladeCard(clade, wiki) {
    const card = document.getElementById("taxon-card");
    if (!card) return;

    card.classList.remove("species-card", "clade-card");
    card.classList.add("clade-card");
    card.innerHTML = "";

    const title = document.createElement("h3");
    title.textContent = clade.name;
    card.appendChild(title);

    const rank = document.createElement("p");
    rank.classList.add("taxon-card-rank");
    rank.textContent = "CLADE";
    card.appendChild(rank);
    // Higher-taxon cards use the same Wikipedia image treatment as
    // species cards when Wikipedia provides one.
    if (wiki?.summary?.thumbnail?.source) {
        appendTaxonCardPhoto(card, wiki);
    } else {
        appendCardSection(card, "Photo", "No photo available on Wikipedia.");
    }

    const description = document.createElement("p");
    description.classList.add("taxon-card-description");
    description.textContent =
        limitWikipediaSentences(
            wiki?.summary?.extract || "",
            6,
            1400
        ) ||
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
    common.classList.add("taxon-card-common");
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

function centerTaxonomyHorizontalScroll(smooth = false) {
    if (
        gameState.taxonomyView !== "tree" ||
        !taxonomyHorizontalScroll ||
        !taxonomyHorizontalScrollContent
    ) {
        return;
    }

    // Center the actual tree first. The custom scrollbar has a slightly
    // different viewport width, so using its raw maxScroll for both
    // elements leaves the tree a little off-center.
    const treeMaxScroll = Math.max(
        0,
        taxonomyTree.scrollWidth - taxonomyTree.clientWidth
    );

    if (treeMaxScroll <= 0) {
        taxonomyTree.scrollLeft = 0;
        taxonomyHorizontalScroll.scrollLeft = 0;
        return;
    }

    const behavior = smooth ? "smooth" : "auto";
    const treeCenter = treeMaxScroll / 2;

    taxonomyTree.scrollTo({
        left: treeCenter,
        behavior
    });

    // Keep the custom scrollbar thumb at the same proportional position
    // as the real tree viewport.
    const scrollbarMaxScroll = Math.max(
        0,
        taxonomyHorizontalScroll.scrollWidth -
            taxonomyHorizontalScroll.clientWidth
    );
    const scrollbarCenter = scrollbarMaxScroll / 2;

    taxonomyHorizontalScroll.scrollTo({
        left: scrollbarCenter,
        behavior
    });
}

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

    requestAnimationFrame(() => {
        syncTaxonomyHorizontalScroll();

        // Keep the newly rendered tree centered after every guess.
        // A second frame lets the browser finish measuring the new canvas
        // before calculating the scrollbar's true center.
        requestAnimationFrame(() => {
            centerTaxonomyHorizontalScroll(true);
        });
    });
}

function renderTaxonomyTree() {
    taxonomyTree.classList.remove("table-mode");
    taxonomyTree.innerHTML = "";

    if (!gameState.mysteryBird) return;

    const model = buildTreeModel();

    // Calculate biological color proximity before measuring/rendering nodes.
    // This keeps the temporary measurement elements and the final elements
    // visually consistent.
    assignTreeNodeProximity(model);

    const canvas = document.createElement("div");
    canvas.classList.add("meta-tree-canvas");

    const svg = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "svg"
    );
    svg.classList.add("meta-tree-lines");

    // Every branch gets its own gradient so its color smoothly transitions
    // from the parent node to the child node.
    const defs = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "defs"
    );
    svg.appendChild(defs);
    let gradientId = 0;

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

    // The Aves trunk is a visual spine: every direct child of Aves should
    // sit exactly on the Aves center. Shift the complete child subtree by
    // the measured difference so its own branches remain internally aligned.
    const avesPosition = positioned.get(model);
    if (avesPosition && model.type === "taxon") {
        const shiftSubtree = (node, deltaX) => {
            const pos = positioned.get(node);
            if (!pos) return;

            pos.x += deltaX;
            pos.element.style.left =
                (parseFloat(pos.element.style.left) || 0) + deltaX + "px";

            (node.children || []).forEach(child => {
                shiftSubtree(child, deltaX);
            });
        };

        (model.children || []).forEach(child => {
            const childPosition = positioned.get(child);
            if (!childPosition) return;

            const deltaX = avesPosition.x - childPosition.x;
            if (Math.abs(deltaX) > 0.01) {
                shiftSubtree(child, deltaX);
            }
        });
    }

    function drawConnections(node) {
        if (node.type !== "taxon") return;

        const parent = positioned.get(node);
        if (!parent) return;

        node.children.forEach(child => {
            const childPosition = positioned.get(child);
            if (!childPosition) return;

            const startX = parent.x;
            const startY = parent.y + parent.height / 2;

            // The Aves trunk must be perfectly vertical. Use the actual
            // rendered Aves center for both ends rather than relying on the
            // independently measured child center.
            const endX =
                node.taxonId === "class:Aves"
                    ? startX
                    : childPosition.x;

            const endY = childPosition.y - childPosition.height / 2;

            const verticalDistance = Math.max(1, endY - startY);
            const curve = Math.max(26, verticalDistance * 0.48);

            const path = document.createElementNS(
                "http://www.w3.org/2000/svg",
                "path"
            );

            if (node.taxonId === "class:Aves" || Math.abs(startX - endX) < 1) {
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

            // Give the animation the real length of this branch.
            // Without this, the generic 1000px fallback can hide shorter paths.
            const branchLength = path.getTotalLength();
            path.style.setProperty("--branch-length", `${branchLength}px`);
            path.style.strokeDasharray = `${branchLength}px`;
            path.style.strokeDashoffset = `${branchLength}px`;

            const parentProximity = Number.isFinite(node.__proximity)
                ? node.__proximity
                : 0;
            const childProximity = Number.isFinite(child.__proximity)
                ? child.__proximity
                : parentProximity;

            const parentColor = getProximityColor(parentProximity);
            const childColor = getProximityColor(childProximity);

            if (child.type === "taxon") {
                // Taxon-to-taxon branches smoothly transition from the
                // parent's actual proximity color to the child's.
                const gradient = document.createElementNS(
                    "http://www.w3.org/2000/svg",
                    "linearGradient"
                );

                const gradientName = `meta-tree-gradient-${gradientId++}`;
                gradient.setAttribute("id", gradientName);
                gradient.setAttribute("gradientUnits", "userSpaceOnUse");
                gradient.setAttribute("x1", String(startX));
                gradient.setAttribute("y1", String(startY));
                gradient.setAttribute("x2", String(endX));
                gradient.setAttribute("y2", String(endY));

                const startStop = document.createElementNS(
                    "http://www.w3.org/2000/svg",
                    "stop"
                );
                startStop.setAttribute("offset", "0%");
                startStop.setAttribute("stop-color", parentColor);
                startStop.setAttribute("stop-opacity", "0.48");

                const middleStop = document.createElementNS(
                    "http://www.w3.org/2000/svg",
                    "stop"
                );
                middleStop.setAttribute("offset", "42%");
                middleStop.setAttribute("stop-color", parentColor);
                middleStop.setAttribute("stop-opacity", "0.96");

                const endStop = document.createElementNS(
                    "http://www.w3.org/2000/svg",
                    "stop"
                );
                endStop.setAttribute("offset", "100%");
                endStop.setAttribute("stop-color", childColor);
                endStop.setAttribute("stop-opacity", "1");

                gradient.appendChild(startStop);
                gradient.appendChild(middleStop);
                gradient.appendChild(endStop);
                defs.appendChild(gradient);

                path.style.stroke = `url(#${gradientName})`;
                path.classList.add("meta-connection-taxon");
            } else {
                // The branch directly entering a species node is the one
                // exception: keep it a single solid color from its parent.
                path.style.stroke = parentColor;
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
// Online conservation status
// ========================================
//
// Wikipedia's conservation infobox is not consistent across bird articles.
// Use Wikidata's structured IUCN property (P141) as the primary online
// source, then keep the Wikipedia parser as a fallback.
//
// Wikidata P141 is explicitly the "IUCN conservation status" property.
// We resolve the bird by its scientific name (P225), then read the P141
// item and its English label.

async function fetchWikidataConservationStatus(bird) {
    const scientificName = String(bird?.scientificName || "").trim();
    if (!scientificName) return "";

    const statusLabels = {
        Q211005: ["LC", "Least Concern"],
        Q719675: ["NT", "Near Threatened"],
        Q278113: ["VU", "Vulnerable"],
        Q96377276: ["EN", "Endangered"],
        Q219127: ["CR", "Critically Endangered"],
        Q239509: ["EW", "Extinct in the Wild"],
        Q237350: ["EX", "Extinct"],
        Q3245245: ["DD", "Data Deficient"],
        Q3350324: ["NE", "Not Evaluated"]
    };

    try {
        const searchUrl =
            "https://www.wikidata.org/w/api.php?" +
            new URLSearchParams({
                action: "wbsearchentities",
                search: scientificName,
                language: "en",
                uselang: "en",
                type: "item",
                limit: "10",
                format: "json",
                origin: "*"
            }).toString();

        const searchResponse = await fetch(searchUrl);
        if (!searchResponse.ok) return "";

        const searchData = await searchResponse.json();
        const candidates = searchData?.search || [];
        const candidateIds = candidates
            .map(item => item?.id)
            .filter(Boolean);

        if (!candidateIds.length) return "";

        // The scientific name is stored in Wikidata as P225, while the
        // English label is normally the common name. Do not require the
        // label itself to equal the scientific name.
        const entityUrl =
            "https://www.wikidata.org/w/api.php?" +
            new URLSearchParams({
                action: "wbgetentities",
                ids: candidateIds.join("|"),
                props: "claims|labels",
                languages: "en",
                format: "json",
                origin: "*"
            }).toString();

        const entityResponse = await fetch(entityUrl);
        if (!entityResponse.ok) return "";

        const entityData = await entityResponse.json();
        const normalizedScientific = scientificName.toLowerCase();

        const matchingEntity = candidateIds
            .map(id => entityData?.entities?.[id])
            .find(entity => {
                const scientificClaims = entity?.claims?.P225 || [];
                return scientificClaims.some(claim =>
                    String(claim?.mainsnak?.datavalue?.value || "")
                        .trim()
                        .toLowerCase() === normalizedScientific
                );
            });

        if (!matchingEntity) return "";

        const entity = matchingEntity;
        const entityId = entity.id;
        const p141Claims = entity.claims?.P141 || [];
        if (!p141Claims.length) return "";

        // Prefer a preferred-rank P141 statement, otherwise use the first
        // normal statement. Wikidata documents P141 as the IUCN status.
        const rankedClaims = [
            ...p141Claims.filter(claim => claim?.rank === "preferred"),
            ...p141Claims.filter(claim => claim?.rank === "normal")
        ];

        for (const claim of rankedClaims) {
            const statusId =
                claim?.mainsnak?.datavalue?.value?.id;

            if (!statusId) continue;

            if (statusLabels[statusId]) {
                const [code, name] = statusLabels[statusId];
                return code + " - " + name;
            }

            const label =
                entityData?.entities?.[statusId]?.labels?.en?.value;

            if (label) {
                return label;
            }
        }

        return "";
    } catch (error) {
        console.warn(
            "Wikidata conservation lookup failed:",
            scientificName,
            error
        );
        return "";
    }
}

// ========================================
// Family / Genus hover hints
// ========================================

function getHintRelationship(guessedBird) {
    const mystery = gameState.mysteryBird;
    if (!guessedBird || !mystery || guessedBird === mystery) return null;

    if (guessedBird.genus && mystery.genus && guessedBird.genus === mystery.genus) {
        return { rank: "Genus", value: guessedBird.genus };
    }

    if (guessedBird.family && mystery.family && guessedBird.family === mystery.family) {
        return { rank: "Family", value: guessedBird.family };
    }

    return null;
}

function normalizeHintText(value) {
    return normalizeWikipediaText(value).toLowerCase().replace(/[^a-z0-9\s-]/g, " ").replace(/\s+/g, " ").trim();
}

function getHintEvidenceTokens(text) {
    const normalized = normalizeHintText(text);
    if (!normalized) return [];
    const groups = [
        ["insects", ["insect", "insects", "beetle", "beetles", "ant", "ants", "termite", "termites", "moth", "moths", "fly", "flies", "wasp", "wasps"]],
        ["fruit", ["fruit", "fruits", "berry", "berries"]],
        ["seeds", ["seed", "seeds", "grain", "grains"]],
        ["nectar", ["nectar"]],
        ["fish", ["fish", "fishes"]],
        ["reptiles", ["reptile", "reptiles", "lizard", "lizards", "snake", "snakes"]],
        ["amphibians", ["frog", "frogs", "toad", "toads", "amphibian", "amphibians"]],
        ["crustaceans", ["crustacean", "crustaceans", "crab", "crabs", "shrimp"]],
        ["molluscs", ["mollusc", "molluscs", "mollusk", "mollusks", "snail", "snails"]],
        ["carrion", ["carrion", "carcass", "carcasses"]],
        ["forest", ["forest", "forests", "woodland", "woodlands", "rainforest"]],
        ["grassland", ["grassland", "grasslands"]],
        ["wetland", ["wetland", "wetlands", "marsh", "marshes", "swamp", "swamps"]],
        ["mangroves", ["mangrove", "mangroves"]],
        ["savanna", ["savanna", "savannah"]],
        ["shrubland", ["shrubland", "shrublands", "scrub"]],
        ["farmland", ["farmland", "farmlands", "cropland", "agricultural"]],
        ["urban areas", ["urban", "cities", "city", "towns", "town"]],
        ["coasts", ["coast", "coastal", "shore", "shores", "seashore"]],
        ["mountains", ["mountain", "mountains", "montane", "alpine"]],
        ["islands", ["island", "islands"]],
        ["migratory", ["migratory", "migration", "migrate", "migrates"]],
        ["flocks", ["flock", "flocks", "gregarious"]],
        ["solitary", ["solitary"]],
        ["nocturnal", ["nocturnal", "nighttime"]],
        ["diurnal", ["diurnal", "daytime"]],
        ["territorial", ["territorial", "territory", "territories"]],
        ["cavity nesting", ["cavity", "cavities", "hollow", "tree-hole", "treehole"]]
    ];
    return groups.filter(([, terms]) => terms.some(term => new RegExp("\\b" + term + "\\b", "i").test(normalized))).map(([label]) => label);
}

function getHintFactTokens(text, category = "general") {
    const normalized = normalizeHintText(text);
    if (!normalized) return [];

    const groupsByCategory = {
        appearance: [
            ["black", ["black", "dark", "blackish"]],
            ["white", ["white", "pale", "whitish"]],
            ["brown", ["brown", "rufous", "chestnut", "buff"]],
            ["grey", ["grey", "gray", "silvery"]],
            ["blue", ["blue", "azure", "cobalt"]],
            ["green", ["green", "olive"]],
            ["red", ["red", "crimson", "scarlet"]],
            ["yellow", ["yellow", "golden"]],
            ["orange", ["orange", "ochre", "ochreous"]],
            ["black-and-white plumage", ["black-and-white", "black and white"]],
            ["crest", ["crest", "crested"]],
            ["eyering", ["eyering", "eye-ring", "eye ring"]],
            ["eyebrow", ["eyebrow", "supercilium", "superciliary"]],
            ["eyeline", ["eyeline", "eye-line", "eye line"]],
            ["malar stripe", ["malar", "mustache", "moustache"]],
            ["throat patch", ["throat patch", "bib"]],
            ["wingbars", ["wingbar", "wingbars", "wing bar", "wing bars"]],
            ["wing patch", ["wing patch", "wing patches"]],
            ["streaked plumage", ["streaked", "streaking"]],
            ["spotted plumage", ["spotted", "spots", "spotting"]],
            ["barred plumage", ["barred", "barring"]],
            ["scaled plumage", ["scaled", "scaling"]],
            ["rufous underparts", ["rufous underpart", "rufous underparts"]],
            ["long tail", ["long tail", "long-tailed"]],
            ["short tail", ["short tail", "short-tailed"]],
            ["forked tail", ["forked tail", "forked-tailed"]],
            ["rounded tail", ["rounded tail", "rounded-tailed"]],
            ["long bill", ["long bill", "long-billed"]],
            ["short bill", ["short bill", "short-billed"]],
            ["thick bill", ["thick bill", "thick-billed", "deep bill"]],
            ["thin bill", ["thin bill", "thin-billed", "slender bill"]],
            ["hooked bill", ["hooked bill", "hooked beak"]],
            ["large", ["large", "big", "heavy"]],
            ["small", ["small", "tiny", "little"]],
            ["slender", ["slender", "slim"]],
            ["stocky", ["stocky", "chunky", "thickset"]],
            ["long legs", ["long legs", "long-legged"]],
            ["short legs", ["short legs", "short-legged"]],
            ["long neck", ["long neck", "long-necked"]],
            ["short neck", ["short neck", "short-necked"]],
            ["bare facial skin", ["bare facial skin", "bare face", "bare skin"]]

        ],
        diet: [
            ["insects", ["insect", "insects", "beetle", "beetles", "ant", "ants", "termite", "termites", "moth", "moths", "fly", "flies", "wasp", "wasps"]],
            ["fruit", ["fruit", "fruits", "berry", "berries"]],
            ["seeds", ["seed", "seeds", "grain", "grains"]],
            ["nectar", ["nectar", "flower nectar"]],
            ["fish", ["fish", "fishes"]],
            ["reptiles", ["reptile", "reptiles", "lizard", "lizards", "snake", "snakes"]],
            ["amphibians", ["frog", "frogs", "toad", "toads", "amphibian", "amphibians"]],
            ["crustaceans", ["crustacean", "crustaceans", "crab", "crabs", "shrimp"]],
            ["molluscs", ["mollusc", "molluscs", "mollusk", "mollusks", "snail", "snails"]],
            ["carrion", ["carrion", "carcass", "carcasses"]]
        ],
        habitat: [
            ["forest", ["forest", "forests", "woodland", "woodlands", "rainforest"]],
            ["grassland", ["grassland", "grasslands"]],
            ["wetlands", ["wetland", "wetlands", "marsh", "marshes", "swamp", "swamps"]],
            ["mangroves", ["mangrove", "mangroves"]],
            ["savanna", ["savanna", "savannah"]],
            ["shrubland", ["shrubland", "shrublands", "scrub"]],
            ["farmland", ["farmland", "farmlands", "cropland", "agricultural"]],
            ["urban areas", ["urban", "cities", "city", "towns", "town"]],
            ["canopy", ["canopy", "tree canopy", "upper canopy"]],
            ["understory", ["understory", "understorey"]],
            ["river", ["river", "rivers", "riverbank", "riverside"]],
            ["streams", ["stream", "streams", "creek", "creeks"]],
            ["bamboo", ["bamboo"]],
            ["limestone", ["limestone", "karst"]],
            ["lowlands", ["lowland", "lowlands"]],
            ["high elevations", ["high elevation", "high elevations", "high altitude", "montane"]],
            ["islands", ["island", "islands"]],

            ["coasts", ["coast", "coastal", "shore", "shores", "seashore"]],
            ["mountains", ["mountain", "mountains", "montane", "alpine"]],
            ["islands", ["island", "islands"]]
        ],
        behavior: [
            ["migratory", ["migratory", "migration", "migrate", "migrates"]],
            ["flocks", ["flock", "flocks", "gregarious", "groups", "group"]],
            ["solitary", ["solitary", "alone"]],
            ["nocturnal", ["nocturnal", "nighttime", "night"]],
            ["diurnal", ["diurnal", "daytime", "day"]],
            ["territorial", ["territorial", "territory", "territories"]]
        ],
        breeding: [
            ["cavity nesting", ["cavity", "cavities", "hollow", "tree-hole", "treehole"]]
        ],
        general: []
    };

    const groups = groupsByCategory[category] || groupsByCategory.general;

    return groups
        .filter(([, terms]) =>
            terms.some(term =>
                new RegExp("\\b" + term + "\\b", "i").test(normalized)
            )
        )
        .map(([label]) => label);
}

function getMeaningfulNameWords(name) {
    const ignoredWords = new Set([
        "bird",
        "birds",
        "common",
        "greater",
        "lesser",
        "little",
        "small",
        "large",
        "western",
        "eastern",
        "northern",
        "southern",
        "central",
        "new",
        "old"
    ]);

    return normalizeHintText(name)
        .split(/\\s+/)
        .map(word => word.replace(/[^a-z-]/g, ""))
        .filter(word =>
            word.length >= 3 &&
            !ignoredWords.has(word)
        );
}

function getHintStudyTraits(study) {
    const categories = [
        ["Appearance", "appearance", study?.description],
        ["Habitat", "habitat", study?.habitatDistribution],
        ["Behavior", "behavior", study?.behavior],
        ["Diet", "diet", study?.diet],
        ["Breeding", "breeding", study?.breeding]
    ];

    const traits = [];
    categories.forEach(([label, category, value]) => {
        const tokens = getHintFactTokens(value, category);
        [...new Set(tokens)].forEach(token => {
            traits.push({ label, category, token });
        });
    });
    return traits;
}

function getDiagnosticHintTraits(targetStudies, comparisonStudies, minimumTargetSupport = 0.4) {
    const target = targetStudies.filter(Boolean);
    const comparison = comparisonStudies.filter(Boolean);
    if (!target.length) return [];

    const targetCounts = new Map();
    const comparisonCounts = new Map();

    target.forEach(study => {
        [...new Set(getHintStudyTraits(study).map(item => item.label + "|" + item.token))]
            .forEach(key => targetCounts.set(key, (targetCounts.get(key) || 0) + 1));
    });

    comparison.forEach(study => {
        [...new Set(getHintStudyTraits(study).map(item => item.label + "|" + item.token))]
            .forEach(key => comparisonCounts.set(key, (comparisonCounts.get(key) || 0) + 1));
    });

    const candidates = [];

    targetCounts.forEach((count, key) => {
        const [label, token] = key.split("|");
        const targetSupport = count / target.length;
        const comparisonSupport = comparison.length
            ? (comparisonCounts.get(key) || 0) / comparison.length
            : 0;

        if (targetSupport < minimumTargetSupport) return;

        // Prefer traits that occur often in the mystery group but are uncommon
        // outside it. This turns the hint into a discriminator rather than a
        // generic description of the target.
        const separation = targetSupport - comparisonSupport;
        const rarityBonus = comparisonSupport === 0 ? 0.18 : 0;
        const score = separation + rarityBonus + targetSupport * 0.15;

        candidates.push({
            label,
            token,
            targetSupport,
            comparisonSupport,
            score
        });
    });

    return candidates
        .sort((a, b) => b.score - a.score)
        .filter((item, index, array) =>
            index === array.findIndex(other =>
                other.label === item.label && other.token === item.token
            )
        );
}

function getSpecificSpeciesTraits(mysteryStudy, otherSpeciesStudies, guessedStudy) {
    if (!mysteryStudy) return [];

    const comparison = otherSpeciesStudies.filter(Boolean);
    const targetTraits = getHintStudyTraits(mysteryStudy);
    const guessedTraits = new Set(
        getHintStudyTraits(guessedStudy).map(item => item.label + "|" + item.token)
    );

    const comparisonCounts = new Map();
    comparison.forEach(study => {
        [...new Set(getHintStudyTraits(study).map(item => item.label + "|" + item.token))]
            .forEach(key => comparisonCounts.set(key, (comparisonCounts.get(key) || 0) + 1));
    });

    return targetTraits
        .filter(item => {
            const key = item.label + "|" + item.token;
            const seenElsewhere = comparison.length
                ? (comparisonCounts.get(key) || 0) / comparison.length
                : 0;

            // A species clue should be something that helps distinguish the
            // mystery from its close congeners, not merely a generic genus trait.
            if (seenElsewhere > 0.35) return false;
            if (guessedTraits.has(key)) return false;
            return true;
        })
        .map(item => {
            const key = item.label + "|" + item.token;
            const seenElsewhere = comparison.length
                ? (comparisonCounts.get(key) || 0) / comparison.length
                : 0;
            return {
                ...item,
                score: (1 - seenElsewhere) + (seenElsewhere === 0 ? 0.25 : 0)
            };
        })
        .sort((a, b) => b.score - a.score);
}

function buildSpeciesHint(
    guessedBird,
    guessedStudy,
    mysteryStudy,
    mysteryGenusStudies = [],
    familyGenusStudies = [],
    genusSpeciesStudies = []
) {
    const relationship = getHintRelationship(guessedBird);
    const isSameGenus = relationship?.rank === "Genus";
    const clues = [];

    const mysteryGenus = gameState.mysteryBird?.genus;

    // Never expose family/genus sizes to the player. They are used only to
    // control how selective the diagnostic-trait engine should be.
    const genusMembersAll = mysteryGenus
        ? gameState.birds.filter(bird => bird.genus === mysteryGenus)
        : [];

    // Several diagnostic traits can belong to the same ID category. Keep
    // those traits together so the player gets one coherent clue instead of
    // several nearly identical cards.
    function addGroupedDiagnosticClues(diagnostic, stage, options = {}) {
        const groups = new Map();

        diagnostic.forEach(item => {
            if (!item?.label || !item?.token) return;
            if (!groups.has(item.label)) groups.set(item.label, []);
            const tokens = groups.get(item.label);
            if (!tokens.includes(item.token)) tokens.push(item.token);
        });

        const categoryOrder = options.categoryOrder || [];
        const orderedGroups = [...groups.entries()].sort((a, b) => {
            const ai = categoryOrder.indexOf(a[0]);
            const bi = categoryOrder.indexOf(b[0]);
            return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
        });

        orderedGroups.slice(0, 3).forEach(([label, tokens]) => {
            const selected = tokens.slice(0, 3);
            let text;

            if (stage === "genus") {
                text =
                    selected.length === 1
                        ? "The mystery branch is especially associated with " + selected[0] + "."
                        : "The mystery branch is especially associated with " +
                          selected.slice(0, -1).join(", ") +
                          " and " + selected[selected.length - 1] + ".";
            } else {
                text =
                    selected.length === 1
                        ? "This is a useful distinguishing " + label.toLowerCase() +
                          " trait: " + selected[0] + "."
                        : "These are useful distinguishing " + label.toLowerCase() +
                          " traits: " + selected.slice(0, -1).join(", ") +
                          " and " + selected[selected.length - 1] + ".";
            }

            clues.push({
                heading: label + " — " + stage + " clue",
                text
            });
        });
    }

    if (!isSameGenus) {
        const targetGenusStudies = [
            mysteryStudy,
            ...mysteryGenusStudies.map(entry => entry?.study)
        ].filter(Boolean);

        const comparisonGenusStudies = familyGenusStudies
            .filter(entry => entry?.study)
            .map(entry => entry.study);

        const familyGeneraCount = new Set(
            gameState.birds
                .filter(bird => bird.family === gameState.mysteryBird?.family)
                .map(bird => bird.genus)
                .filter(Boolean)
        ).size;

        const minimumSupport =
            familyGeneraCount >= 20 ? 0.34 :
            familyGeneraCount >= 10 ? 0.40 :
            0.50;

        const diagnostic = getDiagnosticHintTraits(
            targetGenusStudies,
            comparisonGenusStudies,
            minimumSupport
        );

        addGroupedDiagnosticClues(
            diagnostic,
            "genus",
            {
                categoryOrder: ["Appearance", "Behavior", "Habitat", "Breeding", "Diet"]
            }
        );

        // If the family profile is sparse, fall back to repeated traits from
        // the mystery genus rather than inventing a distinction.
        if (!clues.length) {
            const repeated = getDiagnosticHintTraits(
                targetGenusStudies,
                [],
                targetGenusStudies.length > 2 ? 0.5 : 0.34
            );

            addGroupedDiagnosticClues(
                repeated,
                "genus",
                {
                    categoryOrder: ["Appearance", "Behavior", "Habitat", "Breeding", "Diet"]
                }
            );
        }

        // Keep the common-name clue only as a final fallback.
        if (clues.length < 1) {
            const guessedNameWords = getMeaningfulNameWords(guessedBird?.commonName);
            const mysteryNameWords = getMeaningfulNameWords(gameState.mysteryBird?.commonName);
            const sharedNameWord = guessedNameWords.find(word =>
                mysteryNameWords.includes(word)
            );

            if (sharedNameWord) {
                clues.push({
                    heading: "Name clue",
                    text: "The mystery bird's common name also contains the word “" +
                        sharedNameWord + "”."
                });
            }
        }
    } else {
        const comparisonStudies = [
            ...genusSpeciesStudies,
            ...mysteryGenusStudies.map(entry => entry?.study)
        ].filter(Boolean);

        const genusSize = genusMembersAll.length;

        const diagnostic = getSpecificSpeciesTraits(
            mysteryStudy,
            comparisonStudies,
            guessedStudy
        );

        addGroupedDiagnosticClues(
            diagnostic,
            "species",
            {
                categoryOrder: genusSize >= 15
                    ? ["Appearance", "Behavior", "Habitat", "Breeding", "Diet"]
                    : ["Behavior", "Habitat", "Appearance", "Diet", "Breeding"]
            }
        );

        // If the fine-grained comparison is sparse, use a direct comparison
        // between the guessed and mystery birds rather than a generic fact.
        if (!clues.length && guessedStudy && mysteryStudy) {
            const categories = [
                ["Behavior", "behavior"],
                ["Habitat", "habitat"],
                ["Appearance", "appearance"],
                ["Diet", "diet"],
                ["Breeding", "breeding"]
            ];

            for (const [label, category] of categories) {
                const left = getHintFactTokens(
                    category === "appearance" ? guessedStudy.description :
                    category === "habitat" ? guessedStudy.habitatDistribution :
                    guessedStudy[category],
                    category
                );
                const right = getHintFactTokens(
                    category === "appearance" ? mysteryStudy.description :
                    category === "habitat" ? mysteryStudy.habitatDistribution :
                    mysteryStudy[category],
                    category
                );

                const mysteryOnly = right.filter(token => !left.includes(token));
                if (!mysteryOnly.length) continue;

                clues.push({
                    heading: label + " — species clue",
                    text: "The mystery bird is associated with " +
                        mysteryOnly.slice(0, 2).join(" and ") +
                        ", unlike the bird you guessed."
                });
                if (clues.length >= 2) break;
            }
        }

        if (!clues.length) {
            clues.push({
                heading: "Hint",
                text: "There is not enough reliable information online to make a meaningful species-level distinction from this guess."
            });
        }
    }

    if (!clues.length) {
        return [{
            heading: isSameGenus ? "Species clue" : "Genus clue",
            text: isSameGenus
                ? "There is not enough reliable information online to make a useful distinction between the mystery species and its close relatives."
                : "There is not enough reliable information online to make a useful distinction between the mystery genus and the other genera on this branch."
        }];
    }

    return clues.slice(0, 3);
}

function getSpeciesHintElement() {
    let hint = document.getElementById("species-hover-hint");
    if (!hint) {
        hint = document.createElement("div");
        hint.id = "species-hover-hint";
        hint.className = "species-hover-hint";
        hint.setAttribute("role", "tooltip");
        document.body.appendChild(hint);
    }
    return hint;
}

function positionSpeciesHint(anchor) {
    const hint = document.getElementById("species-hover-hint");
    if (!hint || !anchor) return;
    const rect = anchor.getBoundingClientRect();
    const margin = 12;
    const hintRect = hint.getBoundingClientRect();
    let left = rect.left + rect.width / 2 - hintRect.width / 2;
    let top = rect.bottom + margin;
    if (left < margin) left = margin;
    if (left + hintRect.width > window.innerWidth - margin) left = window.innerWidth - hintRect.width - margin;
    if (top + hintRect.height > window.innerHeight - margin) top = rect.top - hintRect.height - margin;
    hint.style.left = Math.max(margin, left) + "px";
    hint.style.top = Math.max(margin, top) + "px";
}

function hideSpeciesHint() {
    const hint = document.getElementById("species-hover-hint");
    if (hint) hint.classList.remove("visible");
    gameState.hintRequestId++;
}

async function showSpeciesHint(guessedBird, anchor) {
    const relationship = getHintRelationship(guessedBird);
    if (!relationship || gameState.gameStatus !== "playing") { hideSpeciesHint(); return; }
    const hint = getSpeciesHintElement();
    const requestId = ++gameState.hintRequestId;
    const cacheKey = (guessedBird.scientificName || guessedBird.commonName) + "|" + (gameState.mysteryBird.scientificName || gameState.mysteryBird.commonName);
    hint.innerHTML = '<div class="species-hover-hint-title">Hint</div><div class="species-hover-hint-loading">Finding a useful clue…</div>';
    hint.classList.add("visible");
    positionSpeciesHint(anchor);

    let hintData = gameState.hintCache.get(cacheKey);
    if (!hintData) {
        try {
            const isFamilyStage = relationship.rank === "Family";
            const isGenusStage = relationship.rank === "Genus";

            const mysteryGenusMembers = gameState.birds.filter(bird =>
                bird.genus &&
                gameState.mysteryBird.genus &&
                bird.genus === gameState.mysteryBird.genus &&
                bird.scientificName !== gameState.mysteryBird.scientificName
            );

            const mysteryGenusMembersForHint = mysteryGenusMembers.slice(0, 6);

            // At family level, take representatives from other genera in the
            // same family. These are used only to discover traits that separate
            // the mystery genus from its neighboring genera.
            const familyRepresentatives = [];
            if (isFamilyStage) {
                const byGenus = new Map();

                gameState.birds
                    .filter(bird =>
                        bird.family &&
                        bird.family === gameState.mysteryBird.family &&
                        bird.genus &&
                        bird.genus !== gameState.mysteryBird.genus
                    )
                    .forEach(bird => {
                        if (!byGenus.has(bird.genus)) byGenus.set(bird.genus, []);
                        byGenus.get(bird.genus).push(bird);
                    });

                [...byGenus.entries()]
                    .slice(0, 18)
                    .forEach(([genus, birds]) => {
                        birds.slice(0, 2).forEach(bird => {
                            familyRepresentatives.push({ genus, bird });
                        });
                    });
            }

            // At genus level, sample several other species so the clue engine
            // can look for field marks that are actually unusual within the genus.
            const genusSpeciesForHint = isGenusStage
                ? mysteryGenusMembersForHint.slice(0, 8)
                : [];

            const [guessedWiki, mysteryWiki, ...extraWikis] = await Promise.all([
                fetchWikipediaPageData(
                    guessedBird.wikipediaTitle || guessedBird.commonName,
                    true,
                    "bird",
                    guessedBird.scientificName
                ),
                fetchWikipediaPageData(
                    gameState.mysteryBird.wikipediaTitle || gameState.mysteryBird.commonName,
                    true,
                    "bird",
                    gameState.mysteryBird.scientificName
                ),
                ...[
                    ...mysteryGenusMembersForHint,
                    ...familyRepresentatives.map(entry => entry.bird),
                    ...genusSpeciesForHint
                ].map(bird =>
                    fetchWikipediaPageData(
                        bird.wikipediaTitle || bird.commonName,
                        true,
                        "bird",
                        bird.scientificName
                    )
                )
            ]);

            if (requestId !== gameState.hintRequestId) return;

            const mysteryGenusCount = mysteryGenusMembersForHint.length;
            const familyRepresentativeCount = familyRepresentatives.length;

            const mysteryGenusStudies = mysteryGenusMembersForHint.map((bird, index) => ({
                bird,
                study: getWikipediaStudyData(
                    extraWikis[index]?.html,
                    extraWikis[index]?.wikitext
                )
            }));

            const familyOffset = mysteryGenusCount;
            const familyGenusStudies = familyRepresentatives.map((entry, index) => ({
                ...entry,
                study: getWikipediaStudyData(
                    extraWikis[familyOffset + index]?.html,
                    extraWikis[familyOffset + index]?.wikitext
                )
            }));

            const genusOffset = familyOffset + familyRepresentativeCount;
            const genusSpeciesStudies = genusSpeciesForHint.map((bird, index) => ({
                bird,
                study: getWikipediaStudyData(
                    extraWikis[genusOffset + index]?.html,
                    extraWikis[genusOffset + index]?.wikitext
                )
            }));

            hintData = buildSpeciesHint(
                guessedBird,
                getWikipediaStudyData(guessedWiki?.html, guessedWiki?.wikitext),
                getWikipediaStudyData(mysteryWiki?.html, mysteryWiki?.wikitext),
                mysteryGenusStudies,
                familyGenusStudies,
                genusSpeciesStudies
            );
            gameState.hintCache.set(cacheKey, hintData);
        } catch (error) {
            console.warn("Species hint generation failed:", error);
            hintData = [{
                heading: "Not enough information",
                text: "There is not enough reliable information available for both birds to generate a useful hint."
            }];
        }
    }

    if (requestId !== gameState.hintRequestId) return;
    hint.innerHTML = "";
    hintData.forEach(section => {
        const block = document.createElement("div");
        block.className = "species-hover-hint-section";
        const heading = document.createElement("div");
        heading.className = "species-hover-hint-heading";
        heading.textContent = section.heading;
        const text = document.createElement("div");
        text.className = "species-hover-hint-text";
        text.textContent = section.text;
        block.appendChild(heading);
        block.appendChild(text);
        hint.appendChild(block);
    });
    hint.classList.add("visible");
    positionSpeciesHint(anchor);
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
    addStudySection("Habitat & Distribution", unavailable);
    addStudySection("Diet", unavailable);
    addStudySection("Behavior", unavailable);
    addStudySection("Breeding", unavailable);
    addStudySection("Conservation", unavailable);

    overlay.classList.add("visible");
    if (newGameButton) newGameButton.classList.add("visible");

    const wikiTitle = bird.wikipediaTitle || bird.commonName;
    const [wiki, onlineThaiName, onlineConservationStatus, wikidataDetailed] =
        await Promise.all([
            fetchWikipediaPageData(
                wikiTitle,
                true,
                "bird",
                bird.scientificName
            ),
            gameState.mode === "thailand"
                ? fetchOnlineThaiName(bird)
                : Promise.resolve(""),
            fetchWikidataConservationStatus(bird),
            fetchWikidataDetailedTaxonomy(bird)
        ]);

    if (gameState.mysteryBird !== bird) return;

    if (gameState.mode === "thailand") {
        thaiName.textContent =
            onlineThaiName ||
            bird.thaiName ||
            "No information available online.";
    } else {
        thaiName.textContent = "";
    }

    attachDetailedTaxonomyToBird(bird, wiki);
    taxonomy.innerHTML = "";
    mergeDetailedTaxonomyRows(bird, wiki, wikidataDetailed).forEach(([label, value]) => {
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

    const studyData = getWikipediaStudyData(wiki?.html, wiki?.wikitext);
    const description =
        studyData.description ||
        "No information available on Wikipedia.";

    const setStudyValue = (heading, value) => {
        const section = document.querySelector(
            `.study-card-section[data-study-heading="${heading.toLowerCase()}"]`
        );
        const paragraph = section?.querySelector("p");
        if (paragraph) paragraph.textContent = value || unavailable;
    };

    setStudyValue("Description", description);
    setStudyValue("Habitat & Distribution", studyData.habitatDistribution);
    setStudyValue("Diet", studyData.diet);
    setStudyValue("Behavior", studyData.behavior);
    setStudyValue("Breeding", studyData.breeding);
    setStudyValue(
        "Conservation",
        onlineConservationStatus ||
        studyData.conservation ||
        "No information available online."
    );

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

    if (newGameButton) newGameButton.classList.remove("visible");
    closeGameOverCard();

    if (gameState.mode) {
        startNewRoundForMode(gameState.mode);
    } else {
        openModeSelector(true);
    }
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
    updateClearButtonVisibility(birdSearchClear, searchInput);
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
