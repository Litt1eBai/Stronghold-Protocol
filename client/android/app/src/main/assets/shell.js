// Native readiness adapter for the original account-enabled web client.
// Injected by the shell, so the deployed server needs no Android-specific changes.
(() => {
  if (window.__SP_ANDROID_SHELL__) return;
  window.__SP_ANDROID_SHELL__ = true;
  let stopped = false;
  let layoutInstalled = false;
  const adaptAccountLayout = () => {
    if (layoutInstalled || !document.head) return;
    const style = document.createElement('style');
    // The original five-field registration form exceeds a phone's landscape viewport.
    // Keep the original form and handlers, but allow its content to scroll, including above the keyboard.
    style.textContent = `@media (max-height: 600px) {
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
  window.addEventListener('pagehide', () => { stopped = true; });
  const poll = () => {
    if (stopped) return;
    adaptAccountLayout();
    if (!report()) setTimeout(poll, 250);
  };
  poll();
})();
