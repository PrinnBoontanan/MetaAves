# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: game-system.spec.js >> MetaAves full game-system audit — 20 games
- Location: tests/game-system.spec.js:390:1

# Error details

```
ReferenceError: browserErrors is not defined
```

```
Error: page.waitForFunction: Test ended.
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - main [ref=e2]:
    - generic [ref=e3]:
      - heading "MetaAves" [level=1] [ref=e4]
      - paragraph [ref=e9]: The Taxonomic Bird Game
    - generic [ref=e10]:
      - button [ref=e11] [cursor=pointer]:
        - text: "🌍 Mode:"
        - strong [ref=e12]: Choose mode
      - generic [ref=e13]:
        - text: "🎯 Guesses:"
        - strong [ref=e14]: "12"
    - generic [ref=e15]:
      - heading "⌕ Guess the mystery bird" [level=2] [ref=e16]:
        - generic [ref=e17]: ⌕
        - text: Guess the mystery bird
      - generic [ref=e18]:
        - combobox "Enter an English bird name..." [ref=e20]
        - button "⌕ Guess" [ref=e21] [cursor=pointer]:
          - generic: ⌕
          - text: Guess
    - generic [ref=e22]:
      - generic [ref=e23]:
        - generic [ref=e24]:
          - generic [ref=e25]:
            - generic [aria-hidden] [ref=e26]: ◆
            - generic [ref=e27]:
              - heading "Taxonomy" [level=2] [ref=e28]
              - paragraph [ref=e29]: Explore how your guesses connect.
          - group "Taxonomy view" [ref=e30]:
            - button "Tree" [ref=e31] [cursor=pointer]
            - button "Table" [ref=e32] [cursor=pointer]
        - paragraph [ref=e35]: Your guesses will appear here.
      - generic [ref=e36]:
        - heading "◇ Taxon Information" [level=2] [ref=e37]:
          - generic [ref=e38]: ◇
          - text: Taxon Information
        - generic [ref=e39]:
          - heading "Select a taxon" [level=3] [ref=e40]
          - paragraph [ref=e41]: Click a taxon in the tree to learn more about it.
  - button "Thai ↔ English" [ref=e42] [cursor=pointer]
```

# Test source

