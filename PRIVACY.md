# PageHarvest Privacy Policy

Effective date: 2026-11-15

PageHarvest is a local-first Chrome extension featuring a comprehensive 10-tool extraction suite that turns web content you select into structured datasets and spreadsheets. This policy describes what the extension handles and where it goes.

## The short version

Everything PageHarvest reads or saves stays 100% on your computer. The extension operates completely client-side with no remote servers, no user accounts, no tracking, no analytics, and no advertising. All extracted records, schemas, and settings are stored locally in your browser's IndexedDB. Its developer receives nothing: not your data, not the sites you visit, and not how you use the extension.

## The 10-tool extraction suite

All 10 extraction tools run locally in your browser:
1. **List Extractor**: Auto-detects repeated items, card grids, and search results on the active page.
2. **Table Extractor**: Captures structured HTML tables into spreadsheets.
3. **Links Extractor**: Collects hyperlinks, anchors, and internal/external references.
4. **Page Extractor**: Bulk-extracts structured metadata (OG, Twitter cards) and JSON-LD schemas across multiple URLs.
5. **Sitemap Explorer**: Parses XML sitemaps to discover and filter site URLs.
6. **Shopify Extractor**: Extracts public store catalogs and product variants with Shopify CSV parity.
7. **Email Extractor**: Finds publicly displayed contact emails across target web pages.
8. **Social Link Extractor**: Identifies verified brand profiles and social links.
9. **Page Text Extractor**: Extracts clean, readable text and article content without clutter.
10. **Bulk Image Downloader**: Discovers and downloads page images with filters and custom filename templates.

## What PageHarvest reads

- **The content of pages you collect from.** When you ask for the list on a page, pick an item, preview a column or start collecting, PageHarvest reads the text, links, image addresses and attributes of that page, and of the further pages a multi-page job visits. It does this by adding its script to that page at that moment. It does not run on pages you have not started it on.
- **Whether a page refused the job.** On each page a job visits, PageHarvest reads the status the website answered with, from the browser's own record of that page load. If the website answered "Too Many Requests", the job stops so that it can continue later, and the panel says the site asked it to slow down. Nothing else is read from that answer.
- **The address and title of the tab you are looking at**, while the side panel is open, so the panel can show which page you are on and say whether it can be read. They are shown, not stored.
- **The address of the tab you found a list on**, until you start collecting or start again. If that tab moves to another address or is closed, the panel drops the list, because it no longer matches the page. When you press Start, PageHarvest checks with Chrome that the tab still shows the page the list came from.
- **That a tab finished loading or was closed.** Chrome tells the extension when this happens in any tab. PageHarvest uses it only to continue, or to stop, a job that is running in that tab, and to notice that the tab of a list you found has changed. For any other tab, nothing is read and nothing is stored.

PageHarvest does not edit, submit or delete anything on a site. While it works it draws a highlight over the page, and when you ask for more pages it clicks the site's Next button, opens the next page address or scrolls, as you would by hand, waiting at least one second between pages.

## What PageHarvest stores, and where

All of it is kept in your browser's local storage for this extension (IndexedDB, `chrome.storage.local` and `chrome.storage.session`) on your device:

- The rows you collect, and the edits you make to them.
- Your groups, saved setups and column sets, job history, and the checkpoints used to continue a job that stopped early. A job's history and error messages can include the addresses of pages it visited and when.
- Your settings, whether Advanced options is on, and whether you have finished the first-run tour.
- Only if the browser cannot store that last choice: a note in `chrome.storage.session`, which the browser clears when it closes, so the tour is not shown again during this session.

The rows you collect, your saved setups and your job history stay until you delete them. What is needed to continue a job that stopped early is kept for the number of days set under **Settings** (1 to 365, with Advanced options on; 30 by default), then deleted; the rows that job collected stay in **My data**. Deleting saved data in **My data** deletes its rows. **Settings** has a button that deletes all your collected data, groups, saved setups and job history; your settings and the two choices above are kept. Removing the extension deletes everything it stored.

## What leaves your device

Nothing, unless you send it somewhere yourself:

- **Download** writes an Excel, CSV, JSON or NDJSON file to your Downloads folder through Chrome's downloads feature.
- **Copy** places the table on your clipboard.
- **Links** you click, in your rows or in Help, open in a new tab like any other link.

What happens to a file, the clipboard or an opened page after that is up to you.

PageHarvest does not sell, share or transfer any data, does not use data for anything other than collecting and saving what you ask for, and does not use it to determine creditworthiness or for lending. No person reads your data: it never reaches the developer.

PageHarvest's use of the information it reads complies with the Chrome Web Store User Data Policy, including the Limited Use requirements.

## Permissions

| Permission | Why PageHarvest needs it |
| --- | --- |
| Access to websites (`http://*/*` and `https://*/*`, granted when you install) | To read the page you choose, and to continue a multi-page job on each following page of that site, without Chrome asking you again on every site. PageHarvest reads a page only when you start it there. You can limit it to particular sites, or to "when you click the extension", in Chrome's extension settings |
| `activeTab` | To see which page you opened PageHarvest on, including pages it cannot work on, so it can say so |
| `scripting` | To add PageHarvest's own script, which is part of the extension, to the page you start it on. It adds no code from anywhere else |
| `sidePanel` | To show PageHarvest in Chrome's side panel |
| `storage` | To remember two choices: whether Advanced options is on, and whether you have finished the first-run tour |
| `downloads` | To save user-initiated spreadsheet exports (Excel, CSV, JSON, NDJSON) and bulk image assets from the Image Downloader |

## Websites you use it on

PageHarvest does not bypass logins, paywalls or CAPTCHAs. It stops when a website answers that it is receiving too many requests. You are responsible for following the terms of the websites you collect data from, and the law that applies to the data you collect, including personal data about other people.

## Your choices

- Limit which sites PageHarvest can read: right-click its toolbar button, then **This can read and change site data**.
- Delete saved data: one item at a time in **My data**, or all of it in **Settings**.
- Remove the extension: this deletes everything it stored.

## Open-source software

PageHarvest includes open-source software. The licences are in the extension, under **Help**, and in `THIRD_PARTY_NOTICES.txt` in the package.

## Changes

If this policy changes, the new version will be published at this address with a new effective date.

## Contact

Questions or support: email `support@pageharvest.dev` or open an issue at <https://github.com/Pawan-pv/pageharvest/issues>.
