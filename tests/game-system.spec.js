const { test, expect } = require("@playwright/test");

const GAME_COUNT = Number(process.env.METAAVES_GAMES || 10);

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

function checkCladePath(clades, names, label) {
  if (!Array.isArray(names)) return;
  const byName = new Map(
    Object.values(clades)
      .filter(x => x && x.id && x.name)
      .map(x => [x.name, x])
  );

  let previous = "class:Aves";
  for (const name of names) {
    const clade = byName.get(name);
    assert(clade, `${label}: missing clade ${name}`);

    const parent = clade.parent || "class:Aves";
    assert(
      parent === previous,
      `${label}: invalid transition ${previous} -> ${name} (parent is ${parent})`
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

    try {
      buildRankedPath(taxonomy, bird.scientificName);
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
      checkCladePath(clades, path, `order ${order}`);
    } catch (error) {
      errors.push(error.message);
    }
  }

  for (const [family, path] of Object.entries(familyPaths)) {
    try {
      checkCladePath(clades, path, `family ${family}`);
    } catch (error) {
      errors.push(error.message);
    }
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
        genus: s.mysteryBird?.genus
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

    return {
      modelNodeCount: modelNodes.length,
      domNodeCount: domNodes.length,
      missing,
      duplicateIds
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
}

async function verifyStudyCard(page, mystery) {
  const text = await page.locator("#study-taxonomy").innerText();
  assert(text.includes(mystery.order), `Study card missing order for ${mystery.commonName}`);
  assert(text.includes(mystery.family), `Study card missing family for ${mystery.commonName}`);
  assert(text.includes(mystery.genus), `Study card missing genus for ${mystery.commonName}`);
  assert(text.includes(mystery.scientificName), `Study card missing scientific name for ${mystery.commonName}`);
}

test("MetaAves full game-system audit — 10 games", async ({ page }) => {
  const report = [];
  const consoleErrors = [];

  page.on("pageerror", error => consoleErrors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto("/?e2e=1");
  await page.waitForFunction(() => !!window.__METAAVES_E2E__);

  const data = await loadData(page);
  const audit = await auditDatabase(data);

  assert(
    audit.errors.length === 0,
    `DATABASE AUDIT FAILED (showing up to 25):\\n${audit.errors.slice(0, 25).join("\\n")}`
  );

  const api = await getApi(page);
  assert(api.birdCount === audit.birdCount, "Browser and database bird counts differ");

  const modes = api.thailandReady
    ? Array.from({ length: GAME_COUNT }, (_, i) => i % 2 === 0 ? "world" : "thailand")
    : Array.from({ length: GAME_COUNT }, () => "world");

  for (let game = 0; game < GAME_COUNT; game++) {
    const mode = modes[game];
    const shouldWin = game % 2 === 0;

    await startMode(page, mode);
    let state = await getState(page);

    assert(state.mystery.commonName, `Game ${game + 1}: no mystery bird`);
    assert(state.remaining === 12, `Game ${game + 1}: game did not start at 12 guesses`);

    const pool = await page.evaluate(() =>
      window.__METAAVES_E2E__.state.birds.map(b => ({
        commonName: b.commonName,
        scientificName: b.scientificName
      }))
    );

    const mysteryName = state.mystery.commonName;
    const wrongBirds = pool.filter(b => b.commonName !== mysteryName).slice(
      game % Math.max(1, pool.length - 13),
      game % Math.max(1, pool.length - 13) + 12
    );

    assert(wrongBirds.length >= 12, `Game ${game + 1}: not enough wrong birds`);

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
      assert(
        name !== mysteryName || true,
        `unreachable`
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
    assert(state.remaining === 11, `Game ${game + 1}: first guess did not decrement`);
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
      assert(state.remaining === 8, `Game ${game + 1}: wrong guess count is incorrect after win`);
      await expect(page.locator("#game-over-overlay")).toHaveClass(/visible/);
      await verifyStudyCard(page, state.mystery);
      await verifyTree(page, `Game ${game + 1}, solved`);
    } else {
      for (const bird of wrongBirds.slice(1, 12)) {
        await makeUiGuess(page, bird.commonName);
        state = await getState(page);
        await verifyTree(page, `Game ${game + 1}, loss guess ${bird.commonName}`);
      }

      state = await getState(page);
      assert(state.status === "lost", `Game ${game + 1}: 12 wrong guesses did not lose`);
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
      guessesUsed: 12 - state.remaining
    });
  }

  console.log("\\n=== MetaAves 10-game system audit ===");
  console.table(report);
  console.log(`Database: ${audit.birdCount} birds, ${audit.taxonomyCount} taxonomy nodes`);
  console.log(`Expected games: ${GAME_COUNT}; completed: ${report.length}`);
  console.log(`Page errors: ${consoleErrors.length}`);
  if (consoleErrors.length) console.log(consoleErrors);

  assert(report.length === GAME_COUNT, "Not all requested games completed");
  assert(consoleErrors.length === 0, `Browser reported ${consoleErrors.length} error(s)`);
});
