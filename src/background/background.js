const OFFSCREEN_DOCUMENT = 'offscreen.html';

async function ensureOffscreenDocument() {
  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_DOCUMENT);
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [offscreenUrl],
  });

  if (contexts.length === 0) {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_DOCUMENT,
      reasons: ['USER_MEDIA'],
      justification: 'Record audio from the selected browser tab.',
    });
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.target !== 'background') return false;

  if (message.type === 'START_RECORDING') {
    (async () => {
      await ensureOffscreenDocument();
      const recorder = await chrome.runtime.sendMessage({
        target: 'offscreen',
        type: 'GET_RECORDING_STATUS',
      });
      if (recorder?.recording) {
        sendResponse({
          ok: false,
          error: 'Another recording is already running. Stop it before starting a new one.',
        });
        return;
      }
      const capturedTabs = await chrome.tabCapture.getCapturedTabs();
      const existingCapture = capturedTabs.find(({ tabId }) => tabId === message.tabId);
      if (existingCapture) {
        throw new Error('This tab is already being captured. Stop the existing capture or close and reopen the tab, then try again.');
      }
      const streamId = await chrome.tabCapture.getMediaStreamId({
        targetTabId: message.tabId,
      });
      const result = await chrome.runtime.sendMessage({
        target: 'offscreen',
        type: 'START_RECORDING',
        streamId,
        tab: message.tab,
      });
      if (result.ok) await chrome.action.setBadgeText({ text: 'REC' });
      sendResponse(result);
    })().catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === 'STOP_RECORDING') {
    chrome.runtime.sendMessage({ target: 'offscreen', type: 'STOP_RECORDING' })
      .then(async (result) => {
        if (result.ok) await chrome.action.setBadgeText({ text: '' });
        sendResponse(result);
      })
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === 'GET_RECORDING_STATUS') {
    ensureOffscreenDocument()
      .then(() => chrome.runtime.sendMessage({
        target: 'offscreen',
        type: 'GET_RECORDING_STATUS',
      }))
      .then(sendResponse)
      .catch((error) => sendResponse({ recording: false, error: error.message }));
    return true;
  }

  return false;
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  try {
    const status = await chrome.runtime.sendMessage({
      target: 'offscreen',
      type: 'GET_RECORDING_STATUS',
    });
    if (status.recording && status.tabId === tabId) {
      await chrome.runtime.sendMessage({ target: 'offscreen', type: 'STOP_RECORDING' });
      await chrome.action.setBadgeText({ text: '' });
    }
  } catch {
    // The offscreen document may already have closed after the captured tab ended.
  }
});
