// Native readiness adapter for the original account-enabled web client.
// Injected by the shell, so the deployed server needs no Android-specific changes.
(() => {
  if (window.__SP_ANDROID_SHELL__) return;
  window.__SP_ANDROID_SHELL__ = true;
  let stopped = false;
  let layoutInstalled = false;
  let subscribed = false;
  let observer;
  let settingsHost;
  let closeSettings;
  const loggedIn = () => {
    const s = window.__SP__?.store.get();
    return Boolean(s?.session.entered && s.me.playerId != null);
  };
  // Older deployed pages have no lobby settings entry. Reuse their shared modal
  // until the updated web files are deployed, without duplicating its controls.
  const openSettings = async () => {
    if (!loggedIn() || settingsHost) return;
    try {
      const [{ h, render }, { SettingsModal }] = await Promise.all([
        import('/vendor/preact.module.js'), import('/js/ui/settings.js'),
      ]);
      if (!loggedIn() || settingsHost) return;
      settingsHost = document.createElement('div');
      document.body.appendChild(settingsHost);
      closeSettings = () => { render(null, settingsHost); settingsHost.remove(); settingsHost = null; closeSettings = null; };
      render(h(SettingsModal, { open: true, onClose: closeSettings }), settingsHost);
    } catch (error) { report({ error: String(error) }); }
  };
  const adaptSettings = () => {
    if (!loggedIn()) { closeSettings?.(); return; }
    const header = document.querySelector('.lobby-screen .topbar__right, .room-screen .topbar__right');
    // Login changes the store before Preact commits the new header. A fallback
    // added in that gap must be removed when the web-owned button arrives.
    if (header?.querySelector('.lobby-settings, .room-settings')) {
      header.querySelectorAll('.sp-shell-settings').forEach(button => button.remove());
    } else if (header && !header.querySelector('.sp-shell-settings')) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'btn btn--secondary btn--sm sp-shell-settings';
      button.textContent = '设置'; button.addEventListener('click', openSettings);
      header.prepend(button);
    }
    document.querySelectorAll('.set-hint').forEach(hint => {
      hint.classList.toggle('sp-shell-shortcuts', Boolean(hint.querySelector('kbd')));
    });
    const list = document.querySelector('.set-list');
    if (list?.querySelector('.native-display-settings:not(.sp-shell-display-settings)')) {
      list.querySelectorAll('.sp-shell-display-settings').forEach(button => button.remove());
    } else if (list && !list.querySelector('.native-display-settings')) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'btn btn--secondary native-display-settings sp-shell-display-settings';
      button.textContent = '安卓屏幕设置';
      button.addEventListener('click', () => window.AndroidNative.openServerSettings());
      list.prepend(button);
    }
  };
  const adaptAccountLayout = () => {
    if (layoutInstalled || !document.head) return;
    const style = document.createElement('style');
    // The original five-field registration form exceeds a phone's landscape viewport.
    // Keep the original form and handlers, but allow its content to scroll, including above the keyboard.
    style.textContent = `.title-settings, .set-guide, .sp-shell-shortcuts { display: none !important; }
    @media (max-height: 600px) {
      .title-main { min-height: 0; max-height: calc(100% - .6rem); overflow-y: auto;
        width: 100%; margin-top: 0; padding: .1rem 0; }
      .title-main > * { flex-shrink: 0; }
      .title-main > .emblem, .title-main > .title-en, .title-main > .title-tag { display: none; }
    }`;
    document.head.appendChild(style);
    layoutInstalled = true;
  };
  const report = (extra = {}) => {
    const root = document.getElementById('app');
    // #app has no height of its own: the original client positions .app-root/.screen absolutely.
    const surface = root?.querySelector('.screen') || root?.firstElementChild;
    const bounds = surface?.getBoundingClientRect();
    const state = {
      ready: Boolean(window.__SP__ && root?.childElementCount && bounds?.width && bounds?.height),
      loggedIn: loggedIn(),
      rootChildren: root?.childElementCount || 0,
      canvasCount: document.querySelectorAll('canvas').length,
      userAgent: navigator.userAgent,
      ...extra,
    };
    window.AndroidNative.reportClientState(JSON.stringify(state));
    return state.ready;
  };
  window.addEventListener('error', (event) => report({ error: event.message || '页面脚本错误' }));
  window.addEventListener('unhandledrejection', (event) => report({ error: String(event.reason) }));
  let unsubscribe;
  window.addEventListener('pagehide', () => { stopped = true; unsubscribe?.(); observer?.disconnect(); closeSettings?.(); });
  const poll = () => {
    if (stopped) return;
    adaptAccountLayout();
    if (!report()) setTimeout(poll, 250);
    else if (!subscribed) {
      subscribed = true;
      adaptSettings();
      observer = new MutationObserver(adaptSettings);
      observer.observe(document.body, { childList: true, subtree: true });
      unsubscribe = window.__SP__.store.subscribe((state, previous) => {
        if (state.session.entered !== previous.session.entered || state.me.playerId !== previous.me.playerId) { report(); adaptSettings(); }
      });
    }
  };
  poll();
})();
