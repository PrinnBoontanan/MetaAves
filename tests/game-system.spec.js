const { test, expect } = require("@playwright/test");

const GAME_COUNT = Number(process.env.METAAVES_GAMES || 20);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function normalizeScientific(value) {
  return String(value || "").trim().toLowerCase().split(/\\s+/).slice(0, 2).join(" ");
}

function buildRankedPath(taxonomy, speciesName) {
  const species = Object.values(taxonomy).find(
    t => t && t.rank === "species" && t.name === speciesName
  );
  assert(species, `Missing species taxon for ${speciesName}`);

  const path = [];
  const seen = new Set();
  let current = species;

  while (current) {
    assert(!seen.has(current.id), `Taxonomy cycle at ${current.id}`);
    seen.add(current.id);
    path.unshift(current);

    if (current.id === "class:Aves") break;
    assert(current.parent, `Taxon ${current.id} has no parent`);
    current = taxonomy[current.parent];
    assert(current, `Missing parent ${path[0].id} -> ${path[0].parent}`);
  }

  assert(path[0]?.id === "class:Aves", `Broken Aves root for ${speciesName}`);
  assert(path[path.length - 1]?.rank === "species", `Path does not end in species: ${speciesName}`);
  return path;
}

function checkCladePath(clades, taxonomy, names, label) {
  if (!Array.isArray(names)) return;

  const cladesByName = new Map(
    Object.values(clades)
      .filter(x => x && x.id && x.name)
      .map(x => [x.name, x])
  );
  const parents = new Map();

  for (const taxon of Object.values(taxonomy || {})) {
    if (taxon && taxon.id) parents.set(taxon.id, taxon.parent || null);
  }
  for (const clade of Object.values(clades || {})) {
    if (clade && clade.id) parents.set(clade.id, clade.parent || "class:Aves");
  }

  function isDescendantOf(childId, ancestorId) {
    const seen = new Set();
    let current = childId;

    while (current) {
      if (current === ancestorId) return true;
      assert(!seen.has(current), label + ": cycle while checking " + childId);
      seen.add(current);
      current = parents.get(current) || null;
    }

    return false;
  }

  let previous = "class:Aves";
  for (const name of names) {
    const clade = cladesByName.get(name);
    assert(clade, label + ": missing clade " + name);

    assert(
      isDescendantOf(clade.id, previous),
      label + ": invalid clade path transition " + previous + " -> " + name +
        " (the clade is not a descendant of the previous node)"
    );
    previous = clade.id;
  }
}

async function loadData(page) {
  return page.evaluate(async () => {
    const files = [
      ["birds", "data/birds.generated.json"],
      ["taxonomy", "data/taxonomy.generated.json"],
      ["overrides", "data/taxonomy_overrides.json"],
      ["clades", "data/clades.json"],
      ["membership", "data/clade_membership.generated.json"]
    ];

    const result = {};
    for (const [key, path] of files) {
      const response = await fetch(path);
      if (!response.ok) throw new Error(`HTTP ${response.status} loading ${path}`);
      result[key] = await response.json();
    }
    return result;
  });
}

async function auditDatabase(data) {
  const errors = [];
  const birds = data.birds;
  const taxonomy = data.taxonomy;
  const clades = data.clades;
  const membership = data.membership;

  assert(Array.isArray(birds) && birds.length > 0, "Bird database is empty");
  assert(taxonomy && typeof taxonomy === "object", "Taxonomy database is empty");

  const commonNames = new Map();
  const scientificNames = new Map();

  for (const bird of birds) {
    const common = String(bird.commonName || "").trim();
    const scientific = normalizeScientific(bird.scientificName);

    if (!common) errors.push(`Missing common name: ${bird.scientificName}`);
    if (!scientific) errors.push(`Missing scientific name: ${common}`);

    if (commonNames.has(common)) {
      errors.push(`Duplicate gameplay common name: "${common}" (${commonNames.get(common)} / ${scientific})`);
    } else {
      commonNames.set(common, scientific);
    }

    if (scientificNames.has(scientific)) {
      errors.push(`Duplicate scientific name: "${scientific}"`);
    } else {
      scientificNames.set(scientific, common);
    }

    const requiredFields = [["order", "order"], ["family", "family"], ["genus", "genus"]];

    for (const [field, label] of requiredFields) {
      if (!String(bird[field] || "").trim()) {
        errors.push(`Missing ${label} field: ${common || scientific}`);
      }
    }

    try {
      const rankedPath = buildRankedPath(taxonomy, bird.scientificName);
      const pathByRank = new Map(rankedPath.map(t => [t.rank, t.name]));
      for (const [field, rank] of requiredFields) {
        const actual = String(bird[field] || "").trim();
        const expected = String(pathByRank.get(rank) || "").trim();
        if (actual && expected && actual !== expected) {
          errors.push(`Taxonomy mismatch for ${common} (${scientific}): bird.${field}="${actual}" but taxonomy says "${expected}"`);
        }
      }
      // Formal ranks stored in the clade backbone must remain formal ranks.
      // This catches regressions where, for example, Neognathae is present
      // in clades.json as Infraclass but runtime code relabels it as "clade".
      const backbone = clades?._meta?.orderCladePaths?.[bird.order] || [];
      for (const name of backbone) {
        const clade = Object.values(clades || {}).find(
          entry => entry && entry.name === name
        );
        if (!clade) continue;
        if (clade.rank && clade.rank !== "clade") {
          const expectedId = clade.id;
          if (!expectedId) {
            errors.push(`Formal rank ${clade.rank} has no ID: ${name}`);
          }
        }
      }
    } catch (error) {
      errors.push(error.message);
    }
  }

  const orderPaths = clades?._meta?.orderCladePaths || {};
  const familyPaths = {
    ...(clades?._meta?.passerineFamilyCladePaths || {}),
    ...(clades?._meta?.nonpasserineFamilyCladePaths || {})
  };

  for (const [order, path] of Object.entries(orderPaths)) {
    try {
      checkCladePath(clades, taxonomy, path, `order ${order}`);
    } catch (error) {
      errors.push(error.message);
    }
  }

  for (const [family, path] of Object.entries(familyPaths)) {
    try {
      checkCladePath(clades, taxonomy, path, `family ${family}`);
    } catch (error) {
      errors.push(error.message);
    }
  }


  for (const bird of birds) {
    const expected = [
      ...(orderPaths[bird.order] || []),
      ...(familyPaths[bird.family] || [])
    ];
    const actual = membership.species?.[bird.scientificName];
    if (expected.length && !Array.isArray(actual)) {
      errors.push("Missing complete species clade membership: " + bird.scientificName);
      continue;
    }
    const missing = expected.filter(name => !actual.includes(name));
    if (missing.length) {
      errors.push("Incomplete clade membership for " + bird.scientificName + ": " + missing.join(", "));
    }
  }

  for (const order of ["Procellariiformes", "Sphenisciformes"]) {
    if (!(orderPaths[order] || []).includes("Feraequornithes")) {
      errors.push(order + " is missing the documented Feraequornithes clade");
    }
  }
  if ((orderPaths.Gaviiformes || []).includes("Feraequornithes")) {
    errors.push("Gaviiformes must remain outside Feraequornithes");
  }

  const cladeByName = new Map(
    Object.values(clades)
      .filter(x => x && x.id && x.name)
      .map(x => [x.name, x])
  );

  // Species membership is a set/list of clades containing the species, not
  // necessarily a literal parent-to-child path. For example, a passerine can
  // belong to both Psittacopasserae and Acanthisitti even though those two
  // clade records have different structural parents. Validate that every
  // referenced clade exists and that a species does not list the same clade
  // twice, while the actual structural clade paths are audited separately
  // above.
  for (const [scientific, path] of Object.entries(membership.species || {})) {
    if (!Array.isArray(path)) continue;

    const seen = new Set();
    for (const name of path) {
      if (!cladeByName.has(name)) {
        errors.push(`Membership ${scientific}: missing clade ${name}`);
        continue;
      }
      if (seen.has(name)) {
        errors.push(`Membership ${scientific}: duplicate clade ${name}`);
      }
      seen.add(name);
    }
  }

  return {
    birdCount: birds.length,
    taxonomyCount: Object.keys(taxonomy).length,
    errors
  };
}

