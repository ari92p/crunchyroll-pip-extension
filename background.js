'use strict';

function isCrunchyrollUrl(value) {
  try {
    const { hostname, protocol } = new URL(value);
    return protocol === 'https:' && (hostname === 'crunchyroll.com' || hostname === 'www.crunchyroll.com');
  } catch {
    return false;
  }
}

chrome.action.onClicked.addListener(async (tab) => {
  if (!Number.isInteger(tab.id) || !isCrunchyrollUrl(tab.url)) {
    return;
  }

  try {
    // content.js handles the toggle and shows a toast on errors.
    await chrome.tabs.sendMessage(tab.id, { type: 'cr-pip-toggle' });
  } catch (err) {
    // Happens when the page was opened before the extension was installed or updated.
    console.warn('PiP toggle failed (reload the Crunchyroll tab):', err);
  }
});
