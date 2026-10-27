import { APP_VERSION } from '../../shared/constants.js';

/** Unrelated browser flows use a returning player; release-notes.e2e.test.js covers first-run and update prompts. */
export function seedReleaseRead(page) {
  return page.evaluateOnNewDocument((version) => {
    // New pages also pass through about:blank; only the actual host page has origin storage.
    if (window.top !== window || !/^https?:$/.test(location.protocol)) return;
    localStorage.setItem(`sp.pref.release-seen.${version}`, '1');
  }, APP_VERSION);
}
