const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

function load(file, document = {}) {
  const handlers = {};
  const context = vm.createContext({
    URL, console, document: { readyState: 'loading', addEventListener() {}, ...document },
    chrome: {
      runtime: { onMessage: { addListener(fn) { handlers.message = fn; } } },
      tabs: { query: async () => [], sendMessage: async (...args) => { handlers.sent = args; } },
      commands: { onCommand: { addListener(fn) { handlers.command = fn; } } },
      action: { onClicked: { addListener(fn) { handlers.click = fn; } } }
    }
  });
  vm.runInContext(fs.readFileSync(file, 'utf8'), context);
  return { context, handlers };
}
function video(options = {}) {
  return { paused: false, readyState: 2, hasAttribute: () => true,
    removeAttribute() { this.removed = true; }, ...options };
}

for (const file of ['content.js']) {
  const toggle = 'togglePiP()';
  test(`${file}: exits existing PiP even when no current video is found`, async () => {
    let exited = 0;
    const { context } = load(file, { pictureInPictureElement: {},
      exitPictureInPicture: async () => exited++, querySelectorAll: () => [] });
    await vm.runInContext(toggle, context);
    assert.equal(exited, 1);
  });
  test(`${file}: chooses a ready paused video over unloaded placeholder`, async () => {
    let entered = 0;
    const selected = video({ paused: true, requestPictureInPicture: async () => entered++ });
    const { context } = load(file, { pictureInPictureEnabled: true,
      querySelectorAll: () => [video({ paused: true, readyState: 0 }), selected] });
    await vm.runInContext(toggle, context);
    assert.equal(entered, 1);
    assert.equal(selected.disablePictureInPicture, false);
    assert.equal(selected.removed, true);
  });
  test(`${file}: WebKit fallback actually toggles off`, async () => {
    let mode;
    const { context } = load(file, { querySelectorAll: () => [video({
      webkitPresentationMode: 'picture-in-picture', webkitSetPresentationMode(value) { mode = value; }
    })] });
    await vm.runInContext(toggle, context);
    assert.equal(mode, 'inline');
  });
}
test('background: only HTTPS Crunchyroll hosts are allowed', () => {
  const { context } = load('background.js');
  for (const url of ['https://crunchyroll.com/watch/x', 'https://www.crunchyroll.com/de/watch/x']) {
    assert.equal(context.isCrunchyrollUrl(url), true);
  }
  for (const url of ['http://crunchyroll.com', 'https://crunchyroll.com.evil.test', 'file:///watch/x', 'garbage']) {
    assert.equal(context.isCrunchyrollUrl(url), false);
  }
});
test('content: mutation bursts schedule one refresh and bind all videos', () => {
  const { context } = load('content.js', { querySelectorAll: () => [video(), video()] });
  const callbacks = [];
  let bound = 0;
  let mounted = 0;
  context.requestAnimationFrame = (fn) => callbacks.push(fn);
  context.bindVideoListeners = () => bound++;
  context.mountPipButtonInControls = () => mounted++;
  context.scheduleMount(); context.scheduleMount(); context.scheduleMount();
  assert.equal(callbacks.length, 1);
  callbacks.shift()();
  assert.equal(bound, 2);
  assert.equal(mounted, 1);
  context.scheduleMount();
  assert.equal(callbacks.length, 1);
});
test('content: player controls accept nested wrappers without CSS class dependency', () => {
  const stack = {};
  const wrapper = { parentElement: stack, className: 'new-player-wrapper' };
  const subtitle = { parentElement: { parentElement: wrapper }, className: 'control' };
  const pipWrapper = { parentElement: null, nextSibling: null };
  const pipButton = { parentElement: pipWrapper, className: 'control' };
  const { context } = load('content.js', {
    querySelector: () => stack,
    getElementById: (id) => id === 'cr-pip-helper-wrapper' ? pipWrapper : pipButton
  });
  context.isEpisodePage = () => true;
  context.getActiveVideo = () => video();
  context.findSubtitleButton = (controls) => { assert.equal(controls, stack); return subtitle; };
  context.normalizePipButtonStyle = () => {};
  context.getShortcutLabel = () => 'Alt+P';
  let inserted = false;
  stack.insertBefore = (element, before) => {
    assert.equal(element, pipWrapper); assert.equal(before, wrapper); inserted = true;
  };
  context.mountPipButtonInControls();
  assert.equal(inserted, true);
});
test('background: toolbar click messages the content script on Crunchyroll tabs only', async () => {
  const { handlers } = load('background.js');
  await handlers.click({ id: 1, url: 'https://www.crunchyroll.com/watch/x' });
  assert.equal(JSON.stringify(handlers.sent), JSON.stringify([1, { type: 'cr-pip-toggle' }]));
  handlers.sent = undefined;
  await handlers.click({ id: 2, url: 'https://example.com/' });
  assert.equal(handlers.sent, undefined);
});
test('content: toggle message triggers PiP, other messages are ignored', async () => {
  let entered = 0;
  const { context, handlers } = load('content.js', { pictureInPictureEnabled: true,
    querySelectorAll: () => [video({ requestPictureInPicture: async () => entered++ })] });
  handlers.message({ type: 'other' });
  await new Promise((r) => setImmediate(r));
  assert.equal(entered, 0);
  handlers.message({ type: 'cr-pip-toggle' });
  await new Promise((r) => setImmediate(r));
  assert.equal(entered, 1);
});
test('content: subtitle button is found in all Crunchyroll UI languages', () => {
  const { context } = load('content.js');
  const controls = (label) => ({ querySelectorAll: () => [
    { getAttribute: (n) => n === 'aria-label' ? 'Volume' : null, textContent: '' },
    { getAttribute: (n) => n === 'aria-label' ? label : null, textContent: '' }
  ] });
  for (const label of ['Subtitles', 'Untertitel', 'Subtítulos', 'Legendas', 'Sous-titres', 'Sottotitoli', 'Субтитры', 'الترجمة']) {
    assert.ok(context.findSubtitleButton(controls(label)), label);
  }
  assert.equal(context.findSubtitleButton({ querySelectorAll: () => [
    { getAttribute: () => 'Volume', textContent: '' }] }), null);
});
