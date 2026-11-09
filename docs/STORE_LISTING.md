# Chrome Web Store Listing

What to enter in the Chrome Web Store developer dashboard, and what to check before submitting. Every statement here must stay true of the code; [PRIVACY.md](../PRIVACY.md) is the public policy it summarizes.

## Package

| Item | Value | Source |
| --- | --- | --- |
| Name | PageHarvest | `wxt.config.ts` |
| Version | `1.0.0`, and `version_name` `1.0.0`, which is what users see | `wxt.config.ts` |
| Minimum Chrome | 116 | `wxt.config.ts` |
| Upload file | `.output/page-harvest-<version_name>-chrome.zip`, for example `page-harvest-1.0.0-chrome.zip`. Check its date: an older zip with the same name may be left in `.output/` | `pnpm zip` |

## Store listing tab

**Short description** (132 characters at most, from the manifest):

> Extract lists and tables from web pages into a spreadsheet, then export CSV, JSON or Excel. Runs locally; nothing is uploaded.

**Category:** Productivity, or Developer Tools.

**Detailed description:**

> PageHarvest turns the repeated parts of a web page, such as product cards, search results, listings or tables, into rows and columns you can edit and export.
>
> - Find data automatically, or point at one item and PageHarvest finds the others like it.
> - Review the suggested columns, rename them, and add your own from any text, link, image or attribute.
> - Follow Next buttons, numbered page addresses, or infinite scroll, with limits and delays you set.
> - Close the panel at any time: the job keeps running and its rows are saved as they arrive.
> - Edit, filter, sort, find and replace, and remove duplicates in the built-in grid.
> - Export CSV, JSON, NDJSON or Excel, or copy the table.
>
> Everything stays on your computer. PageHarvest has no account, no analytics and no server, and makes no network requests of its own. It does not bypass logins, paywalls or CAPTCHAs.

**Screenshots:** 1280x800 or 640x400, one to five. `store-assets/screenshot-1280x800.png` is a draft that shows test data and `127.0.0.1` addresses; replace it with screenshots of a real public page before submitting.

**Small promo tile:** `store-assets/promo-440x280.png`.

## Privacy practices tab

**Single purpose:**

> PageHarvest extracts structured data that the user selects from web pages into a table, and exports it as a file.

**Permission justifications:**

| Permission | Justification |
| --- | --- |
| Optional site access (one site at a time, asked at use) | The user can extract data from any website they choose. PageHarvest asks for access to one site at a time, only when the user starts extraction on it (Chrome prompts "this site"), and injects its content script then. A multi-page job re-injects on each new page of the same site without asking again, because the per-site grant persists. It reads page content only when the user asks it to, from the panel. |
| `activeTab` | Reads the address and title of the tab the user opens PageHarvest on, to show the page and decide whether extraction can run there. |
| `sidePanel` | The whole interface is in Chrome's side panel. |
| `storage` | Remembers whether the user has finished the first-run tour. |
| `downloads` | Saves exports (CSV, JSON, NDJSON, XLSX) to the user's Downloads folder. |

**Remote code:** No, I am not using remote code. All scripts are in the package; there is no `eval`, `new Function` or remote script.

**Data usage:** tick **Website content** only, because the extension reads the content of pages the user extracts from. It is processed and stored only on the user's device and never transmitted. Do not tick any other category.

Then certify all three:

- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL:** `https://github.com/Pawan-pv/pageharvest/blob/main/PRIVACY.md` (valid once `PRIVACY.md` is on `main`).

## Install warnings

No host warning at install (ADR-037): the extension requests one site's access at a time while in use, so Chrome shows no "all websites" warning. The decision is in [DECISIONS.md](DECISIONS.md).

## Before you submit

- [ ] Full release gate passed on the commit being packaged (GitHub Actions `release-gate.yml`). The `main` ruleset requires no status checks, so a failing gate does not block a merge: read the result before merging.
- [ ] Review: the `main` ruleset requires no approvals (since 2026-11-08), but the gate's `independent-review` job still fails a pull request that has no approval from someone other than its author. A reviewer should use [INDEPENDENT_REVIEW_CHECKLIST.md](INDEPENDENT_REVIEW_CHECKLIST.md).
- [x] `pnpm audit --prod` reports no vulnerabilities.
- [x] `version_name` is `1.0.0`. Re-run `pnpm zip` on the commit being submitted.
- [ ] Manual check in branded Chrome passed ([FEATURE_AUDIT.md](FEATURE_AUDIT.md), "Native Chrome Side Panel manual verification").
- [ ] Screenshots replaced with a real public page.
- [ ] `PRIVACY.md` merged to `main`, and its URL opens.