async function getApi(page) {
  await page.waitForFunction(() => !!window.__METAAVES_E2E__);
  return page.evaluate(() => ({
    ready: true,
    birdCount: window.__METAAVES_E2E__.state.allBirds.length,
    thailandReady: !!window.__METAAVES_E2E__.state.thailandBirdKeys
  }));
}

async function startMode(page, mode) {
  await page.evaluate(modeName => {
    window.__METAAVES_E2E__.startRound(modeName);
  }, mode);

  await page.waitForFunction(expected => {
    return window.__METAAVES_E2E__?.state?.mode === expected &&
      window.__METAAVES_E2E__?.state?.gameStatus === "playing";
  }, mode);
}

async function getState(page) {
  return page.evaluate(() => {
    const s = window.__METAAVES_E2E__.state;
    return {
      mode: s.mode,
      status: s.gameStatus,
      remaining: s.guessesRemaining,
      guesses: s.guesses.map(b => b.commonName),
      mystery: {
        commonName: s.mysteryBird?.commonName,
        scientificName: s.mysteryBird?.scientificName,
        order: s.mysteryBird?.order,
        family: s.mysteryBird?.family,
        genus: s.mysteryBird?.genus,
        clades: Array.isArray(s.mysteryBird?.cladePath)
          ? [...s.mysteryBird.cladePath]
          : []
      }
    };
  });
}

async function makeUiGuess(page, commonName) {
  await page.locator("#bird-search").fill(commonName);
  await page.locator("#guess-button").click();
}

async function verifyTree(page, label) {
  const result = await page.evaluate(() => {
    const api = window.__METAAVES_E2E__;
    const model = api.buildTreeModel();

    const flatten = node => {
      const out = [node];
      for (const child of node.children || []) out.push(...flatten(child));
      return out;
    };

    const modelNodes = flatten(model);
    const domNodes = [...document.querySelectorAll(".meta-tree-node")]
      .map(node => ({
        text: node.textContent.trim(),
        level: node.dataset.level || null
      }));

    const missing = modelNodes
      .filter(node => node.name && !domNodes.some(dom => dom.text === node.name))
      .map(node => node.name);

    const duplicateIds = modelNodes
      .map(node => node.taxonId || node.name)
      .filter((id, index, all) => all.indexOf(id) !== index);

    const formalRankErrors = modelNodes
      .filter(node => node.type === "taxon" && node.taxonId?.startsWith("clade:"))
      .map(node => {
        const clade = api.state.clades?.[node.taxonId];
        const expectedRank = clade?.rank || "clade";
        return expectedRank !== node.level
          ? `${node.name}: runtime rank=${node.level}, data rank=${expectedRank}`
          : null;
      })
      .filter(Boolean);

    return {
      modelNodeCount: modelNodes.length,
      domNodeCount: domNodes.length,
      missing,
      duplicateIds,
      formalRankErrors
    };
  });

  assert(
    result.missing.length === 0,
    `${label}: tree model nodes missing from DOM: ${result.missing.join(", ")}`
  );
  assert(
    result.duplicateIds.length === 0,
    `${label}: duplicate tree node IDs: ${result.duplicateIds.join(", ")}`
  );
  assert(
    result.formalRankErrors.length === 0,
    `${label}: formal taxonomy ranks lost in tree model: ${result.formalRankErrors.join(", ")}`
  );
}

async function verifyStudyCard(page, mystery) {
  // showGameOverCard performs online enrichment asynchronously. Wait until
  // the final taxonomy rows have replaced the initial loading/local rows
  // before auditing their contents.
  await page.waitForFunction(
    expected => {
      const container = document.querySelector("#study-taxonomy");
      const text = container?.innerText || "";
      return (
        text.includes(expected.order) &&
        text.includes(expected.family) &&
        text.includes(expected.genus) &&
        text.includes(expected.scientificName)
      );
    },
    mystery,
    { timeout: 15000 }
  );

  const text = await page.locator("#study-taxonomy").innerText();
  assert(text.includes(mystery.order), `Study card missing order for ${mystery.commonName}`);
  assert(text.includes(mystery.family), `Study card missing family for ${mystery.commonName}`);
  assert(text.includes(mystery.genus), `Study card missing genus for ${mystery.commonName}`);
  assert(text.includes(mystery.scientificName), `Study card missing scientific name for ${mystery.commonName}`);

  const formalRanks = await page.evaluate(() => {
    const api = window.__METAAVES_E2E__;
    return api.getBirdPhylogenyPath(api.state.mysteryBird)
      .map(node => {
        const clade = node.id?.startsWith("clade:")
          ? api.state.clades?.[node.id]
          : null;
        return { rank: clade?.rank || node.level, name: node.value };
      })
      .filter(entry => entry.rank && entry.rank !== "clade" && entry.rank !== "species");
  });

  for (const entry of formalRanks) {
    const label = entry.rank.charAt(0).toUpperCase() + entry.rank.slice(1);
    assert(
      text.includes(entry.name),
      `Study card missing ${label} value "${entry.name}" for ${mystery.commonName}`
    );
    assert(
      text.toLowerCase().includes(label.toLowerCase()),
      `Study card missing ${label} label for ${mystery.commonName}`
    );
  }
}

