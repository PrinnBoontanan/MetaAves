
const { chromium } = require('playwright');

// ==============================
// SETTINGS

// ==============================

const URL = 'http://localhost:8080';

// Time between guesses.
// 3000 = 3 seconds.
const DELAY_AFTER_GUESS = 5000;

// Keep the browser visible.
const HEADLESS = false;


// ==============================
// HELPERS
// ==============================

function shuffle(array) {
    const copy = [...array];

    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));

        [copy[i], copy[j]] = [copy[j], copy[i]];
    }

    return copy;
}


// ==============================
// MAIN
// ==============================

(async () => {
    const browser = await chromium.launch({
        headless: HEADLESS
    });

    const page = await browser.newPage();

    // Show JavaScript errors from the game.
    page.on('pageerror', error => {
        console.error('[PAGE ERROR]', error);
    });

    // Show console errors from the game.
    page.on('console', message => {
        if (message.type() === 'error') {
            console.error('[CONSOLE ERROR]', message.text());
        }
    });

    try {
        console.log('Opening MetaAves...');

        await page.goto(URL, {
            waitUntil: 'networkidle'
        });

        // Wait for the game to finish loading.
        await page.waitForFunction(() => {
            return (
                typeof gameState !== 'undefined' &&
                Array.isArray(gameState.birds) &&
                gameState.birds.length > 0 &&
                gameState.mysteryBird
            );
        });

        console.log('Game loaded.');

        // ==========================================
        // GET ALL BIRDS
        // ==========================================

        const birds = await page.evaluate(() => {
            return gameState.birds.map(bird => ({
                commonName: bird.commonName
            }));
        });

        if (!birds.length) {
            throw new Error('No birds were found in gameState.birds.');
        }

        console.log(`Loaded ${birds.length} birds.`);

        // ==========================================
        // SHUFFLE ALL BIRDS
        // ==========================================
        //
        // IMPORTANT:
        // We intentionally DO NOT remove the mystery bird.
        //
        // This means the game can naturally:
        //   - WIN if the mystery bird is guessed
        //   - LOSE if 12 wrong birds are guessed first
        //

        const guesses = shuffle(birds);

        // ==========================================
        // GET UI ELEMENTS
        // ==========================================

        const searchInput = page.locator('#bird-search');
        const guessButton = page.locator('#guess-button');

        // ==========================================
        // MAKE GUESSES ONE BY ONE
        // ==========================================

        let guessNumber = 0;

        while (true) {
            // Check whether the game is still running.
            const status = await page.evaluate(() => {
                return gameState.gameStatus;
            });

            if (status !== 'playing') {
                console.log(`Game ended with status: ${status}`);
                break;
            }

            // Make sure we haven't somehow run out of birds.
            if (guessNumber >= guesses.length) {
                console.log('Ran out of birds to guess.');
                break;
            }

            const bird = guesses[guessNumber];

            guessNumber++;

            console.log(
                `Guess ${guessNumber}: ${bird.commonName}`
            );

            // Fill the search box exactly like a user would.
            await searchInput.fill(bird.commonName);

            // Click the actual Guess button.
            await guessButton.click();

            // Wait so you can watch the tree/card update.
            await page.waitForTimeout(DELAY_AFTER_GUESS);
        }

        // ==========================================
        // WAIT FOR STUDY CARD
        // ==========================================

        console.log('Waiting for Study Card...');

        const gameOverOverlay = page.locator(
            '#game-over-overlay.visible'
        );

        await gameOverOverlay.waitFor({
            state: 'visible',
            timeout: 30000
        });

        console.log('');
        console.log('================================');
        console.log('STUDY CARD IS NOW OPEN');
        console.log('================================');
        console.log('');
        console.log('Automation has stopped.');
        console.log('The browser will remain open.');
        console.log('Inspect the Study Card manually.');
        console.log('');

        // ==========================================
        // STOP HERE
        // ==========================================
        //
        // DO NOT click Replay.
        // DO NOT start another game.
        //
        // Keep Node running so the browser stays open.

        await new Promise(() => {});

    } catch (error) {
        console.error('');
        console.error('==============================');
        console.error('AUTOMATION ERROR');
        console.error('==============================');
        console.error(error);
        console.error('');
    }
})();