```ts
  314 |       })
  315 |       .filter(Boolean);
  316 | 
  317 |     return {
  318 |       modelNodeCount: modelNodes.length,
  319 |       domNodeCount: domNodes.length,
  320 |       missing,
  321 |       duplicateIds,
  322 |       formalRankErrors
  323 |     };
  324 |   });
  325 | 
  326 |   assert(
  327 |     result.missing.length === 0,
  328 |     `${label}: tree model nodes missing from DOM: ${result.missing.join(", ")}`
  329 |   );
  330 |   assert(
  331 |     result.duplicateIds.length === 0,
  332 |     `${label}: duplicate tree node IDs: ${result.duplicateIds.join(", ")}`
  333 |   );
  334 |   assert(
  335 |     result.formalRankErrors.length === 0,
  336 |     `${label}: formal taxonomy ranks lost in tree model: ${result.formalRankErrors.join(", ")}`
  337 |   );
  338 | }
  339 | 
  340 | async function verifyStudyCard(page, mystery) {
  341 |   // showGameOverCard performs online enrichment asynchronously. Wait until
  342 |   // the final taxonomy rows have replaced the initial loading/local rows
  343 |   // before auditing their contents.
  344 |   await page.waitForFunction(
  345 |     expected => {
  346 |       const container = document.querySelector("#study-taxonomy");
  347 |       const text = container?.innerText || "";
  348 |       return (
  349 |         text.includes(expected.order) &&
  350 |         text.includes(expected.family) &&
  351 |         text.includes(expected.genus) &&
  352 |         text.includes(expected.scientificName)
  353 |       );
  354 |     },
  355 |     mystery,
  356 |     { timeout: 15000 }
  357 |   );
  358 | 
  359 |   const text = await page.locator("#study-taxonomy").innerText();
  360 |   assert(text.includes(mystery.order), `Study card missing order for ${mystery.commonName}`);
  361 |   assert(text.includes(mystery.family), `Study card missing family for ${mystery.commonName}`);
  362 |   assert(text.includes(mystery.genus), `Study card missing genus for ${mystery.commonName}`);
  363 |   assert(text.includes(mystery.scientificName), `Study card missing scientific name for ${mystery.commonName}`);
  364 | 
  365 |   const formalRanks = await page.evaluate(() => {
  366 |     const api = window.__METAAVES_E2E__;
  367 |     return api.getBirdPhylogenyPath(api.state.mysteryBird)
  368 |       .map(node => {
  369 |         const clade = node.id?.startsWith("clade:")
  370 |           ? api.state.clades?.[node.id]
  371 |           : null;
  372 |         return { rank: clade?.rank || node.level, name: node.value };
  373 |       })
  374 |       .filter(entry => entry.rank && entry.rank !== "clade" && entry.rank !== "species");
  375 |   });
  376 | 
  377 |   for (const entry of formalRanks) {
  378 |     const label = entry.rank.charAt(0).toUpperCase() + entry.rank.slice(1);
  379 |     assert(
  380 |       text.includes(entry.name),
  381 |       `Study card missing ${label} value "${entry.name}" for ${mystery.commonName}`
  382 |     );
  383 |     assert(
  384 |       text.toLowerCase().includes(label.toLowerCase()),
  385 |       `Study card missing ${label} label for ${mystery.commonName}`
  386 |     );
  387 |   }
  388 | }
  389 | 
  390 | test(`MetaAves full game-system audit — ${GAME_COUNT} games`, async ({ page }) => {
  391 |   const report = [];
  392 |   const failures = [];
  393 |   const databaseErrors = [];
  394 |   const consoleErrors = [];
  395 |   let activeGame = 0;
  396 | 
  397 |   page.on("pageerror", error => {
  398 |     consoleErrors.push({ game: activeGame || "startup", type: "pageerror", message: error.message });
  399 |   });
  400 |   page.on("console", message => {
  401 |     if (message.type() === "error") {
  402 |       consoleErrors.push({ game: activeGame || "startup", type: "console", message: message.text() });
  403 |     }
  404 |   });
  405 |   page.on("response", response => {
  406 |     if (response.status() === 404) {
  407 |         browserErrors.push(
  408 |             `HTTP 404 [${response.request().resourceType()}] ${response.url()}`
  409 |         );
  410 |     }
  411 |   });
  412 | 
  413 |   await page.goto("/?e2e=1");
> 414 |   await page.waitForFunction(() => !!window.__METAAVES_E2E__);
      |              ^ Error: page.waitForFunction: Test ended.
  415 | 
  416 |   const data = await loadData(page);
  417 |   const audit = await auditDatabase(data);
  418 | 
  419 |   if (audit.errors.length) {
  420 |     databaseErrors.push(...audit.errors);
  421 |     console.log(`Database audit found ${audit.errors.length} issue(s); game audit will continue so all runtime failures can be collected.`);
  422 |   }
  423 | 
  424 |   const api = await getApi(page);
  425 |   assert(api.birdCount === audit.birdCount, "Browser and database bird counts differ");
  426 | 
  427 |   const modes = api.thailandReady
  428 |     ? Array.from({ length: GAME_COUNT }, (_, i) => i % 2 === 0 ? "world" : "thailand")
  429 |     : Array.from({ length: GAME_COUNT }, () => "world");
  430 | 
  431 |   for (let game = 0; game < GAME_COUNT; game++) {
  432 |     const mode = modes[game];
  433 |     const shouldWin = game % 2 === 0;
  434 |     activeGame = game + 1;
  435 | 
  436 |     try {
  437 |       await startMode(page, mode);
  438 |       let state = await getState(page);
  439 | 
  440 |     assert(state.mystery.commonName, `Game ${game + 1}: no mystery bird`);
  441 |     assert(state.remaining === 12, `Game ${game + 1}: game did not start at 12 guesses`);
  442 | 
  443 |     const pool = await page.evaluate(() =>
  444 |       window.__METAAVES_E2E__.state.birds.map(b => ({
  445 |         commonName: b.commonName,
  446 |         scientificName: b.scientificName
  447 |       }))
  448 |     );
  449 | 
  450 |     const mysteryName = state.mystery.commonName;
  451 |     const wrongBirds = pool.filter(b => b.commonName !== mysteryName).slice(
  452 |       game % Math.max(1, pool.length - 13),
  453 |       game % Math.max(1, pool.length - 13) + 12
  454 |     );
  455 | 
  456 |     assert(wrongBirds.length >= 12, `Game ${game + 1}: not enough wrong birds`);
  457 | 
  458 |     // Search/autocomplete smoke test before the first guess.
  459 |     const searchPrefix = wrongBirds[0].commonName.slice(0, 2);
  460 |     await page.locator("#bird-search").fill(searchPrefix);
  461 |     await expect(page.locator("#suggestions")).toHaveClass(/visible/);
  462 | 
  463 |     const suggestions = await page.locator(".suggestion").allTextContents();
  464 |     for (const name of suggestions) {
  465 |       assert(
  466 |         pool.some(b => b.commonName === name),
  467 |         `Game ${game + 1}: suggestion is not in active pool: ${name}`
  468 |       );
  469 |     }
  470 | 
  471 |     await page.locator("#bird-search").fill("");
  472 |     await page.locator("#bird-search").press("Escape").catch(() => {});
  473 | 
  474 |     // Invalid guess must not consume a guess.
  475 |     const beforeInvalid = await getState(page);
  476 |     await makeUiGuess(page, "Definitely Not A Real MetaAves Bird");
  477 |     const afterInvalid = await getState(page);
  478 |     assert(
  479 |       afterInvalid.remaining === beforeInvalid.remaining &&
  480 |       afterInvalid.guesses.length === beforeInvalid.guesses.length,
  481 |       `Game ${game + 1}: invalid guess changed game state`
  482 |     );
  483 | 
  484 |     // First real wrong guess.
  485 |     await makeUiGuess(page, wrongBirds[0].commonName);
  486 |     state = await getState(page);
  487 |     assert(state.remaining === 11, `Game ${game + 1}: first guess did not decrement`);
  488 |     assert(state.guesses.length === 1, `Game ${game + 1}: first guess not recorded`);
  489 | 
  490 |     const endpoint = await page.evaluate(() => {
  491 |       const s = window.__METAAVES_E2E__.state;
  492 |       const guessed = s.guesses[s.guesses.length - 1];
  493 |       return window.__METAAVES_E2E__.getDeepestSharedTaxon(guessed, s.mysteryBird);
  494 |     });
  495 | 
  496 |     assert(endpoint?.id, `Game ${game + 1}: no shared taxonomy endpoint`);
  497 |     await verifyTree(page, `Game ${game + 1}, first wrong guess`);
  498 | 
  499 |     // Duplicate guess must not consume another guess.
  500 |     const beforeDuplicate = await getState(page);
  501 |     await makeUiGuess(page, wrongBirds[0].commonName);
  502 |     const afterDuplicate = await getState(page);
  503 |     assert(
  504 |       afterDuplicate.remaining === beforeDuplicate.remaining &&
  505 |       afterDuplicate.guesses.length === beforeDuplicate.guesses.length,
  506 |       `Game ${game + 1}: duplicate guess changed game state`
  507 |     );
  508 | 
  509 |     // A guessed bird must disappear from autocomplete suggestions.
  510 |     await page.locator("#bird-search").fill(searchPrefix);
  511 |     const postGuessSuggestions = await page.locator(".suggestion").allTextContents();
  512 |     assert(
  513 |       !postGuessSuggestions.includes(wrongBirds[0].commonName),
  514 |       `Game ${game + 1}: already-guessed bird still appears in suggestions`
```