test(`MetaAves full game-system audit — ${GAME_COUNT} games`, async ({ page }) => {
  const report = [];
  const failures = [];
  const databaseErrors = [];
  const consoleErrors = [];
  const browser404s = [];
  let activeGame = 0;

  page.on("pageerror", error => {
    consoleErrors.push({ game: activeGame || "startup", type: "pageerror", message: error.message });
  });
  page.on("response", response => {
    if (response.status() === 404) {
      browser404s.push({
        game: activeGame || "startup",
        type: "http404",
        resourceType: response.request().resourceType(),
        url: response.url()
      });
    }
  });

  page.on("console", message => {
    if (message.type() !== "error") return;
    const text = message.text();
    const isOptionalExternalFailure =
      /Failed to load resource: the server responded with a status of 429/i.test(text) ||
      /blocked by CORS policy/i.test(text) ||
      /net::ERR_FAILED/i.test(text);
    if (isOptionalExternalFailure) {
      // Optional online enrichment has local fallbacks. Keep the failure visible
      // in the log without treating remote rate limits/CORS as a game crash.
      console.log("Optional enrichment request failed:", text);
      return;
    }
    consoleErrors.push({ game: activeGame || "startup", type: "console", message: text });
  });

  await page.goto("/?e2e=1");
  await page.waitForFunction(() => !!window.__METAAVES_E2E__);

  const data = await loadData(page);
  const audit = await auditDatabase(data);

  if (audit.errors.length) {
    databaseErrors.push(...audit.errors);
    console.log(`Database audit found ${audit.errors.length} issue(s); game audit will continue so all runtime failures can be collected.`);
  }

  const api = await getApi(page);
  assert(api.birdCount === audit.birdCount, "Browser and database bird counts differ");

  const modes = api.thailandReady
    ? Array.from({ length: GAME_COUNT }, (_, i) => i % 2 === 0 ? "world" : "thailand")
    : Array.from({ length: GAME_COUNT }, () => "world");

  for (let game = 0; game < GAME_COUNT; game++) {
    const mode = modes[game];
    const shouldWin = game % 2 === 0;
    activeGame = game + 1;

    try {
      await startMode(page, mode);
      let state = await getState(page);

    assert(state.mystery.commonName, `Game ${game + 1}: no mystery bird`);
    const expectedMaxGuesses = mode === "world" ? 15 : 12;
    assert(
      state.remaining === expectedMaxGuesses,
      `Game ${game + 1}: game did not start at ${expectedMaxGuesses} guesses`
    );

    const pool = await page.evaluate(() =>
      window.__METAAVES_E2E__.state.birds.map(b => ({
        commonName: b.commonName,
        scientificName: b.scientificName
      }))
    );

    const mysteryName = state.mystery.commonName;
    const wrongBirds = pool.filter(b => b.commonName !== mysteryName).slice(
      game % Math.max(1, pool.length - (expectedMaxGuesses + 1)),
      game % Math.max(1, pool.length - (expectedMaxGuesses + 1)) + expectedMaxGuesses
    );

    assert(wrongBirds.length >= expectedMaxGuesses, `Game ${game + 1}: not enough wrong birds`);

    // Search/autocomplete smoke test before the first guess.
    const searchPrefix = wrongBirds[0].commonName.slice(0, 2);
    await page.locator("#bird-search").fill(searchPrefix);
    await expect(page.locator("#suggestions")).toHaveClass(/visible/);

    const suggestions = await page.locator(".suggestion").allTextContents();
    for (const name of suggestions) {
      assert(
        pool.some(b => b.commonName === name),
        `Game ${game + 1}: suggestion is not in active pool: ${name}`
      );
    }

    await page.locator("#bird-search").fill("");
    await page.locator("#bird-search").press("Escape").catch(() => {});

    // Invalid guess must not consume a guess.
    const beforeInvalid = await getState(page);
    await makeUiGuess(page, "Definitely Not A Real MetaAves Bird");
    const afterInvalid = await getState(page);
    assert(
      afterInvalid.remaining === beforeInvalid.remaining &&
      afterInvalid.guesses.length === beforeInvalid.guesses.length,
      `Game ${game + 1}: invalid guess changed game state`
    );

    // First real wrong guess.
    await makeUiGuess(page, wrongBirds[0].commonName);
    state = await getState(page);
    assert(state.remaining === expectedMaxGuesses - 1, `Game ${game + 1}: first guess did not decrement from ${expectedMaxGuesses}`);
    assert(state.guesses.length === 1, `Game ${game + 1}: first guess not recorded`);

    const endpoint = await page.evaluate(() => {
      const s = window.__METAAVES_E2E__.state;
      const guessed = s.guesses[s.guesses.length - 1];
      return window.__METAAVES_E2E__.getDeepestSharedTaxon(guessed, s.mysteryBird);
    });

    assert(endpoint?.id, `Game ${game + 1}: no shared taxonomy endpoint`);
    await verifyTree(page, `Game ${game + 1}, first wrong guess`);

    // Duplicate guess must not consume another guess.
    const beforeDuplicate = await getState(page);
    await makeUiGuess(page, wrongBirds[0].commonName);
    const afterDuplicate = await getState(page);
    assert(
      afterDuplicate.remaining === beforeDuplicate.remaining &&
      afterDuplicate.guesses.length === beforeDuplicate.guesses.length,
      `Game ${game + 1}: duplicate guess changed game state`
    );

    // A guessed bird must disappear from autocomplete suggestions.
    await page.locator("#bird-search").fill(searchPrefix);
    const postGuessSuggestions = await page.locator(".suggestion").allTextContents();
    assert(
      !postGuessSuggestions.includes(wrongBirds[0].commonName),
      `Game ${game + 1}: already-guessed bird still appears in suggestions`
    );
    await page.locator("#bird-search").fill("");

    if (shouldWin) {
      for (const bird of wrongBirds.slice(1, 3)) {
        await makeUiGuess(page, bird.commonName);
        state = await getState(page);
        assert(state.status === "playing", `Game ${game + 1}: ended too early`);
        await verifyTree(page, `Game ${game + 1}, wrong guess ${bird.commonName}`);
      }

      await makeUiGuess(page, mysteryName);
      state = await getState(page);
      assert(state.status === "won", `Game ${game + 1}: correct guess did not win`);
      assert(state.remaining === expectedMaxGuesses - 4, `Game ${game + 1}: wrong guess count is incorrect after win`);
      await expect(page.locator("#game-over-overlay")).toHaveClass(/visible/);
      await verifyStudyCard(page, state.mystery);
      await verifyTree(page, `Game ${game + 1}, solved`);
    } else {
      for (const bird of wrongBirds.slice(1, expectedMaxGuesses)) {
        await makeUiGuess(page, bird.commonName);
        state = await getState(page);
        await verifyTree(page, `Game ${game + 1}, loss guess ${bird.commonName}`);
      }

      state = await getState(page);
      assert(state.status === "lost", `Game ${game + 1}: ${expectedMaxGuesses} wrong guesses did not lose`);
      assert(state.remaining === 0, `Game ${game + 1}: loss did not reach zero`);
      await expect(page.locator("#game-over-overlay")).toHaveClass(/visible/);
      await verifyStudyCard(page, state.mystery);
      await verifyTree(page, `Game ${game + 1}, lost`);
    }

      report.push({
        game: game + 1,
        mode,
        result: state.status,
        mystery: state.mystery.commonName,
        scientific: state.mystery.scientificName,
        order: state.mystery.order,
        family: state.mystery.family,
        genus: state.mystery.genus,
        clades: state.mystery.clades.join(" → "),
        guessesUsed: expectedMaxGuesses - state.remaining
      });
    } catch (error) {
      const failedState = await getState(page).catch(() => ({ mystery: {} }));
      failures.push({
        game: game + 1,
        mode,
        mystery: failedState.mystery?.commonName || "unknown",
        error: error?.message || String(error)
      });
      console.log(`GAME ${game + 1} FAILED: ${error?.message || error}`);
    }
  }

  console.log(`\\n=== MetaAves ${GAME_COUNT}-game system audit ===`);
  console.table(report);
  console.log(`Database: ${audit.birdCount} birds, ${audit.taxonomyCount} taxonomy nodes`);
  console.log(`Expected games: ${GAME_COUNT}; completed: ${report.length}`);
  console.log(`Completed games: ${report.length}/${GAME_COUNT}`);
  console.log(`Failed games: ${failures.length}`);
  console.log(`Database errors: ${databaseErrors.length}`);
  console.log(`Browser errors: ${consoleErrors.length}`);
  console.log(`HTTP 404s: ${browser404s.length}`);

  if (databaseErrors.length) {
    console.log("\n=== DATABASE ERRORS ===");
    databaseErrors.forEach((error, index) => console.log(`${index + 1}. ${error}`));
  }

  if (failures.length) {
    console.log("\n=== GAME FAILURES ===");
    failures.forEach(failure => {
      console.log(`Game ${failure.game} [${failure.mode}] — ${failure.mystery}`);
      console.log(`  ${failure.error}`);
    });
  }

  if (consoleErrors.length) {
    console.log("\n=== BROWSER ERRORS ===");
    consoleErrors.forEach(error => console.log(`Game ${error.game} [${error.type}] ${error.message}`));
  }

  if (browser404s.length) {
    console.log("\n=== HTTP 404s ===");
    browser404s.forEach(error =>
      console.log(`Game ${error.game} [${error.resourceType}] ${error.url}`)
    );
  }

  assert(report.length + failures.length === GAME_COUNT, "Not all requested games were accounted for");
  assert(
    databaseErrors.length === 0 &&
    failures.length === 0 &&
    consoleErrors.length === 0 &&
    browser404s.length === 0,
    `MetaAves audit found ${databaseErrors.length} database error(s), ${failures.length} failed game(s), ${consoleErrors.length} browser error(s), and ${browser404s.length} HTTP 404(s). See the complete summary above.`
  );
});

