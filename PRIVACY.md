# PageHarvest Privacy Policy

Effective date: 2026-11-08

PageHarvest is a Chrome extension that copies data you choose from web pages into a table, and lets you save that table as a file. This policy describes what the extension handles and where it goes.

## The short version

Everything PageHarvest reads or saves stays on your computer. The extension makes no network requests of its own. It has no account, no analytics, no telemetry, no advertising and no remote server.

## What PageHarvest reads

- **The content of pages you extract from.** When you pick a list, run auto-detect, preview a column or start an extraction, PageHarvest reads the text, links, images and attributes of that page, and of the further pages a multi-page job visits.
- **The address and title of the active tab**, so the panel can show which page you are on and say whether extraction can run there.
- **Each page's address and title as it loads.** PageHarvest's page script runs on the pages you visit, so that a multi-page job can continue after the browser loads the next page. When a page loads, the extension checks whether that tab has a running job. If it has none, the address and title are discarded and nothing is stored.

## What PageHarvest stores, and where

All of it is kept in your browser's local storage for this extension (IndexedDB and `chrome.storage.local`) on your device:

- The records you extract, and the edits you make to them.
- Your projects, saved recipes and schemas, job history, and job checkpoints used to recover an interrupted job. A job's history and error messages can include the addresses of pages it visited.
- Your settings, and whether you have finished the first-run tour.

An interrupted session is kept for the number of days set under **Settings** (1 to 365), then deleted. Deleting a dataset deletes its records. Removing the extension deletes everything it stored.

## What leaves your device

Nothing, unless you send it somewhere yourself:

- **Export** writes a CSV, JSON, NDJSON or XLSX file to your Downloads folder through Chrome's downloads feature.
- **Copy** places the table on your clipboard.

What happens to a file or the clipboard after that is up to you.

PageHarvest does not sell, share or transfer any data, does not use data for anything other than extracting and exporting what you ask for, and does not use it to determine creditworthiness or for lending.

## Permissions

| Permission | Why PageHarvest needs it |
| --- | --- |
| Read page content on websites you visit | To extract data from the page you choose, and to continue a multi-page job on each page it loads |
| `activeTab` | To read the address and title of the tab you open PageHarvest on |
| `sidePanel` | To show PageHarvest in Chrome's side panel |
| `storage` | To remember whether you have finished the first-run tour |
| `downloads` | To save your exports as files |

## Websites you use it on

PageHarvest does not bypass logins, paywalls or CAPTCHAs. You are responsible for following the terms of the websites you extract data from.

## Changes

If this policy changes, the new version will be published at this address with a new effective date.

## Contact

Questions about this policy: open an issue at <https://github.com/Pawan-pv/pageharvest/issues>.
