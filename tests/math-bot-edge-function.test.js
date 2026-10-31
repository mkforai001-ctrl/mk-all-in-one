'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const handlerModulePromise = import('../supabase/functions/mk-math-bot/index.ts');

function makeEnv(overrides = {}) {
  const values = {
    GEMINI_API_KEY: 'test-gemini-key',
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-secret',
    ...overrides,
  };
  return { get(name) { return values[name]; } };
}

function request(body, overrides = {}) {
  return new Request('https://edge.example.test/mk-math-bot', {
    method: overrides.method || 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'https://mkforai001-ctrl.github.io',
      'cf-connecting-ip': '203.0.113.10',
      ...(overrides.headers || {}),
    },
    body: overrides.rawBody ?? JSON.stringify(body),
  });
}

function makeFetch({ rateLimit = [{ allowed: true, retry_after_seconds: 1, daily_remaining: 39 }], providerStatus = 200, answer = '2 + 2 = 4' } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('/rest/v1/rpc/consume_math_bot_rate_limit')) {
      return Response.json(rateLimit, { status: 200 });
    }
    if (String(url).includes('generativelanguage.googleapis.com')) {
      if (providerStatus !== 200) return Response.json({ error: 'provider failure' }, { status: providerStatus });
      return Response.json({ candidates: [{ content: { parts: [{ text: answer }] } }] });
    }
    throw new Error('unexpected-url');
  };
  return { fetchImpl, calls };
}

test('preflight allows the configured production origin without calling providers', async () => {
  const { createHandler } = await handlerModulePromise;
  const { fetchImpl, calls } = makeFetch();
  const handler = createHandler({ env: makeEnv(), fetchImpl });
  const response = await handler(request(null, { method: 'OPTIONS', headers: { 'content-type': '' } }));
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://mkforai001-ctrl.github.io');
  assert.equal(calls.length, 0);
});

test('rejects unapproved browser origins', async () => {
  const { createHandler } = await handlerModulePromise;
  const { fetchImpl, calls } = makeFetch();
  const handler = createHandler({ env: makeEnv(), fetchImpl });
  const req = request({ message: '2+2', language: 'en' }, { headers: { origin: 'https://attacker.example' } });
  const response = await handler(req);
  assert.equal(response.status, 403);
  assert.equal(calls.length, 0);
});

test('validates JSON, language, and message length before spending provider quota', async () => {
  const { createHandler } = await handlerModulePromise;
  const { fetchImpl, calls } = makeFetch();
  const handler = createHandler({ env: makeEnv(), fetchImpl });
  const malformed = await handler(request(null, { rawBody: '{bad json' }));
  assert.equal(malformed.status, 400);
  const badLanguage = await handler(request({ message: '2+2', language: 'fr' }));
  assert.equal(badLanguage.status, 400);
  const tooLong = await handler(request({ message: 'x'.repeat(4001), language: 'en' }));
  assert.equal(tooLong.status, 400);
  assert.equal(calls.length, 0);
});

test('fails closed when the rate limiter rejects a request', async () => {
  const { createHandler } = await handlerModulePromise;
  const { fetchImpl, calls } = makeFetch({ rateLimit: [{ allowed: false, retry_after_seconds: 25, daily_remaining: 0 }] });
  const handler = createHandler({ env: makeEnv(), fetchImpl });
  const response = await handler(request({ message: '2+2', language: 'en' }));
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '25');
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /consume_math_bot_rate_limit/);
});

test('calls Gemini with server-side credentials and returns the existing client response contract', async () => {
  const { createHandler } = await handlerModulePromise;
  const { fetchImpl, calls } = makeFetch();
  const handler = createHandler({ env: makeEnv(), fetchImpl });
  const response = await handler(request({
    message: 'What is 2 + 2?',
    language: 'en',
    conversation: [
      { role: 'user', text: 'What is 1 + 1?' },
      { role: 'assistant', text: '1 + 1 = 2.' },
    ],
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { answer: '2 + 2 = 4', type: 'math' });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].init.headers.Authorization, 'Bearer test-service-role-secret');
  assert.equal(calls[1].init.headers['x-goog-api-key'], 'test-gemini-key');
  const providerBody = JSON.parse(calls[1].init.body);
  assert.equal(providerBody.contents[0].role, 'user');
  assert.equal(providerBody.contents[1].role, 'model');
  assert.equal(providerBody.contents[2].parts[0].text, 'What is 2 + 2?');
  assert.match(providerBody.systemInstruction.parts[0].text, /mathematics learning assistant/);
});

test('maps provider quota errors to HTTP 429 without exposing provider response bodies', async () => {
  const { createHandler } = await handlerModulePromise;
  const { fetchImpl } = makeFetch({ providerStatus: 429 });
  const handler = createHandler({ env: makeEnv(), fetchImpl });
  const response = await handler(request({ message: '2+2', language: 'en' }));
  assert.equal(response.status, 429);
  assert.deepEqual(await response.json(), { error: 'provider_rate_limited' });
});

test('fails safely if the client address or server secrets are missing', async () => {
  const { createHandler } = await handlerModulePromise;
  const { fetchImpl, calls } = makeFetch();
  const handler = createHandler({ env: makeEnv(), fetchImpl });
  const noIp = new Request('https://edge.example.test/mk-math-bot', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://mkforai001-ctrl.github.io' },
    body: JSON.stringify({ message: '2+2', language: 'en' }),
  });
  assert.equal((await handler(noIp)).status, 503);
  const missingSecret = createHandler({ env: makeEnv({ GEMINI_API_KEY: undefined }), fetchImpl });
  assert.equal((await missingSecret(request({ message: '2+2', language: 'en' }))).status, 503);
  assert.equal(calls.length, 0);
});
