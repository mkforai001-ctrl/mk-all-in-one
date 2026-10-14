'use strict';

(function attachMathBotClient(root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.MKMathBotClient = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function createClientApi(root) {
  const MAX_MESSAGE_LENGTH = 4000;
  const DEFAULT_TIMEOUT_MS = 15000;
  const MODE_STORAGE_KEY = 'mkcalc-bot-mode';

  function createModePreference(storage) {
    let store = storage;
    let mode = 'offline';
    try {
      if (store === undefined) store = root.localStorage;
      mode = store?.getItem(MODE_STORAGE_KEY) === 'online' ? 'online' : 'offline';
    } catch {}
    return Object.freeze({
      getMode() { return mode; },
      setMode(next) {
        if (next !== 'offline' && next !== 'online') throw new Error('invalid-mode');
        mode = next;
        try { store?.setItem(MODE_STORAGE_KEY, mode); } catch {}
        return mode;
      }
    });
  }

  function createClient(options = {}) {
    const endpoint = String(options.endpoint || '').trim();
    const fetchRequest = options.fetch || root.fetch?.bind(root);
    const baseUrl = options.baseUrl || root.location?.href || 'https://mkforai001-ctrl.github.io/mk-all-in-one/';
    const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : DEFAULT_TIMEOUT_MS;

    function validateMessage(message) {
      const text = String(message ?? '').trim();
      if (!text || text.length > MAX_MESSAGE_LENGTH) throw new Error('invalid-message');
      return text;
    }

    function replyOffline(message, { lang = 'ha', engine, context = [] } = {}) {
      const text = validateMessage(message);
      if (!engine || typeof engine.analyze !== 'function') throw new Error('local-engine-unavailable');
      return { source: 'offline', ...engine.analyze(text, { lang, context }) };
    }

    async function replyOnline(message, { lang = 'ha', context = [], signal } = {}) {
      const text = validateMessage(message);
      if (!endpoint) throw new Error('backend-not-configured');
      if (typeof fetchRequest !== 'function' || typeof root.AbortController !== 'function') throw new Error('backend-unavailable');

      let url;
      try {
        url = new URL(endpoint, baseUrl);
      } catch {
        throw new Error('invalid-backend-url');
      }
      const localHost = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
      const hasCredentialQuery = [...url.searchParams.keys()].some(key => /(?:api[_-]?key|token|secret|credential|authorization)/iu.test(key));
      if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && localHost)) || url.username || url.password || hasCredentialQuery) throw new Error('invalid-backend-url');

      const controller = new root.AbortController();
      const abortFromCaller = () => controller.abort();
      if (signal?.aborted) controller.abort();
      else signal?.addEventListener('abort', abortFromCaller, { once: true });
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const requestBody = { message: text, language: lang === 'ha' ? 'ha' : 'en' };
        if (Array.isArray(context)) {
          requestBody.conversation = context.slice(-8).flatMap(item => {
            if (!item || !['user', 'assistant'].includes(item.role) || typeof item.text !== 'string') return [];
            return [{ role: item.role, text: item.text.slice(0, 2000) }];
          });
        }
        const response = await fetchRequest(url.href, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(requestBody),
          signal: controller.signal
        });
        if (!response.ok) throw new Error('backend-unavailable');
        if (!response.headers?.get('content-type')?.includes('application/json')) throw new Error('invalid-backend-response');
        const payload = await response.json();
        if (!payload || typeof payload.answer !== 'string' || !payload.answer.trim() || payload.answer.length > 12000) {
          throw new Error('invalid-backend-response');
        }
        return { source: 'backend', type: typeof payload.type === 'string' ? payload.type : 'math', answer: payload.answer };
      } catch (error) {
        if (['invalid-backend-response', 'backend-unavailable', 'invalid-backend-url'].includes(error.message)) throw error;
        if (controller.signal.aborted) throw new Error('backend-timeout');
        throw new Error('backend-unavailable');
      } finally {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', abortFromCaller);
      }
    }

    async function reply(message, options = {}) {
      return endpoint ? replyOnline(message, options) : replyOffline(message, options);
    }

    return Object.freeze({ reply, replyOffline, replyOnline, hasBackend: Boolean(endpoint) });
  }

  return Object.freeze({ createClient, createModePreference, MAX_MESSAGE_LENGTH });
});