test("MetaAves phone layout stays vertical when a phone exposes a desktop-sized viewport", async ({ page }) => {
  await page.addInitScript(() => {
    // Model iPhone Safari's "Request Desktop Website" case:
    // desktop-sized layout viewport + Mac-style UA + touch + tall phone-shaped screen.
    Object.defineProperty(window.screen, "width", { configurable: true, get: () => 980 });
    Object.defineProperty(window.screen, "height", { configurable: true, get: () => 2121 });
    Object.defineProperty(window.navigator, "maxTouchPoints", { configurable: true, get: () => 5 });
    Object.defineProperty(window.navigator, "userAgent", {
      configurable: true,
      get: () => "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15"
    });
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: { width: 980, height: 844, addEventListener() {} }
    });
  });

  await page.setViewportSize({ width: 980, height: 844 });
  await page.goto("/?e2e=1");
  await page.waitForFunction(() => !!window.__METAAVES_E2E__);

  const layout = await page.evaluate(() => {
    const layout = document.querySelector(".taxonomy-layout");
    const card = document.querySelector(".taxon-card");
    const cardRect = card.getBoundingClientRect();
    const cardStyle = getComputedStyle(card);
    const contentLeft = cardRect.left + parseFloat(cardStyle.paddingLeft || "0");
    const contentRight = cardRect.right - parseFloat(cardStyle.paddingRight || "0");
    const directChildren = [...card.children].map(node => {
      const rect = node.getBoundingClientRect();
      return {
        className: node.className || node.tagName,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        width: rect.width
      };
    });
    const taxonomy = card.querySelector(".taxon-card-species-taxonomy");
    return {
      phoneClass: document.body.classList.contains("phone-device"),
      layoutDisplay: getComputedStyle(layout).display,
      layoutColumns: getComputedStyle(layout).gridTemplateColumns,
      cardDisplay: getComputedStyle(card).display,
      cardFlexDirection: getComputedStyle(card).flexDirection,
      cardWidth: card.getBoundingClientRect().width,
      directChildren,
      contentLeft,
      contentRight,
      taxonomyColumns: taxonomy ? getComputedStyle(taxonomy).gridTemplateColumns : ""
    };
  });

  assert(layout.phoneClass, "Phone detection did not activate for a desktop-sized phone viewport");
  const layoutColumnCount = layout.layoutDisplay === "grid"
    ? layout.layoutColumns.trim().split(/\s+/).length
    : 1;
  assert(
    layout.layoutDisplay === "block" || (layout.layoutDisplay === "grid" && layoutColumnCount === 1),
    "Phone taxonomy layout is not a single vertical column: " + layout.layoutDisplay + " / " + layout.layoutColumns
  );
  assert(layout.cardDisplay === "flex", "Phone taxon card is not using vertical flex flow: " + layout.cardDisplay);
  assert(layout.cardFlexDirection === "column", "Phone taxon card is not column-oriented: " + layout.cardFlexDirection);
  assert(layout.cardWidth > 0, "Phone taxon card has no usable width");
  for (const child of layout.directChildren) {
    assert(
      child.left >= layout.contentLeft - 1.5 && child.right <= layout.contentRight + 1.5,
      "Phone taxon card child overflows the card content width: " + JSON.stringify(child)
    );
  }
  const visualChildren = [...layout.directChildren].sort((a, b) => a.top - b.top);
  for (let i = 1; i < visualChildren.length; i++) {
    assert(
      visualChildren[i].top >= visualChildren[i - 1].top - 1,
      "Phone taxon card children are not vertically ordered: " +
        JSON.stringify(visualChildren)
    );
  }
  const columnCount = layout.taxonomyColumns
    ? layout.taxonomyColumns.trim().split(/\s+/).length
    : 0;
  assert(
    columnCount <= 1,
    "Phone species taxonomy still has multiple columns: " + layout.taxonomyColumns
  );
});

