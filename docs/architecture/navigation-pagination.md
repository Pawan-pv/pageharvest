# Navigation, Pagination & Infinite Scroll Architecture

## 1. Pagination Modes

PageHarvest supports three navigation strategies for multi-page extraction:

1. **Single Page (`none`)**: Extract only records currently present on the active page.
2. **Next Button (`next_button`)**:
   - Locates the pagination "Next" button/anchor via selector (or heuristic search for `a:contains("Next")`, `rel="next"`, `[aria-label*="next" i]`).
   - Clicks the next button or navigates to the next URL.
   - Waits for DOM mutations (`MutationObserver`) or page load event.
   - Extracts subsequent page records until `maxPages` is reached or next button becomes disabled/disappears.
3. **Infinite Scroll (`infinite_scroll`)**:
   - Scrolls the window or scroll container down in increments.
   - Waits for network idle or DOM mutations (new elements rendered).
   - Monitors container child count: if no new children appear after consecutive scroll attempts (with configurable delay), stop condition triggers.
   - Caps total scrolls at `scrollCount`.

## 2. Circuit Breakers & Safety Limits
- **Max Pages / Scrolls**: Prevents infinite loops. Default max pages: 20; max scrolls: 50.
- **Delay Throttling**: User-configurable delay between requests/clicks (minimum 500ms, default 1500ms) to ensure gentle browsing behavior without overwhelming browser resources.
- **Zero-New-Records Break**: If an extraction step yields 0 new unique records for 3 consecutive steps, the runner automatically halts and completes the dataset.
- **Pause & Stop Controls**: Real-time abort signal allows the user to immediately cancel or pause extraction at any moment.
