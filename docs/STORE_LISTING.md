# Chrome Web Store Listing

What to enter in the Chrome Web Store developer dashboard, and what to check before submitting. Every statement here must stay true of the code; [PRIVACY.md](../PRIVACY.md) is the public policy it summarizes.

## Package

| Item | Value | Source |
| --- | --- | --- |
| Name | PageHarvest | `wxt.config.ts` |
| Version | `1.0.0`. `wxt.config.ts` also sets `version_name` `1.0.0`; WXT leaves it out of the built manifest because it equals `version`, and Chrome then shows `version` | `wxt.config.ts` |
| Minimum Chrome | 116 | `wxt.config.ts` |
| Upload file | `.output/page-harvest-<version_name>-chrome.zip`, for example `page-harvest-1.0.0-chrome.zip`. Check its date: an older zip with the same name may be left in `.output/` | `pnpm zip` |

## Store listing tab

**Short description** (132 characters at most, from the manifest):

> Extract lists and tables from web pages into a spreadsheet, then export CSV, JSON or Excel. Runs locally; nothing is uploaded.

**Category:** Productivity (Workflow & Planning). Developer Tools also fits, but the default experience is written for people who use spreadsheets, not for developers.

**Detailed description:**

> PageHarvest turns a list on a web page, such as products, search results, listings or a table, into a spreadsheet.
>
> - Press one button and PageHarvest finds the list on the page and shows you the first rows before anything is saved. If it picks the wrong thing, click one item yourself and it finds the others like it.
> - Untick the columns you do not need and rename the rest.
> - If the list continues on more pages, PageHarvest can follow the Next button or scroll for more, up to the number of pages you choose.
> - Close the panel at any time: it keeps working, and rows are saved as they arrive.
> - Download an Excel or CSV file, or copy the table.
>
> Advanced options, a switch in Settings, adds the detailed controls: column types (text, link, image, number, attribute, pattern), page-number addresses, waiting times and limits, saved setups you can run again, a grid with find and replace, filters and duplicate removal, and JSON and NDJSON files.
>
> Everything stays on your computer. PageHarvest has no account, no analytics and no server, and makes no network requests of its own. It does not bypass logins, paywalls or CAPTCHAs. You are responsible for following the terms of the websites you collect from.

**Screenshots:** 1280x800 or 640x400, one to five. `pnpm build && node scripts/generate-screenshots.mjs` writes them to `store-assets/` from the built extension running on a public practice site (`books.toscrape.com`, a book shop made for scraping practice). They show the real panel and real collected rows; nothing in them is mocked up. Do not use screenshots that show another company's name or products as if PageHarvest were connected to them.

**Small promo tile:** `store-assets/promo-440x280.png`.

## Privacy practices tab

**Single purpose:**

> PageHarvest extracts structured data that the user selects from web pages into a table, and exports it as a file.

**Permission justifications:**

| Permission | Justification |
| --- | --- |
| Host permission (`http://*/*`, `https://*/*`) | The user can extract data from any website they choose, and which one cannot be known in advance. PageHarvest has no static content script: it injects its script only into the page the user starts extraction on, and into each following page of a multi-page job the user started (the job follows the site's Next button or page addresses, and has to keep working after the user closes the panel or the tab reloads, which `activeTab` alone does not allow). It reads page content only when the user asks it to, from the panel, does not edit or submit anything on a site, and sends nothing off the device. |
| `activeTab` | When the user clicks the toolbar button, tells PageHarvest which page it was opened on, including browser pages and the Web Store, where it cannot run, so the panel can say "this page cannot be read" instead of failing. It is also what grants the page to users who have limited the extension's site access to "when you click the extension". |
| `scripting` | Injects the extension's own bundled content script (`content-scripts/content.js`) into the page the user starts extraction on, and checks whether a page of a running job already has it. No remote code and no code strings are injected. |
| `sidePanel` | The whole interface is in Chrome's side panel. |
| `storage` | Remembers two preferences in `chrome.storage.local`: whether Advanced options is on, and whether the user has finished the first-run tour. Extracted data is in IndexedDB, not here. |
| `downloads` | Saves exports (XLSX, CSV, JSON, NDJSON) to the user's Downloads folder, reads back the name the file was saved under, and opens its folder when the user presses "Show in folder". |

**Remote code:** No, I am not using remote code. All scripts are in the package; there is no `eval`, `new Function` or remote script, and the panel loads no remote images, fonts or styles.

**Data usage:** tick two categories. Both are handled only on the user's device and never transmitted.

- **Website content**: the extension reads the text, links, image addresses and attributes of the pages the user collects from, and stores the rows.
- **Web history**: for each job it stores, on the device, the addresses of the pages the job visited and when (the saved list's address, each row's source page, the job history and the checkpoint's visited pages). The User Data FAQ counts "the domains or URLs the browser interacts with" as web browsing activity, and `PRIVACY.md` says job history includes these addresses, so leaving this box unticked would contradict the policy and the code.

Do not tick the other categories. The address of the tab in front is shown in the panel and not kept; the picker follows the mouse only to highlight the element under it and records nothing (not *User activity*); no name, email or account is collected (not *Personally identifiable information*).

Then certify all three:

- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL:** `https://github.com/Pawan-pv/pageharvest/blob/main/PRIVACY.md` (valid once `PRIVACY.md` is on `main`).

## Install warnings

One warning at install (ADR-040): "Read and change all your data on all websites". Chrome words it; an extension cannot change or remove it. In exchange nobody is asked for access site by site while working. A broad host permission also means the Chrome Web Store reviews the item in more depth, which can take longer, and a reviewer may ask why `activeTab` alone is not enough: the answer is in the host permission's justification above (multi-page jobs that outlive the panel and a page reload). The decision is in [DECISIONS.md](DECISIONS.md).

## Open-source licences

The package contains `THIRD_PARTY_NOTICES.txt`, the licence text of every bundled package (MIT, ISC and Apache-2.0, which all require it). `pnpm build` and `pnpm zip` regenerate it, a unit test fails when it is out of date, and Help links to it.

## Before you submit

- [ ] Full release gate passed on the commit being packaged (GitHub Actions `release-gate.yml`). The `main` ruleset requires no status checks, so a failing gate does not block a merge: read the result before merging.
- [ ] Review: the `main` ruleset requires no approvals (since 2026-11-08), but the gate's `independent-review` job still fails a pull request that has no approval from someone other than its author. A reviewer should use [INDEPENDENT_REVIEW_CHECKLIST.md](INDEPENDENT_REVIEW_CHECKLIST.md).
- [x] `pnpm audit --prod` reports no vulnerabilities.
- [x] `version_name` is `1.0.0`. Re-run `pnpm zip` on the commit being submitted.
- [ ] Manual check in branded Chrome passed ([FEATURE_AUDIT.md](FEATURE_AUDIT.md), "Native Chrome Side Panel manual verification").
- [x] Screenshots show a real public practice page, generated from the build being submitted.
- [ ] `PRIVACY.md` merged to `main`, and its URL opens.
- [ ] The Excel file opens in Excel, Google Sheets and LibreOffice (open one download in each by hand).
- [ ] `TERMS_OF_USE.md` and `ACCEPTABLE_USE.md` are drafts: fill in the bracketed items, have them reviewed, then link them from the listing and from `PRIVACY.md`.
- [ ] A support email is set in the developer dashboard.