test("MetaAves does not classify a touch tablet as a phone", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window.screen, "width", { configurable: true, get: () => 1488 });
    Object.defineProperty(window.screen, "height", { configurable: true, get: () => 2266 });
    Object.defineProperty(window.navigator, "maxTouchPoints", { configurable: true, get: () => 5 });
    Object.defineProperty(window.navigator, "userAgent", {
      configurable: true,
      get: () => "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15"
    });
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: { width: 1488, height: 2266, addEventListener() {} }
    });
  });

  await page.setViewportSize({ width: 980, height: 844 });
  await page.goto("/?e2e=1");
  await page.waitForFunction(() => !!window.__METAAVES_E2E__);

  const phoneClass = await page.evaluate(() => document.body.classList.contains("phone-device"));
  assert(!phoneClass, "Tablet-sized touch screen was incorrectly classified as a phone");
});


test("MetaAves study taxonomy reads down the first column before the second and removes repeated section text", async ({ page }) => {
  await page.goto("/?e2e=1");
  await page.waitForFunction(() => !!window.__METAAVES_E2E__);
  const result = await page.evaluate(() => {
    const api = window.__METAAVES_E2E__;
    const container = document.createElement("div");
    api.renderStudyTaxonomyRows(container, [
      ["Class", "Aves"], ["Clade", "Neognathae"], ["Order", "Passeriformes"],
      ["Family", "Turdidae"], ["Genus", "Turdus"], ["Species", "Turdus merula"]
    ]);
    const columns = [...container.children].map(column =>
      [...column.querySelectorAll(".study-taxonomy-row")].map(row =>
        row.querySelector(".study-taxonomy-label")?.textContent
      )
    );
    const deduped = api.deduplicateStudyData({
      description: "This bird has a long bill. It feeds on fish.",
      habitatDistribution: "It has a long bill. It nests on cliffs.",
      diet: "It feeds on fish.",
      behavior: "It nests on cliffs."
    });
    return { columns, deduped };
  });
  assert(
    JSON.stringify(result.columns) === JSON.stringify([
      ["Class", "Clade", "Order"],
      ["Family", "Genus", "Species"]
    ]),
    "Study taxonomy must be read top-to-bottom in column one, then column two"
  );
  assert(!result.deduped.habitatDistribution.includes("long bill"), "Description fact was repeated in habitat");
  assert(!result.deduped.diet.includes("feeds on fish"), "Description fact was repeated in diet");
  assert(!result.deduped.behavior.includes("nests on cliffs"), "Habitat fact was repeated in behavior");
});

test("MetaAves renders full ecological sections in the normal species card", async ({ page }) => {
  await page.goto("/?e2e=1");
  await page.waitForFunction(() => !!window.__METAAVES_E2E__);
  const result = await page.evaluate(() => {
    const api = window.__METAAVES_E2E__;
    const bird = api.state.allBirds.find(item => item.genus && item.family && item.scientificName);
    if (!bird) throw new Error("Loaded bird dataset has no species suitable for card rendering.");
    api.state.mode = "world";
    api.renderBirdCard(
      bird,
      {
        summary: {
          extract: "The test bird is a forest-dwelling bird species.",
          content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Bird" } }
        }
      },
      {},
      "",
      {
        appearance: "It has a dark crown and a pale throat.",
        habitatDistribution: "It inhabits lowland forest and woodland.",
        diet: "It feeds on insects and small fruit.",
        behavior: "It forages in the canopy and gives a repeated call.",
        breeding: "It nests in a tree cavity and lays two eggs.",
        conservation: "LC - Least Concern",
        sources: [{ label: "GBIF", url: "https://www.gbif.org/" }]
      }
    );
    const card = document.getElementById("taxon-card");
    const headings = [...card.querySelectorAll(".taxon-card-study-sections h4")].map(item => item.textContent);
    const text = card.querySelector(".taxon-card-study-sections")?.innerText || "";
    return {
      headings,
      text,
      sources: [...card.querySelectorAll(".taxon-card-study-sources a")].map(link => link.textContent),
      contentGridArea: getComputedStyle(card.querySelector(".taxon-card-study-sections")).gridArea
    };
  });

  for (const heading of ["Description", "Appearance", "Habitat & Distribution", "Diet", "Behavior", "Breeding", "Conservation"]) {
    assert(result.headings.includes(heading), "Normal species card is missing the " + heading + " section");
  }
  assert(/dark crown/.test(result.text), "Appearance data did not reach the species card");
  assert(/lowland forest/.test(result.text), "Habitat data did not reach the species card");
  assert(/insects/.test(result.text), "Diet data did not reach the species card");
  assert(/canopy/.test(result.text), "Behavior data did not reach the species card");
  assert(/tree cavity/.test(result.text), "Breeding data did not reach the species card");
  assert(result.sources.includes("GBIF"), "The species card did not show its verified source link");
  assert(result.contentGridArea.includes("description"), "Ecological sections are not placed in the species-card content column");
});

