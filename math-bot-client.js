'use strict';

(function attachMathBotClient(root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.MKMathBotClient = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function createClientApi(root) {
  const MAX_MESSAGE_LENGTH = 4000;
  const DEFAULT_TIMEOUT_MS = 15000;

  function createClient(options = {}) {
    const endpoint = String(options.endpoint || '').trim();
    const fetchRequest = options.fetch || root.fetch?.bind(root);
    const baseUrl = options.baseUrl || root.location?.href || 'https://mkforai001-ctrl.github.io/mk-all-in-one/';
    const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : DEFAULT_TIMEOUT_MS;

    async function reply(message, { lang = 'ha', engine, signal } = {}) {
      const text = String(message ?? '').trim();
      if (!text || text.length > MAX_MESSAGE_LENGTH) throw new Error('invalid-message');
      if (!endpoint) {
        if (!engine || typeof engine.analyze !== 'function') throw new Error('local-engine-unavailable');
        return { source: 'local', ...engine.analyze(text, { lang }) };
      }
      if (typeof fetchRequest !== 'function' || typeof root.AbortController !== 'function') throw new Error('backend-unavailable');

      let url;
      try {
        url = new URL(endpoint, baseUrl);
      } catch {
        throw new Error('invalid-backend-url');
      }
      const localHost = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
      if (url.protocol !== 'https:' && !(url.protocol === 'http:' && localHost)) throw new Error('invalid-backend-url');

      const controller = new root.AbortController();
      const abortFromCaller = () => controller.abort();
      if (signal?.aborted) controller.abort();
      else signal?.addEventListener('abort', abortFromCaller, { once: true });
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchRequest(url.href, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ message: text, language: lang === 'ha' ? 'ha' : 'en' }),
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
        if (error.message === 'invalid-backend-response' || error.message === 'backend-unavailable') throw error;
        if (controller.signal.aborted) throw new Error('backend-timeout');
        throw new Error('backend-unavailable');
      } finally {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', abortFromCaller);
      }
    }

    return Object.freeze({ reply, hasBackend: Boolean(endpoint) });
  }

  return Object.freeze({ createClient, MAX_MESSAGE_LENGTH });
});
