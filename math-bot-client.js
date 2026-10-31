'use strict';

(function attachMathBotClient(root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.MKMathBotClient = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function createClientApi(root) {
  const MAX_MESSAGE_LENGTH = 4000;
  const DEFAULT_TIMEOUT_MS = 25000;
  const MODE_STORAGE_KEY = 'mkcalc-bot-mode';
  const HISTORY_STORAGE_KEY = 'mkcalc-bot-history-v1';
  const MAX_HISTORY_MESSAGES = 80;
  const MAX_HISTORY_TEXT_LENGTH = 12000;
  const MAX_HISTORY_TOTAL_CHARS = 60000;

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

  function createConversationStore(storage, options = {}) {
    let store = storage;
    try { if (store === undefined) store = root.localStorage; } catch { store = null; }
    const maxMessages = Number.isInteger(options.maxMessages) && options.maxMessages > 0 ? Math.min(options.maxMessages, 200) : MAX_HISTORY_MESSAGES;
    const maxTextLength = Number.isInteger(options.maxTextLength) && options.maxTextLength > 0 ? Math.min(options.maxTextLength, 20000) : MAX_HISTORY_TEXT_LENGTH;
    const maxTotalChars = Number.isInteger(options.maxTotalChars) && options.maxTotalChars > 0 ? Math.min(options.maxTotalChars, 100000) : MAX_HISTORY_TOTAL_CHARS;
    const sensitive = /(?:api[_-]?key|access[_-]?token|service[_-]?role|secret)\s*[:=]\s*\S+|\bBearer\s+[A-Za-z0-9._~-]{16,}\b|\b(?:sk-[A-Za-z0-9_-]{16,}|sb_secret_[A-Za-z0-9_-]{12,})/iu;

    function normalize(messages) {
      if (!Array.isArray(messages)) return [];
      const normalized = [];
      let total = 0;
      for (const item of messages.slice(-maxMessages)) {
        if (!item || !['user', 'assistant'].includes(item.role) || typeof item.text !== 'string') continue;
        const text = item.text.trim().slice(0, maxTextLength);
        if (!text || sensitive.test(text) || total + text.length > maxTotalChars) continue;
        normalized.push({ role: item.role, text });
        total += text.length;
      }
      return normalized;
    }

    return Object.freeze({
      load() {
        try {
          const raw = store?.getItem(HISTORY_STORAGE_KEY);
          return raw ? normalize(JSON.parse(raw)) : [];
        } catch { return []; }
      },
      save(messages) {
        const safeMessages = normalize(messages);
        try {
          if (!store) return false;
          store.setItem(HISTORY_STORAGE_KEY, JSON.stringify(safeMessages));
          return true;
        } catch { return false; }
      },
      clear() {
        try { store?.removeItem(HISTORY_STORAGE_KEY); return true; }
        catch { return false; }
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
        if (response.status === 504) throw new Error('backend-timeout');
        if (!response.ok) throw new Error('backend-unavailable');
        if (!response.headers?.get('content-type')?.includes('application/json')) throw new Error('invalid-backend-response');
        const payload = await response.json();
        if (!payload || typeof payload.answer !== 'string' || !payload.answer.trim() || payload.answer.length > 12000) {
          throw new Error('invalid-backend-response');
        }
        return { source: 'backend', type: typeof payload.type === 'string' ? payload.type : 'math', answer: payload.answer };
      } catch (error) {
        if (['invalid-backend-response', 'backend-unavailable', 'backend-timeout', 'invalid-backend-url'].includes(error.message)) throw error;
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

  return Object.freeze({ createClient, createModePreference, createConversationStore, MAX_MESSAGE_LENGTH, HISTORY_STORAGE_KEY, MAX_HISTORY_MESSAGES });
});