test("MetaAves renders all Study Card sections when independent providers return usable data", async ({ page }) => {
  await page.goto("/?e2e=1");
  await page.waitForFunction(() => !!window.__METAAVES_E2E__);
  const result = await page.evaluate(async () => {
    const api = window.__METAAVES_E2E__;
    const bird = api.state.allBirds.find(item => item.genus && item.family && item.scientificName);
    if (!bird) throw new Error("Loaded bird dataset has no species suitable for Study Card rendering.");
    api.state.mode = "world";
    api.state.mysteryBird = bird;

    const html = [
      '<div class="mw-parser-output">',
      '<p>The test bird is a forest-dwelling bird species.</p>',
      '<h2><span class="mw-headline">Description</span></h2>',
      '<p>The test bird is a forest-dwelling bird species.</p>',
      '<h2><span class="mw-headline">Appearance</span></h2>',
      '<p>It has a dark crown and a pale throat.</p>',
      '<h2><span class="mw-headline">Habitat and distribution</span></h2>',
      '<p>It inhabits lowland forest and woodland.</p>',
      '<h2><span class="mw-headline">Diet</span></h2>',
      '<p>It feeds on insects and small fruit.</p>',
      '<h2><span class="mw-headline">Behaviour</span></h2>',
      '<p>It forages in the canopy and gives a repeated call.</p>',
      '<h2><span class="mw-headline">Breeding</span></h2>',
      '<p>It nests in a tree cavity and lays two eggs.</p>',
      '</div>'
    ].join('');

    const preloaded = {
      wiki: {
        summary: {
          extract: "The test bird is a forest-dwelling bird species.",
          content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Bird" } }
        },
        html,
        wikitext: ""
      },
      thaiName: "",
      onlineConservationStatus: "",
      wikidataDetailed: {},
      externalStudy: {
        appearance: "It has a dark crown and a pale throat.",
        habitatDistribution: "It inhabits lowland forest and woodland.",
        diet: "It feeds on insects and small fruit.",
        behavior: "It forages in the canopy and gives a repeated call.",
        breeding: "It nests in a tree cavity and lays two eggs.",
        conservation: "LC - Least Concern",
        sources: [{ label: "GBIF", url: "https://www.gbif.org/" }]
      }
    };
    const mergedDirectly = api.mergeExternalStudyData(
      api.getWikipediaStudyData(html, "", preloaded.wiki.summary.extract),
      preloaded.externalStudy,
      bird,
      preloaded.wiki.summary.extract
    );
    const renderedStudy = await api.showGameOverCard("won", preloaded);

    const details = document.querySelector(".study-card-details");
    return {
      headings: [...details.querySelectorAll(".study-card-section h4")].map(item => item.textContent),
      content: details.innerText,
      overlayVisible: document.getElementById("game-over-overlay").classList.contains("visible"),
      mergedAppearance: mergedDirectly.appearance,
      renderedAppearance: renderedStudy?.appearance || ""
    };
  });

  assert(result.overlayVisible, "Study Card overlay did not open");
  for (const heading of ["Description", "Appearance", "Habitat & Distribution", "Diet", "Behavior", "Breeding", "Conservation"]) {
    assert(result.headings.includes(heading), "Study Card is missing the " + heading + " section");
  }
  assert(/dark crown/.test(result.mergedAppearance), "External/Wikipedia merge lost Appearance evidence: " + result.mergedAppearance);
  assert(/dark crown/.test(result.renderedAppearance), "Game-over renderer did not receive Appearance evidence: " + result.renderedAppearance);
  assert(/dark crown/.test(result.content), "Study Card omitted Appearance evidence: " + result.content);
  assert(/lowland forest/.test(result.content), "Study Card omitted Habitat evidence");
  assert(/insects/.test(result.content), "Study Card omitted Diet evidence");
  assert(/canopy/.test(result.content), "Study Card omitted Behavior evidence");
  assert(/tree cavity/.test(result.content), "Study Card omitted Breeding evidence");
});

test("MetaAves uses the Wikipedia summary lead when detailed article sections are unavailable", async ({ page }) => {
  await page.goto("/?e2e=1");
  await page.waitForFunction(() => !!window.__METAAVES_E2E__);
  const result = await page.evaluate(() => {
    const api = window.__METAAVES_E2E__;
    const study = api.getWikipediaStudyData(
      "",
      "",
      "The greater necklaced laughingthrush is found in Bangladesh, Bhutan, China, India, Laos, Myanmar, Nepal, Thailand and Vietnam. Its natural habitats are subtropical or tropical moist lowland forest and subtropical or tropical moist montane forest. It feeds on insects and other small invertebrates."
    );
    return study;
  });
  assert(/Bangladesh|Thailand/.test(result.habitatDistribution), "Summary range information was not recovered");
  assert(/lowland forest|montane forest/.test(result.habitatDistribution), "Summary habitat information was not recovered");
  assert(/insects|invertebrates/.test(result.diet), "Summary diet information was not recovered");
});

test("MetaAves separates Appearance from Description and other study-card categories", async ({ page }) => {
  await page.goto("/?e2e=1");
  await page.waitForFunction(() => !!window.__METAAVES_E2E__);
  const result = await page.evaluate(() => {
    const api = window.__METAAVES_E2E__;
    const summary = [
      "The crimson sunbird is a species of bird in the sunbird family.",
      "The male has crimson plumage with a dark throat and blue-green crown.",
      "The female is olive-brown above and yellowish below.",
      "Both sexes have a medium-length, thin, down-curved bill and a brush-tipped tubular tongue, adaptations for nectar feeding.",
      "It feeds largely on nectar and may also take insects.",
      "Its flight is fast and direct on short wings.",
      "It is the unofficial national bird of Singapore.",
      "It occurs in forest and woodland across parts of South and Southeast Asia.",
      "It builds a hanging nest in which it lays two eggs."
    ].join(" ");
    const html = `
      <div class="mw-parser-output">
        <p>The crimson sunbird is a species of bird in the sunbird family.</p>
        <h2><span class="mw-headline" id="Description">Description</span></h2>
        <p>The male has crimson plumage with a dark throat and blue-green crown. The female is olive-brown above and yellowish below. Both sexes have a medium-length, thin, down-curved bill and a brush-tipped tubular tongue, adaptations for nectar feeding. It feeds largely on nectar and may also take insects. Its flight is fast and direct on short wings. It is the unofficial national bird of Singapore.</p>
        <h2><span class="mw-headline" id="Habitat_and_distribution">Habitat and distribution</span></h2>
        <p>It occurs in forest and woodland across parts of South and Southeast Asia.</p>
        <h2><span class="mw-headline" id="Breeding">Breeding</span></h2>
        <p>It builds a hanging nest in which it lays two eggs.</p>
      </div>
    `;
    const study = api.getWikipediaStudyData(html, "", summary);
    return {
      study,
      billSentenceIsAppearance: api.wikipediaSentenceMatchesCategory(
        "Both sexes have a thin, down-curved bill and a brush-tipped tongue adapted for nectar feeding.",
        "appearance"
      ),
      billSentenceIsNotDiet: !api.wikipediaSentenceMatchesCategory(
        "Both sexes have a thin, down-curved bill and a brush-tipped tongue adapted for nectar feeding.",
        "diet"
      ),
      externalBillSentence: api.classifyExternalStudySentence(
        "The bird has a long curved bill and a brush-tipped tongue."
      ),
      externalFlightSentence: api.classifyExternalStudySentence(
        "Its flight is fast and direct on short wings."
      )
    };
  });

  assert(/crimson plumage/i.test(result.study.appearance), "Male plumage was not placed in Appearance");
  assert(/olive-brown/i.test(result.study.appearance), "Female plumage was not placed in Appearance");
  assert(/down-curved bill|brush-tipped tubular tongue/i.test(result.study.appearance), "Bill/tongue anatomy was not placed in Appearance");
  assert(!/crimson plumage|olive-brown|down-curved bill/i.test(result.study.description), "Appearance facts leaked into Description");
  assert(/feeds largely on nectar|takes insects/i.test(result.study.diet), "Actual food sources were not placed in Diet");
  assert(/flight is fast and direct/i.test(result.study.behavior), "Flight behavior was not placed in Behavior");
  assert(/forest and woodland/i.test(result.study.habitatDistribution), "Habitat/range was not placed in Habitat & Distribution");
  assert(/hanging nest|two eggs/i.test(result.study.breeding), "Nesting/eggs were not placed in Breeding");
  assert(/unofficial national bird/i.test(result.study.description), "General species fact was incorrectly discarded from Description");
  assert(result.billSentenceIsAppearance, "Bill/tongue anatomy must classify as Appearance");
  assert(result.billSentenceIsNotDiet, "Feeding-adaptation anatomy must not classify as Diet");
  assert(result.externalBillSentence === "appearance", "External-source appearance sentence was not classified as Appearance");
  assert(result.externalFlightSentence === "behavior", "External-source flight sentence was incorrectly classified as Appearance");
});

