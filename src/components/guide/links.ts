/**
 * Addresses the panel links to. Kept apart from the guide's text, which is loaded only when
 * Help opens, so a screen can link to the privacy policy without loading the whole guide.
 * The panel fetches none of them: each opens in a new tab when the user clicks it.
 */

/** A public book shop made for practising. */
export const PRACTICE_SITE_URL = 'https://books.toscrape.com/';

/** The public privacy policy: the same text as PRIVACY.md in the repository. */
export const PRIVACY_POLICY_URL = 'https://github.com/Pawan-pv/pageharvest/blob/main/PRIVACY.md';

/** The licences of the open-source packages inside the extension, a file in the package. */
export const THIRD_PARTY_NOTICES_PATH = '/THIRD_PARTY_NOTICES.txt';
