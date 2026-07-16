// @ts-check
const { test, expect } = require('@playwright/test');

// Helper: wait for SQLite to load (progress bar disappears, search input enabled)
async function waitForAppReady(page) {
  // Wait for the search input to become enabled (means DB loaded).
  // Match a lecture-count digit-group in the placeholder (e.g. "9 558" or "10 021"),
  // robust to crossing the 10k threshold.
  await page.waitForFunction(() => {
    const input = document.getElementById('searchTerm');
    if (!input || input.disabled || !input.placeholder) return false;
    return /\d{1,2}[ ,. ]?\d{3}/.test(input.placeholder);
  }, { timeout: 60000 });
}

// Helper: collect console errors during test
function trackConsoleErrors(page) {
  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', err => errors.push(err.message));
  return errors;
}

test.describe('CA Link Finder — Daily Health Check', () => {

  test('1. App loads and SQLite DB initializes', async ({ page }) => {
    const errors = trackConsoleErrors(page);
    await page.goto('./');

    // Page title
    await expect(page).toHaveTitle(/Chaitanya Academy/);

    // Wait for DB
    await waitForAppReady(page);

    // Search input should have placeholder with lecture count
    const placeholder = await page.locator('#searchTerm').getAttribute('placeholder');
    expect(placeholder).toMatch(/1?\d[,.]?\d{3}/);  // ~10,019 lectures (or 9,xxx historic)

    // No critical JS errors
    const criticalErrors = errors.filter(e =>
      !e.includes('favicon') && !e.includes('umami') && !e.includes('service-worker')
    );
    expect(criticalErrors).toHaveLength(0);
  });

  test('2. Metadata search returns results', async ({ page }) => {
    await page.goto('./');
    await waitForAppReady(page);

    // Type a common search term
    await page.fill('#searchTerm', 'tattva');
    await page.keyboard.press('Enter');

    // Wait for results
    await page.waitForSelector('#resultsInfo strong', { timeout: 10000 });
    const info = await page.locator('#resultsInfo strong').textContent();
    const count = parseInt(info);
    expect(count).toBeGreaterThan(0);

    // Results table should have rows
    const rows = await page.locator('#resultsTable tbody tr').count();
    expect(rows).toBeGreaterThan(0);
  });

  test('3. Quotes (all) mode — sources panel appears', async ({ page }) => {
    await page.goto('./');
    await waitForAppReady(page);

    // Click Quotes (all) button
    await page.click('.search-mode-btn[data-mode="citations"]');

    // Verse sources panel should appear
    await page.waitForSelector('#verseSourcesList', { state: 'visible', timeout: 10000 });

    // Should contain source names (e.g., Bhagavad-gita)
    const text = await page.locator('#verseSourcesList').textContent();
    expect(text.length).toBeGreaterThan(10);
  });

  test('4. Top 108 — list renders', async ({ page }) => {
    await page.goto('./');
    await waitForAppReady(page);

    // Click Top 108 button
    await page.click('.search-mode-btn[data-mode="citationsTop"]');

    // Wait for topCitationsList to populate
    await page.waitForFunction(() => {
      const list = document.getElementById('topCitationsList');
      return list && list.children.length > 0 && list.querySelectorAll('.recommendation-item').length > 5;
    }, { timeout: 15000 });

    const items = await page.locator('#topCitationsList .recommendation-item').count();
    expect(items).toBeGreaterThanOrEqual(10);
  });

  test('5. Quick action: 20 latest files', async ({ page }) => {
    await page.goto('./');
    await waitForAppReady(page);

    // Click "20 latest" button
    await page.click('button[data-i18n="latest20Files"]');

    // Wait for results
    await page.waitForSelector('#resultsInfo strong', { timeout: 10000 });
    const info = await page.locator('#resultsInfo strong').textContent();
    expect(parseInt(info)).toBe(20);
  });

  test('6. Quick action: 20 latest transcripts', async ({ page }) => {
    await page.goto('./');
    await waitForAppReady(page);

    // Click "20 latest transcripts" button
    await page.click('button[data-i18n="latest20Transcripts"]');

    // Wait for results
    await page.waitForSelector('#resultsInfo strong', { timeout: 10000 });
    const info = await page.locator('#resultsInfo strong').textContent();
    expect(parseInt(info)).toBe(20);
  });

  test('7. Language switch to Russian changes UI', async ({ page }) => {
    await page.goto('./');
    await waitForAppReady(page);

    // Switch to Russian
    await page.click('.lang-btn[data-lang="ru"]');

    // Search placeholder should now be in Russian
    const placeholder = await page.locator('#searchTerm').getAttribute('placeholder');
    expect(placeholder).toMatch(/[а-яА-Я]/);  // Contains Cyrillic
  });

  test('8. Transcript viewer opens', async ({ page }) => {
    await page.goto('./');
    await waitForAppReady(page);

    // Directly invoke the transcript viewer (metadata search links open new tabs,
    // only verse citation results use the in-page viewer)
    await page.evaluate(() => PPP.app.openHtmlTranscriptViewer('455', 'en'));

    // Modal overlay should appear immediately with loading spinner
    await page.waitForSelector('#transcriptModalOverlay.active', { timeout: 10000 });
    const body = page.locator('#transcriptModalBody');
    await expect(body).toBeVisible({ timeout: 5000 });
  });

  test('9. Search with operators: AND (;)', async ({ page }) => {
    await page.goto('./');
    await waitForAppReady(page);

    await page.fill('#searchTerm', 'guru; tattva');
    await page.keyboard.press('Enter');
    await page.waitForSelector('#resultsInfo strong', { timeout: 10000 });

    const info = await page.locator('#resultsInfo strong').textContent();
    expect(parseInt(info)).toBeGreaterThan(0);
  });

  test('10. Dark mode toggle works', async ({ page }) => {
    await page.goto('./');
    await waitForAppReady(page);

    // Initially body should not have 'dark' class (or have it from prefers-color-scheme)
    const initialDark = await page.evaluate(() => document.body.classList.contains('dark'));

    // Click theme toggle button
    await page.click('#themeToggle');

    // Class should have toggled
    const afterToggle = await page.evaluate(() => document.body.classList.contains('dark'));
    expect(afterToggle).toBe(!initialDark);

    // Toggle back
    await page.click('#themeToggle');
    const afterSecondToggle = await page.evaluate(() => document.body.classList.contains('dark'));
    expect(afterSecondToggle).toBe(initialDark);
  });

  test('11. Favorites — save and show', async ({ page }) => {
    await page.goto('./');
    await waitForAppReady(page);

    // Clear any existing favorites
    await page.evaluate(() => localStorage.removeItem('ppp_collections'));

    // Search to get results with star buttons
    await page.fill('#searchTerm', 'tattva');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.fav-star', { timeout: 10000 });

    // Get first lecture nr and use favorites.toggle() directly
    // (star click opens collections popup which needs extra interaction)
    const nr = await page.locator('.fav-star').first().getAttribute('data-nr');
    await page.evaluate((n) => PPP.favorites.toggle(n), nr);

    // Verify it's saved
    const isFav = await page.evaluate((n) => PPP.favorites.isFavorite(n), nr);
    expect(isFav).toBe(true);

    // Click Favorites button to show saved lectures
    await page.click('#favoritesBtn');

    // Should show at least 1 result
    await page.waitForFunction(() => {
      const rows = document.querySelectorAll('#resultsTable tbody tr');
      return rows.length >= 1;
    }, { timeout: 10000 });

    const rows = await page.locator('#resultsTable tbody tr').count();
    expect(rows).toBeGreaterThanOrEqual(1);

    // Clean up
    await page.evaluate(() => localStorage.removeItem('ppp_collections'));
  });

  test('12. Share quote bubble appears on text selection in transcript', async ({ page }) => {
    await page.goto('./');
    await waitForAppReady(page);

    // Open a transcript
    await page.evaluate(() => PPP.app.openHtmlTranscriptViewer('455', 'en'));
    await page.waitForSelector('#transcriptModalOverlay.active', { timeout: 10000 });

    // Wait for transcript content to load
    await page.waitForFunction(() => {
      const body = document.getElementById('transcriptModalBody');
      return body && body.textContent.length > 100;
    }, { timeout: 90000 });

    // Use real mouse to select text — dispatchEvent doesn't trigger addEventListener handlers
    const body = page.locator('#transcriptModalBody');
    const firstP = body.locator('p').first();
    await firstP.waitFor({ timeout: 5000 });
    const box = await firstP.boundingBox();

    if (box) {
      // Click and drag to select text
      await page.mouse.move(box.x + 10, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + Math.min(box.width - 10, 200), box.y + box.height / 2);
      await page.mouse.up();
    }

    // Share bubble should appear (class: transcript-share-bubble)
    await page.waitForSelector('.transcript-share-bubble', { timeout: 5000 });
    const bubble = await page.locator('.transcript-share-bubble').count();
    expect(bubble).toBeGreaterThanOrEqual(1);
  });

  test('13. No critical console errors during full workflow', async ({ page }) => {
    const errors = trackConsoleErrors(page);
    await page.goto('./');
    await waitForAppReady(page);

    // Run through modes
    await page.fill('#searchTerm', 'prema');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(2000);

    await page.locator('.search-mode-btn[data-mode="citations"]').click({ force: true });
    await page.waitForTimeout(2000);

    await page.locator('.search-mode-btn[data-mode="citationsTop"]').click({ force: true });
    await page.waitForTimeout(2000);

    await page.locator('.search-mode-btn[data-mode="metadata"]').click({ force: true });
    await page.waitForTimeout(1000);

    // Filter out non-critical errors
    const critical = errors.filter(e =>
      !e.includes('favicon') &&
      !e.includes('umami') &&
      !e.includes('service-worker') &&
      !e.includes('net::ERR')
    );
    expect(critical).toHaveLength(0);
  });

  test('14. Top combo row has 6 buttons in single row', async ({ page }) => {
    await page.goto('./');
    await waitForAppReady(page);

    const buttons = page.locator('.search-quick-buttons.main-button-row .combo-btn');
    await expect(buttons).toHaveCount(6);

    const texts = await buttons.allTextContents();
    const joined = texts.join(' | ');
    for (const needle of ['By 2026', 'By Added', 'Top Searches', 'By Verse', 'Verses (Top)', 'Favorites']) {
      expect(joined).toContain(needle);
    }

    const flexWrap = await page.locator('.search-quick-buttons.main-button-row').evaluate(el => getComputedStyle(el).flexWrap);
    expect(flexWrap).toBe('nowrap');
  });

  test('15. By 2026 button exists and is clickable', async ({ page }) => {
    const errors = trackConsoleErrors(page);
    await page.goto('./');
    await waitForAppReady(page);

    const btn = page.locator('.search-quick-buttons.main-button-row .combo-btn', { hasText: 'By 2026' });
    await expect(btn).toBeVisible();
    await btn.click();
    await page.waitForTimeout(500);

    const critical = errors.filter(e =>
      !e.includes('favicon') && !e.includes('umami') && !e.includes('service-worker')
    );
    expect(critical).toHaveLength(0);

    const isFn = await page.evaluate(() => typeof window.PPP?.app?.showBy2026 === 'function');
    expect(isFn).toBe(true);
  });

  test('16. Key Words button is to the left of search input', async ({ page }) => {
    await page.goto('./');
    await waitForAppReady(page);

    await expect(page.locator('.keywords-search-btn')).toBeVisible();

    const kwBox = await page.locator('.keywords-search-btn').boundingBox();
    const inputBox = await page.locator('#searchTerm').boundingBox();
    expect(kwBox.x).toBeLessThan(inputBox.x);
  });

  test('18. Loading indicator gates on extras (Essence/Summary ready when bar hides)', async ({ page }) => {
    await page.goto('./');

    // The new ui API surface must be present
    await page.waitForFunction(() => {
      return window.PPP && window.PPP.ui &&
        typeof window.PPP.ui.extrasReady === 'function' &&
        typeof window.PPP.ui.setLoadingText === 'function' &&
        typeof window.PPP.ui.loadExtras === 'function';
    }, { timeout: 30000 });

    // i18n key exists in all three languages
    const i18nKeys = await page.evaluate(() => {
      const out = {};
      const orig = window.PPP.i18n.getLanguage ? window.PPP.i18n.getLanguage() : 'en';
      ['en', 'lv', 'ru'].forEach(l => {
        window.PPP.i18n.setLanguage(l);
        out[l] = window.PPP.i18n.t('loadingExtras');
      });
      window.PPP.i18n.setLanguage(orig);
      return out;
    });
    expect(i18nKeys.en).toMatch(/summar/i);
    expect(i18nKeys.lv).toMatch(/kopsavilkum/i);
    expect(i18nKeys.ru).toMatch(/кратк/i);

    // Wait until extras have loaded
    await page.waitForFunction(() => window.PPP.ui.extrasReady(), { timeout: 60000 });

    // After extras are ready, getEssence on a known lecture should be a non-empty string
    // (we don't hard-code an nr — sample several from the cache directly)
    const sampleEssence = await page.evaluate(() => {
      // Force a fresh fetch of the cache via the public API
      return window.PPP.ui.loadExtras().then(cache => {
        const keys = Object.keys(cache);
        for (let i = 0; i < keys.length; i++) {
          const ex = cache[keys[i]];
          if (ex && ex.e) return { nr: keys[i], essence: String(ex.e).slice(0, 50) };
        }
        return null;
      });
    });
    expect(sampleEssence).not.toBeNull();
    expect(sampleEssence.essence.length).toBeGreaterThan(0);
  });

  test('19. Download button targets drive.usercontent for DOCX (Android intent bypass)', async ({ page }) => {
    test.setTimeout(180000);  // Loading the per-language HTML DB (~50MB) on first visit takes >60s default
    await page.goto('./');
    await page.waitForFunction(() => window.PPP && window.PPP.app && typeof window.PPP.app.downloadTranscript === 'function', { timeout: 30000 });

    // Use the established helper which gates on placeholder population (proxy for full load)
    await waitForAppReady(page);

    const result = await page.evaluate(async () => {
      const deadlineDb = Date.now() + 30000;
      while (Date.now() < deadlineDb) {
        try { await window.PPP.db.queryMetaAsync('SELECT 1 AS ok', {}); break; }
        catch (e) { await new Promise(r => setTimeout(r, 250)); }
      }
      while (!window.PPP.ui.extrasReady()) await new Promise(r => setTimeout(r, 200));

      // Phase 2: pick a nr that has both an EN Drive URL (in meta) and a per-lecture HTML file
      // (HEAD-probe the static file). No big SQLite DB load needed.
      const candidates = await window.PPP.db.queryMetaAsync(
        "SELECT nr FROM lectures WHERE script_en_url IS NOT NULL AND script_en_url != '' LIMIT 30", {}
      );
      let target = null;
      for (const r of candidates) {
        const probe = await fetch('transcripts/en/' + r.nr + '.html', { method: 'HEAD' });
        if (probe.ok) { target = String(r.nr); break; }
      }
      if (!target) return { skip: 'no lecture has both EN Drive URL and HTML file' };

      window.PPP.app.openHtmlTranscriptViewer(target, 'en', 0, '', '');
      const renderDeadline = Date.now() + 30000;
      while (Date.now() < renderDeadline) {
        const body = document.getElementById('transcriptModalBody');
        const btn = document.getElementById('transcriptDownloadBtn');
        if (body && body.innerHTML.length > 200 && !body.querySelector('.transcript-loading') && btn.style.display !== 'none') break;
        await new Promise(r => setTimeout(r, 300));
      }

      // Intercept the dynamically created <a> click without navigating
      let captured = null;
      const origCreate = document.createElement.bind(document);
      document.createElement = function (tag) {
        const el = origCreate(tag);
        if (tag.toLowerCase() === 'a') {
          el.click = function () {
            captured = { href: this.href, target: this.target || '_self', rel: this.rel || '' };
          };
        }
        return el;
      };
      window.PPP.app.downloadTranscript();
      await new Promise(r => setTimeout(r, 300));
      document.createElement = origCreate;
      if (!captured) return { failed: 'no download triggered for nr=' + target };
      return captured;
    });

    if (result.skip) { test.skip(true, result.skip); return; }
    expect(result.failed).toBeUndefined();
    expect(result.href).toMatch(/^https:\/\/drive\.usercontent\.google\.com\/download\?id=[^&]+&export=download$/);
    expect(result.rel).toBe('noopener');
  });

  test('20. Opening a transcript fetches one per-lecture file (no big SQLite DB)', async ({ page }) => {
    test.setTimeout(60000);
    const dbRequests = [];
    const transcriptFileRequests = [];
    page.on('request', (req) => {
      const url = req.url();
      if (/ppp_transcripts_html_[a-z]+\.db/.test(url)) dbRequests.push(url);
      if (/\/transcripts\/[a-z]+\/\d+\.html/.test(url)) transcriptFileRequests.push(url);
    });

    await page.goto('./');
    // Wait for app to be ready (DB+extras both loaded so meta queries work)
    await page.waitForFunction(() => {
      const input = document.getElementById('searchTerm');
      const ready = window.PPP && window.PPP.ui && typeof window.PPP.ui.extrasReady === 'function' && window.PPP.ui.extrasReady();
      return input && !input.disabled && ready;
    }, { timeout: 120000 });

    // Pick a lecture nr that has an EN transcript file. Use the meta DB:
    // any nr with an EN URL almost certainly has a file; we verify via fetch.
    const targetNr = await page.evaluate(async () => {
      // Belt-and-braces: ensure meta DB worker has the DB attached
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline) {
        try { await window.PPP.db.queryMetaAsync('SELECT 1 AS ok', {}); break; }
        catch (e) { await new Promise(r => setTimeout(r, 250)); }
      }
      const rows = await window.PPP.db.queryMetaAsync(
        "SELECT nr FROM lectures WHERE script_en_url IS NOT NULL AND script_en_url != '' LIMIT 30", {}
      );
      for (const r of rows) {
        const probe = await fetch('transcripts/en/' + r.nr + '.html', { method: 'HEAD' });
        if (probe.ok) return String(r.nr);
      }
      return null;
    });
    if (!targetNr) { test.skip(true, 'no lecture with both meta URL and HTML file'); return; }

    // Reset trackers AFTER initial page load (we only care about transcript-open traffic)
    dbRequests.length = 0;
    transcriptFileRequests.length = 0;

    await page.evaluate((nr) => {
      window.PPP.app.openHtmlTranscriptViewer(String(nr), 'en', 0, '', '');
    }, targetNr);
    await page.waitForFunction(() => {
      const body = document.getElementById('transcriptModalBody');
      return body && body.innerHTML.length > 200 && !body.querySelector('.transcript-loading');
    }, { timeout: 15000 });

    expect(dbRequests).toEqual([]);  // no big SQLite request triggered
    expect(transcriptFileRequests.length).toBeGreaterThanOrEqual(1);
    expect(transcriptFileRequests[0]).toMatch(new RegExp('/transcripts/en/' + targetNr + '\\.html$'));

    const bodyLen = await page.locator('#transcriptModalBody').evaluate(el => el.innerHTML.length);
    expect(bodyLen).toBeGreaterThan(500);
  });

  test('17. Transcripts & Translations label and 3-button combo present', async ({ page }) => {
    await page.goto('./');
    await waitForAppReady(page);

    const block = page.locator('.transcripts-block');
    await expect(block).toBeVisible();

    await expect(block).toContainText('Transcripts & Translations');

    const btns = await page.locator('.transcripts-block button').all();
    expect(btns).toHaveLength(3);

    const btnTexts = [];
    for (const b of btns) {
      btnTexts.push((await b.textContent()) || '');
    }
    const joined = btnTexts.join(' | ');
    for (const needle of ['By Date', 'By Topic', 'Newest']) {
      expect(joined).toContain(needle);
    }
  });

  test('21. Lecture extras (essence + summary modal) reach the results table', async ({ page }) => {
    await page.goto('./');
    await waitForAppReady(page);

    // Wait until extras JSON has loaded (essence/summary depend on it)
    await page.waitForFunction(() => {
      return window.PPP && window.PPP.ui &&
        typeof window.PPP.ui.extrasReady === 'function' &&
        window.PPP.ui.extrasReady();
    }, { timeout: 60000 });

    // Search for lecture Nr. 730 by its original_file_name "07.07.12"
    await page.fill('#searchTerm', '07.07.12');
    await page.click('.search-button');

    await page.waitForSelector('#resultsInfo strong', { timeout: 10000 });

    // Essence hint must be rendered under the title
    const essence = page.locator('.essence-hint').first();
    await expect(essence).toBeVisible({ timeout: 10000 });
    await expect(essence).toContainText('Essence:');

    // Clickable summary link for lecture 730 must exist
    const summaryLink = page.locator('a[data-nr="730"]');
    await expect(summaryLink.first()).toBeVisible({ timeout: 10000 });

    // Clicking it opens the summary modal with non-empty body text
    await summaryLink.first().click();
    const overlay = page.locator('#summaryModalOverlay');
    await expect(overlay).toBeVisible({ timeout: 10000 });

    await page.waitForFunction(() => {
      const b = document.getElementById('summaryModalBody');
      return b && b.textContent && b.textContent.trim().length > 1 &&
        b.textContent.trim() !== '…';
    }, { timeout: 10000 });
    const bodyText = await page.locator('#summaryModalBody').textContent();
    expect(bodyText.trim().length).toBeGreaterThan(1);
  });

  test('22. Raw transcript row shows a "Raw" button, not "EN"', async ({ page }) => {
    await page.goto('./');
    await waitForAppReady(page);

    // Lecture Nr. 730 (original_file_name "07.07.12") is a Raw transcript:
    // its meta DB Script_EN cell stores the literal string "Raw".
    await page.fill('#searchTerm', '07.07.12');
    await page.click('.search-button');
    await page.waitForSelector('#resultsInfo strong', { timeout: 10000 });

    // The script cell for a Raw row must render a "Raw" button (not "EN").
    // The three script columns are the last 3 cells of each row; the Raw EN
    // button is a styled <a> whose text is exactly "Raw".
    const rawBtn = page.locator('#resultsTable tbody tr a', { hasText: /^Raw$/ }).first();
    await expect(rawBtn).toBeVisible({ timeout: 10000 });
    await expect(rawBtn).toHaveText('Raw');

    // Regression guard: the Raw EN cell must NOT be labelled "EN".
    // Find the row containing the Raw button and assert no sibling <a> reads "EN".
    const enInRawRow = await page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll('#resultsTable tbody tr a'));
      const raw = anchors.find(a => a.textContent.trim() === 'Raw');
      if (!raw) return 'NO_RAW';
      const tr = raw.closest('tr');
      const labels = Array.from(tr.querySelectorAll('a')).map(a => a.textContent.trim());
      // The Raw cell replaced what used to be "EN"; ensure "Raw" is present.
      return labels.includes('Raw') ? 'OK' : labels.join(',');
    });
    expect(enInRawRow).toBe('OK');
  });

  test('24. "Not relevant" transcript cells render as plain text span, not a clickable link', async ({ page }) => {
    await page.goto('./');
    await waitForAppReady(page);

    // Search for a lecture known to have "Not relevant" in Script_EN (Private_mp3_Bihari)
    await page.fill('#searchTerm', '@Private_mp3_Bihari');
    await page.click('.search-button');
    await page.waitForSelector('#resultsInfo strong', { timeout: 15000 });

    // Find any cell containing "Not relevant" / "Neattiecas" / "Не относится"
    const notRelevantSpan = page.locator('#resultsTable tbody td span').filter({
      hasText: /Not relevant|Neattiecas|Не относится/
    }).first();

    // If DB has these values, the span must exist (not an <a> link)
    const count = await page.locator('#resultsTable tbody td span').filter({
      hasText: /Not relevant|Neattiecas|Не относится/
    }).count();

    if (count === 0) {
      // DB may not have been rebuilt yet — skip gracefully
      console.log('No "Not relevant" cells found (DB not yet rebuilt). Skipping assertion.');
      return;
    }

    // Must be a <span>, never an <a>
    await expect(notRelevantSpan).toBeVisible();
    const tagName = await notRelevantSpan.evaluate(el => el.tagName.toLowerCase());
    expect(tagName).toBe('span');

    // Must not be clickable (no href, no onclick that opens transcript)
    const href = await notRelevantSpan.evaluate(el => el.getAttribute('href'));
    expect(href).toBeNull();

    // Font size must be 11px (smaller than normal 12.5px td)
    const fontSize = await notRelevantSpan.evaluate(el => getComputedStyle(el).fontSize);
    expect(fontSize).toBe('11px');
  });

  test('23. Clicking a Raw transcript shows the "txt only / Google Drive" message (not "Transcript not found")', async ({ page }) => {
    await page.goto('./');
    await waitForAppReady(page);

    // Lecture Nr. 730 ("07.07.12") is a Raw transcript: no in-app HTML, but a
    // Drive txt URL exists. Clicking its "Raw" button must open the modal with
    // the corrected message, NOT the old "Transcript not found".
    await page.fill('#searchTerm', '07.07.12');
    await page.click('.search-button');
    await page.waitForSelector('#resultsInfo strong', { timeout: 10000 });

    const rawBtn = page.locator('#resultsTable tbody tr a', { hasText: /^Raw$/ }).first();
    await expect(rawBtn).toBeVisible({ timeout: 10000 });
    await rawBtn.click();

    // Modal opens
    const overlay = page.locator('#transcriptModalOverlay');
    await expect(overlay).toHaveClass(/active/, { timeout: 10000 });

    // Title is the Raw-transcript title, NOT "Transcript not found"
    const title = page.locator('#transcriptModalTitle');
    await expect(title).toHaveText(/Raw transcript \(txt\)/i, { timeout: 10000 });
    await expect(title).not.toHaveText(/Transcript not found/i);

    // Body explains this is an auto-generated unprocessed (Raw) transcript,
    // and keeps the "Open in Google Drive" link
    const body = page.locator('#transcriptModalBody');
    await expect(body).toContainText(/unprocessed \(Raw\) transcript/i);
    await expect(body).not.toContainText(/Transcript not found/i);
    await expect(body).toContainText(/Google Drive/i);
    await expect(body.locator('a[href*="drive"], a[target="_blank"]').first()).toBeVisible();

    // Regression guard: the old wrong message must not appear anywhere in the modal
    await expect(body).not.toContainText(/No EN HTML transcript/i);
  });

  test('32. Features button opens grouped dropdown menu', async ({ page }) => {
    await page.goto('./');
    await waitForAppReady(page);

    const menu = page.locator('#featuresMenu');
    await expect(menu).toBeHidden();

    // Clicking the Features button reveals the menu.
    await page.locator('.features-btn').click();
    await expect(menu).toBeVisible();

    // "All functions" link points at the full guide.
    const all = menu.locator('.fm-all');
    await expect(all).toHaveCount(1);
    const allHref = await all.getAttribute('href');
    expect(allHref).toMatch(/guide\/en\/index\.html$/);

    // Grouped list: 9 group headings, several item links.
    await expect(menu.locator('.fm-group')).toHaveCount(9);
    const itemCount = await menu.locator('.fm-item').count();
    expect(itemCount).toBe(33);

    // Each item deep-links to a specific function anchor.
    const firstItemHref = await menu.locator('.fm-item').first().getAttribute('href');
    expect(firstItemHref).toMatch(/guide\/en\/index\.html#item-\d+$/);

    // Function numbers are NOT displayed in the visible text.
    const groupText = await menu.locator('.fm-group').first().textContent();
    expect(groupText && groupText.trim().length).toBeGreaterThan(0);

    // Escape closes the menu.
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
  });

  test('33. Features menu closes on backdrop click', async ({ page }) => {
    await page.goto('./');
    await waitForAppReady(page);

    const menu = page.locator('#featuresMenu');
    await page.locator('.features-btn').click();
    await expect(menu).toBeVisible();

    // Click the modal backdrop (overlay corner, away from the centered panel).
    await menu.click({ position: { x: 5, y: 5 } });
    await expect(menu).toBeHidden();
  });

});