test("MetaAves classifies mixed bird ecology prose into the correct study-card sections", async ({ page }) => {
  await page.goto("/?e2e=1");
  await page.waitForFunction(() => !!window.__METAAVES_E2E__);
  const result = await page.evaluate(() => {
    const api = window.__METAAVES_E2E__;
    const sections = {
      "behavior and ecology": [
        "In mixed-species foraging flocks, greater necklaced laughingthrushes tend to be dominant.",
        "The mimicry of this species by the lesser necklaced laughingthrush may have been selected for as a result.",
        "The species feeds on insects and other small invertebrates."
      ].join(" ")
    };
    return {
      diet: api.extractWikipediaCategoryText(sections, "diet", ["diet", "feeding", "food and feeding"]),
      behavior: api.extractWikipediaCategoryText(sections, "behavior", ["behavior", "behaviour", "behavior and ecology"]),
      dominanceIsBehavior: api.wikipediaSentenceMatchesCategory(
        "In mixed-species foraging flocks, the species tends to be dominant.",
        "behavior"
      ),
      dominanceIsNotDiet: !api.wikipediaSentenceMatchesCategory(
        "In mixed-species foraging flocks, the species tends to be dominant.",
        "diet"
      )
    };
  });
  assert(result.dominanceIsBehavior, "Flock dominance must be classified as behavior");
  assert(result.dominanceIsNotDiet, "Flock dominance must not be classified as diet");
  assert(!/dominant|mimicry/i.test(result.diet), "Behavioral facts leaked into the Diet section");
  assert(/feeds on insects/i.test(result.diet), "Actual feeding information was lost from Diet");
  assert(/dominant/i.test(result.behavior), "Flock-dominance information was lost from Behavior");
  assert(/mimicry/i.test(result.behavior), "Behavioral mimicry information was lost from Behavior");
});

test("MetaAves removes captions and subspecies authorities from study-card prose", async ({ page }) => {
  await page.goto("/?e2e=1");
  await page.waitForFunction(() => !!window.__METAAVES_E2E__);
  const result = await page.evaluate(() => {
    const api = window.__METAAVES_E2E__;
    const html = `
      <div class="mw-parser-output">
        <section data-mw-section-id="0">
          <p>The brown boobook is a typical owl species.</p>
        </section>
        <section data-mw-section-id="1">
          <div class="mw-heading"><h2>Diet</h2></div>
          <p>It feeds mainly on large insects, frogs, lizards, small birds, and mice.</p>
          <figure><img src="/caption.jpg"><figcaption>Brown boobook in Phuket, Thailand</figcaption></figure>
          <div class="listen">Brown boobook call</div>
          <ul><li><i>rexpimenti</i> Abdulali, 1979 in Great Nicobar Island</li></ul>
        </section>
        <section data-mw-section-id="2">
          <div class="mw-heading"><h2>Behaviour</h2></div>
          <p>The brown boobook is nocturnal but can often be located by small birds mobbing it while it roosts.</p>
          <p>Its call is a repeated low, soft, musical oo-uk.</p>
        </section>
        <section data-mw-section-id="3">
          <div class="mw-heading"><h2>Breeding</h2></div>
          <p>It lays three to five eggs in a tree hole.</p>
          <ul><li><i>scutulata</i> (Raffles, 1822) in the Malay Peninsula and Sumatra</li></ul>
        </section>
      </div>
    `;
    const study = api.getWikipediaStudyData(html, "", "");
    return study;
  });

  assert(/large insects|frogs|lizards/i.test(result.diet), "Actual prey information was lost from Diet");
  assert(!/Abdulali|Raffles|Great Nicobar|Malay Peninsula/i.test(result.diet), "Subspecies authority/list text leaked into Diet");
  assert(!/Brown boobook in Phuket|Brown boobook call/i.test(result.diet), "Image/audio captions leaked into Diet");
  assert(/nocturnal|roosts/i.test(result.behavior), "Nocturnal/roosting behavior was lost");
  assert(/call is a repeated/i.test(result.behavior), "Call behavior was lost");
  assert(/three to five eggs|tree hole/i.test(result.breeding), "Nesting information was lost");
  assert(!/Raffles|scutulata/i.test(result.breeding), "Subspecies list text leaked into Breeding");
});

test("MetaAves opens a visible genus clue from an actual clickable tree species node", async ({ page }) => {
  await page.goto("/?e2e=1");
  await page.waitForFunction(() => !!window.__METAAVES_E2E__);

  const result = await page.evaluate(() => {
    const api = window.__METAAVES_E2E__;
    const normalize = value => api.normalizeTaxonomyComparisonValue(value);
    const byFamily = new Map();

    for (const bird of api.state.allBirds || []) {
      const family = normalize(bird.family);
      const genus = normalize(bird.genus);
      if (!family || !genus || !bird.scientificName) continue;
      const genera = byFamily.get(family) || new Map();
      if (!genera.has(genus)) genera.set(genus, bird);
      byFamily.set(family, genera);
    }

    let pair = null;
    for (const genera of byFamily.values()) {
      const representatives = [...genera.values()];
      if (representatives.length >= 2) {
        pair = { mystery: representatives[0], guessed: representatives[1] };
        break;
      }
    }
    if (!pair) throw new Error("No same-family/different-genus species pair exists in the loaded AviList data.");

    api.state.mysteryBird = pair.mystery;
    api.state.gameStatus = "playing";
    api.state.mode = "world";

    const node = api.createTreeNodeElement({
      type: "species",
      name: pair.guessed.commonName,
      nodeType: "guess",
      bird: pair.guessed
    });
    document.body.appendChild(node);
    node.click();

    return {
      relationship: api.getHintRelationship(pair.guessed),
      nodeIsClickable: node.classList.contains("meta-species-clickable")
    };
  });

  assert(result.relationship?.rank === "Genus", "Real AviList pair did not unlock a genus relationship");
  assert(result.nodeIsClickable, "Rendered tree species node is not clickable");

  await page.locator("#species-hover-hint.visible").waitFor({ state: "visible", timeout: 5000 });
  await page.waitForFunction(() =>
    /Genus clue/i.test(document.getElementById("species-hover-hint")?.innerText || "")
  );
  const hintText = await page.locator("#species-hover-hint").innerText();
  assert(/About the mystery genus/i.test(hintText), "Genus clue popup title did not render");
  assert(/Genus clue/i.test(hintText), "The clickable tree node did not display a genus clue");
});

