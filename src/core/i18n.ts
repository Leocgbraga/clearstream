// Tiny i18n helper over the platform _locales API. Falls back to the key so a missing translation is
// visible (not blank). Used in the popup/player; the manifest name/description use __MSG_*__ directly.
import { browser } from 'wxt/browser';

// WXT types getMessage with only the built-in @@ keys (no generated message map for plain _locales),
// so cast to the standard signature.
const getMessage = browser.i18n.getMessage as (key: string, substitutions?: string | string[]) => string;

export function t(key: string, substitutions?: string | string[]): string {
  return getMessage(key, substitutions) || key;
}