test("MetaAves normalizes family/genus labels before clue progression", async ({ page }) => {
  await page.goto("/?e2e=1");
  await page.waitForFunction(() => !!window.__METAAVES_E2E__);
  const result = await page.evaluate(() => {
    const api = window.__METAAVES_E2E__;
    api.state.mysteryBird = {
      commonName: "Mystery bird",
      scientificName: "Strix aluco",
      genus: "Strix",
      family: "Strigidae"
    };
    const genusClue = api.getHintRelationship({
      commonName: "Guessed bird",
      scientificName: "Athene noctua",
      genus: " athene ",
      family: " strigidae "
    });
    const speciesClue = api.getHintRelationship({
      commonName: "Congener",
      scientificName: "STRIX URALENSIS",
      genus: " strix ",
      family: "STRIGIDAE"
    });
    return {
      genusRank: genusClue?.rank,
      speciesRank: speciesClue?.rank
    };
  });
  assert(result.genusRank === "Genus", "Case/spacing differences suppressed a valid genus clue");
  assert(result.speciesRank === "Species", "Case/spacing differences suppressed a valid species clue");
});

test("MetaAves produces genus clues from genus-level GBIF/iNaturalist evidence and keeps species evidence separate", async ({ page }) => {
  await page.goto("/?e2e=1");
  await page.waitForFunction(() => !!window.__METAAVES_E2E__);
  const result = await page.evaluate(() => {
    const api = window.__METAAVES_E2E__;
    const external = api.classifyExternalStudyText([
      "These birds are nocturnal and hunt after sunset.",
      "They feed on insects and small vertebrates."
    ]);
    api.state.mysteryBird = {
      commonName: "Mystery bird",
      scientificName: "GenusA alpha",
      genus: "GenusA",
      family: "FamilyA"
    };
    const genusClues = api.buildGenusHint(
      {
        description: "These birds are nocturnal and hunt after sunset.",
        behavior: external.behavior,
        diet: external.diet
      },
      {
        description: "These birds are active during daylight.",
        behavior: "These birds are active during daylight."
      },
      {
        commonName: "Guessed bird",
        scientificName: "GenusB beta",
        genus: "GenusB",
        family: "FamilyA"
      }
    );
    return { external, genusClues };
  });

  assert(/nocturnal|hunt after sunset/i.test(result.external.behavior), "Genus-level behavior evidence was not classified");
  assert(/insects|small vertebrates/i.test(result.external.diet), "Genus-level feeding evidence was not classified");
  assert(result.genusClues.some(clue => /Genus clue/.test(clue.heading)), "Genus-level source evidence did not produce a visible genus clue");
  assert(result.genusClues.every(clue => !/species clue/i.test(clue.heading)), "Genus evidence was incorrectly labelled as a species clue");
});

test("MetaAves validates taxon pages and enforces two-stage clue progression", async ({ page }) => {
  await page.goto("/?e2e=1");
  await page.waitForFunction(() => !!window.__METAAVES_E2E__);
  const result = await page.evaluate(() => {
    const api = window.__METAAVES_E2E__;
    return {
      rejectsPasta: !api.isWikipediaTaxonPage({
        title: "Pici",
        description: "A type of pasta",
        extract: "Pici is a thick, hand-rolled pasta from Tuscany."
      }, "Pici (taxon)", "clade"),
      acceptsTaxon: api.isWikipediaTaxonPage({
        title: "Pici (taxon)",
        description: "Suborder of birds",
        extract: "Pici is a suborder of Piciformes, a group of birds including woodpeckers and toucans."
      }, "Pici (taxon)", "clade"),
      sameFamilyDifferentGenusShowsGenusOnly: (() => {
        api.state.mysteryBird = {
          commonName: "Bird B", scientificName: "GenusB b", genus: "GenusB", family: "FamilyX"
        };
        return api.getHintRelationship({
          commonName: "Bird A", scientificName: "GenusA a", genus: "GenusA", family: "FamilyX"
        })?.rank === "Genus";
      })(),

      sameSpeciesDoesNotShowClue: (() => {
        api.state.mysteryBird = {
          commonName: "Bird A", scientificName: "GenusA a", genus: "GenusA", family: "FamilyX"
        };
        return api.getHintRelationship({
          commonName: "Bird A", scientificName: "GenusA a", genus: "GenusA", family: "FamilyX"
        }) === null;
      })(),
      differentFamilyDoesNotShowClue: (() => {
        api.state.mysteryBird = {
          commonName: "Bird B", scientificName: "GenusB b", genus: "GenusB", family: "FamilyY"
        };
        return api.getHintRelationship({
          commonName: "Bird A", scientificName: "GenusA a", genus: "GenusA", family: "FamilyX"
        }) === null;
      })(),
      sameGenusShowsSpeciesClue: (() => {
        api.state.mysteryBird = {
          commonName: "Bird B", scientificName: "GenusA b", genus: "GenusA", family: "FamilyX"
        };
        return api.getHintRelationship({
          commonName: "Bird A", scientificName: "GenusA a", genus: "GenusA", family: "FamilyX"
        })?.rank === "Species";
      })()
    };
  });
  assert(result.rejectsPasta, "Taxon Wikipedia validator accepted the unrelated Pici pasta page");
  assert(result.acceptsTaxon, "Taxon Wikipedia validator rejected the disambiguated Pici taxon page");
  assert(result.sameFamilyDifferentGenusShowsGenusOnly, "Same-family/different-genus guess must enable only the genus clue");
  assert(result.sameGenusShowsSpeciesClue, "Same-genus guess must enable the species clue");
  assert(result.sameSpeciesDoesNotShowClue, "Guessing the mystery species must not show a clue");
  assert(result.differentFamilyDoesNotShowClue, "Different-family guesses must not unlock genus or species clues");
});
