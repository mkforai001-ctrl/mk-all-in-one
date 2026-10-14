'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const bot = require('../math-bot.js');
const botClient = require('../math-bot-client.js');
const appHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('safe arithmetic parser handles precedence, decimals, fractions, powers, and percentages without eval', () => {
  assert.equal(bot.evaluateExpression('25 + 15 * 2'), 55);
  assert.equal(bot.evaluateExpression('(25 + 15) / 2'), 20);
  assert.equal(bot.evaluateExpression('7 / 2'), 3.5);
  assert.equal(bot.evaluateExpression('2 ^ 3'), 8);
  assert.equal(bot.evaluateExpression('15%'), 0.15);
  assert.throws(() => bot.evaluateExpression('1 / 0'), { message: 'division-by-zero' });
  assert.throws(() => bot.evaluateExpression('process.exit()'), { message: 'unsupported-expression' });
  assert.throws(() => bot.evaluateExpression('1e999'), { message: 'invalid-result' });
});

test('elementary functions use radians, base-10 log, natural log, and safe domains', () => {
  assert.equal(bot.evaluateExpression('sqrt(81)'), 9);
  assert.equal(bot.evaluateExpression('log(100)'), 2);
  assert.equal(bot.evaluateExpression('ln(e)'), 1);
  assert.equal(bot.evaluateExpression('sin(pi / 2)'), 1);
  assert.equal(bot.evaluateExpression('cos(0)'), 1);
  assert.equal(bot.evaluateExpression('tan(0)'), 0);
  assert.equal(bot.evaluateExpression('abs(-3)'), 3);
  assert.equal(bot.evaluateExpression('pi'), Math.PI);
  assert.equal(bot.evaluateExpression('e'), Math.E);
  assert.ok(Math.abs(bot.evaluateExpression('sin(90)') - Math.sin(90)) < 1e-12);
  assert.throws(() => bot.evaluateExpression('sqrt(-1)'), { message: 'invalid-domain' });
  assert.throws(() => bot.evaluateExpression('log(0)'), { message: 'invalid-domain' });
  assert.throws(() => bot.evaluateExpression('ln(-1)'), { message: 'invalid-domain' });
  assert.throws(() => bot.evaluateExpression('tan(pi / 2)'), { message: 'invalid-domain' });
  assert.match(bot.analyze('Calculate sqrt(81)', { lang: 'en' }).answer, /sqrt\(81\) = 9/);
  assert.match(bot.analyze('Calculate log(100)', { lang: 'en' }).answer, /log\(100\) = 2/);
  assert.match(bot.analyze('Calculate ln(e)', { lang: 'en' }).answer, /ln\(e\) = 1/);
  assert.match(bot.analyze('Calculate sqrt(-1)', { lang: 'en' }).answer, /valid mathematical domain/);
  assert.match(bot.analyze('Calculate sin(pi / 2)', { lang: 'en' }).answer, /angles are in radians/);
  assert.match(bot.analyze('Lissafa sin(pi / 2)', { lang: 'ha' }).answer, /radian/);
});

test('grain revenue, multiple expenses, and balance do not mislabel balance as profit', () => {
  const result = bot.analyze('I sold three bags of grain. Each bag sold for ₦40,000. I spent ₦1,000 on groundnuts and ₦20,000 on meat. Calculate the total revenue, total expenses, and remaining balance.', { lang: 'en' });
  assert.equal(result.type, 'math');
  assert.equal(result.values.revenueCents, '12000000');
  assert.equal(result.values.expensesCents, '2100000');
  assert.equal(result.values.balanceCents, '9900000');
  assert.match(result.answer, /Total revenue: ₦120,000/);
  assert.match(result.answer, /Other stated expenses: ₦21,000/);
  assert.match(result.answer, /Balance after the other stated expenses: ₦99,000/);
  assert.match(result.answer, /original purchase cost was not provided/);
  assert.doesNotMatch(result.answer, /Profit after stated costs/);
});

test('maize purchase and sale prices calculate total and per-item loss plus break-even price', () => {
  const result = bot.analyze('I bought 100 bowls of maize at ₦1,000 each. The current selling price is ₦990 per bowl. Should I sell?', { lang: 'en' });
  assert.match(result.answer, /Total revenue: ₦99,000/);
  assert.match(result.answer, /Total purchase cost: 100 × ₦1,000 = ₦100,000/);
  assert.match(result.answer, /Loss before additional unreported expenses: ₦1,000/);
  assert.match(result.answer, /Result per item: ₦10 loss/);
  assert.match(result.answer, /Break-even price per item: ₦1,000/);
  assert.match(result.answer, /not a prediction of future market prices/);
});

test('English grain purchase and selling variants calculate gross profit and both percentages', () => {
  const result = bot.analyze('I bought 90 bowls of grain for ₦1,000 each and sold each for ₦1,100. What is my profit?', { lang: 'en' });
  assert.match(result.answer, /Total purchase cost: 90 × ₦1,000 = ₦90,000/);
  assert.match(result.answer, /Total revenue: ₦99,000/);
  assert.match(result.answer, /Profit before additional unreported expenses: ₦9,000/);
  assert.match(result.answer, /Result per item: ₦100 profit/);
  assert.match(result.answer, /Return on purchase cost: 10%/);
  assert.match(result.answer, /Profit\/loss margin on revenue: 9\.090909%/);
});

test('informal Hausa maize wording extracts quantity and both per-bowl prices', () => {
  const prompt = 'Na siyo masara, Kuma duk kwano daya naira 1000, Kuma nasiyo kawano 90, Kuma na siyar ita akan kwano daya 1100';
  const result = bot.analyze(prompt, { lang: 'ha' });

  assert.equal(result.type, 'math');
  assert.equal(result.values.quantity, 90);
  assert.equal(result.values.revenueCents, '9900000');
  assert.equal(result.values.expensesCents, '9000000');
  assert.match(result.answer, /90 × ₦.*1,100 = ₦.*99,000/);
  assert.match(result.answer, /90 × ₦.*1,000 = ₦.*90,000/);
  assert.match(result.answer, /₦.*9,000/);
  assert.match(result.answer, /Riba kafin ƙarin kuɗaɗen da ba a ambata ba/);
  assert.match(result.answer, /₦.*100 riba/);
  assert.match(result.answer, /10%/);
});

test('business calculations include known extra costs and report absent revenue clearly', () => {
  const withTransport = bot.analyze('Bought 10 bags at ₦100 each. Selling price is ₦150 each. I spent ₦50 on transport.', { lang: 'en' });
  assert.match(withTransport.answer, /Profit after stated expenses, before additional unreported expenses: ₦450/);
  assert.match(withTransport.answer, /Profit\/loss margin on revenue: 30%/);
  assert.match(withTransport.answer, /Break-even price per item: ₦105/);
  const missingPrice = bot.analyze('I bought 10 bags and spent ₦50 on transport. Calculate profit.', { lang: 'en' });
  assert.match(missingPrice.answer, /could not identify a selling price or total revenue/);

  const roundedBreakEven = bot.analyze('Bought 3 bowls at ₦1 each. Selling price is ₦1.02 per bowl. I spent ₦0.01 on transport.', { lang: 'en' });
  assert.match(roundedBreakEven.answer, /Break-even price per item: ₦1\.01/);

  const conflictingRevenue = bot.analyze('I sold 3 bags. Each bag sold for ₦40,000. Total revenue was ₦100,000.', { lang: 'en' });
  assert.match(conflictingRevenue.answer, /conflicts with 3 × unit selling price/);
  assert.doesNotMatch(conflictingRevenue.answer, /Balance after/);
});

test('percentage, discount, ratio, conversions, statistics, geometry, and linear equations are solved deterministically', () => {
  assert.match(bot.analyze('What is 15% of 2000?', { lang: 'en' }).answer, /15% of 2,000 = 300/);
  assert.match(bot.analyze('Calculate 20% discount from ₦1,000', { lang: 'en' }).answer, /Discount amount: ₦200/);
  assert.match(bot.analyze('Simplify ratio 12:18', { lang: 'en' }).answer, /12:18 = 2:3/);
  assert.match(bot.analyze('Convert 2 km to m', { lang: 'en' }).answer, /2 km = 2,000 m/);
  assert.match(bot.analyze('Find the mean of 2, 4, 6', { lang: 'en' }).answer, /Mean .*: 4/);
  assert.match(bot.analyze('Find area of a rectangle with length 8 and width 5', { lang: 'en' }).answer, /Rectangle area: 8 × 5 = 40 square units/);
  assert.match(bot.analyze('Solve 2x + 3 = 11', { lang: 'en' }).answer, /x = 8 ÷ 2 = 4/);
});

test('simple interest, annual compound interest, and zero-interest loans state their assumptions', () => {
  const simple = bot.analyze('Calculate simple interest on ₦10,000 at 12% for 2 years.', { lang: 'en' });
  assert.match(simple.answer, /Simple interest: ₦2,400/);
  assert.match(simple.answer, /Total amount: ₦12,400/);

  const compound = bot.analyze('Calculate compound interest on ₦10,000 at 12% for 2 years.', { lang: 'en' });
  assert.match(compound.answer, /Compound interest \(annual compounding\): ₦2,544/);
  assert.match(compound.answer, /compounded annually/);
  assert.doesNotMatch(compound.answer, /ana haɗawa/);

  const loan = bot.analyze('Loan of ₦12,000 at 0% for 12 months.', { lang: 'en' });
  assert.match(loan.answer, /Estimated monthly payment: ₦1,000/);
  assert.match(loan.answer, /Total repayment: ₦12,000/);
  assert.match(loan.answer, /Total interest: ₦0/);
  assert.match(loan.answer, /Assumes fixed monthly repayments/);

  const amortizing = bot.analyze('Loan of ₦12,000 at 12% for 12 months.', { lang: 'en' });
  assert.match(amortizing.answer, /Estimated monthly payment: ₦1,066\.19/);
  assert.match(amortizing.answer, /Total repayment: ₦12,794\.23/);
  assert.match(amortizing.answer, /Total interest: ₦794\.23/);
});

test('Hausa prompts receive Hausa math responses and unrelated topics are redirected', () => {
  const hausa = bot.analyze('Nawa ne kaso 15% na 2000?', { lang: 'ha' });
  assert.equal(hausa.type, 'math');
  assert.match(hausa.answer, /15% na 2,000 = 300/);
  const unrelated = bot.analyze('Give me relationship advice about my girlfriend.', { lang: 'en' });
  assert.equal(unrelated.type, 'unrelated');
  assert.match(unrelated.answer, /Friend, I'm MK MATH BOT/);
  assert.equal(bot.analyze('relationship advice', { lang: 'ha' }).type, 'unrelated');
  assert.match(bot.analyze('Warware: 2x + 3 = 11', { lang: 'ha' }).answer, /x = 8 ÷ 2 = 4/);
  const hausaBusiness = bot.analyze('Jakkuna 3, farashin sayarwa ₦40,000 kowane. Na kashe ₦1,000 a kan gyada da ₦20,000 a kan nama. Lissafa jimillar kuɗin shiga da ragowar kuɗi.', { lang: 'ha' });
  assert.match(hausaBusiness.answer, /₦.*120,000/);
  assert.match(hausaBusiness.answer, /₦.*21,000/);
  assert.match(hausaBusiness.answer, /₦.*99,000/);
  assert.match(hausaBusiness.answer, /ba a bayar da kuɗin sayen kayan ba/);
});

test('guard allows greetings, bot identity questions, and contextual math follow-ups', () => {
  assert.equal(bot.analyze('Hello!', { lang: 'en' }).type, 'greeting');
  assert.match(bot.analyze('Hello!', { lang: 'en' }).answer, /mathematics assistant/);
  assert.equal(bot.analyze('Who are you?', { lang: 'en' }).type, 'identity');
  assert.equal(bot.analyze('Sannu', { lang: 'ha' }).type, 'greeting');
  assert.equal(bot.analyze('Me ya sa?', { lang: 'ha', context: [{ role: 'user', text: 'What is 2 + 2?' }] }).type, 'follow-up');
  assert.equal(bot.analyze('Me ya sa?', { lang: 'ha' }).type, 'clarification');
  assert.equal(bot.analyze('Nawa ce ribata?', { lang: 'ha' }).type, 'clarification');
  assert.equal(bot.analyze('How much?', { lang: 'en' }).type, 'clarification');
  const followUp = bot.analyze('Nawa ce ribata?', { lang: 'ha', context: [
    { role: 'user', text: 'Na siyo masara, Kuma duk kwano daya naira 1000, Kuma nasiyo kawano 90, Kuma na siyar ita akan kwano daya 1100' }
  ] });
  assert.equal(followUp.type, 'follow-up');
  assert.match(followUp.answer, /Riba kafin ƙarin kuɗaɗen da ba a ambata ba/);
  assert.equal(bot.analyze('How much?', { lang: 'en', context: [{ role: 'user', text: 'What is 20% of 100?' }] }).type, 'follow-up');
});

test('unsupported advanced math and invalid input are never answered with invented results', () => {
  const unsupported = bot.analyze('Find the integral of sin(x) from 0 to 1.', { lang: 'en' });
  assert.equal(unsupported.type, 'unsupported');
  assert.match(unsupported.answer, /cannot reliably solve/);
  assert.match(bot.analyze('Calculate 1 / 0', { lang: 'en' }).answer, /Division by zero/);
  assert.equal(bot.analyze('x'.repeat(bot.MAX_INPUT_LENGTH + 1), { lang: 'en' }).type, 'error');
  assert.equal(bot.analyze('Prove that the sum of the first n odd integers is a square.', { lang: 'en' }).type, 'unsupported');
  assert.equal(bot.analyze('What is the determinant of a matrix?', { lang: 'en' }).type, 'unsupported');
  assert.equal(bot.analyze('What happened in the election?', { lang: 'en' }).type, 'unrelated');
});

test('client uses local deterministic answers when no backend is configured', async () => {
  const client = botClient.createClient();
  const result = await client.reply('What is 25 + 15?', { lang: 'en', engine: bot });
  assert.equal(client.hasBackend, false);
  assert.equal(result.source, 'offline');
  assert.match(result.answer, /25 \+ 15 = 40/);
});

test('configured backend receives bounded JSON requests and validated responses', async () => {
  let request;
  const client = botClient.createClient({
    endpoint: 'https://math.example.test/api',
    fetch: async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify({ type: 'math', answer: 'The answer is 40.' }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
  });
  const result = await client.reply('25 + 15', { lang: 'ha', engine: bot });

  assert.equal(client.hasBackend, true);
  assert.equal(request.url, 'https://math.example.test/api');
  assert.equal(request.options.method, 'POST');
  assert.deepEqual(JSON.parse(request.options.body), { message: '25 + 15', language: 'ha', conversation: [] });
  assert.equal(result.source, 'backend');
  assert.equal(result.answer, 'The answer is 40.');
});

test('online adapter sends only the last eight bounded conversation turns', async () => {
  let payload;
  const client = botClient.createClient({
    endpoint: 'https://math.example.test/api',
    fetch: async (_url, options) => {
      payload = JSON.parse(options.body);
      return new Response(JSON.stringify({ answer: 'Clarified.' }), { headers: { 'Content-Type': 'application/json' } });
    }
  });
  const context = Array.from({ length: 10 }, (_, index) => ({ role: 'user', text: `turn ${index}` }));
  context[9] = { role: 'system', text: 'discard this role' };
  context[8] = { role: 'assistant', text: 'x'.repeat(2500) };
  await client.replyOnline('Why?', { lang: 'en', context });
  assert.equal(payload.conversation.length, 7);
  assert.deepEqual(payload.conversation[0], { role: 'user', text: 'turn 2' });
  assert.equal(payload.conversation[6].text.length, 2000);
});

test('mode preference defaults offline, persists mode, and rejects invalid values', () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const preference = botClient.createModePreference(storage);
  assert.equal(preference.getMode(), 'offline');
  assert.equal(preference.setMode('online'), 'online');
  assert.equal(botClient.createModePreference(storage).getMode(), 'online');
  assert.throws(() => preference.setMode('ai'), { message: 'invalid-mode' });
});

test('explicit Offline mode never calls the configured online endpoint', async () => {
  let calls = 0;
  const client = botClient.createClient({ endpoint: 'https://math.example.test/api', fetch: async () => { calls += 1; } });
  const result = client.replyOffline('What is 25 + 15?', { lang: 'en', engine: bot });
  assert.equal(result.source, 'offline');
  assert.match(result.answer, /25 \+ 15 = 40/);
  assert.equal(calls, 0);
});

test('explicit Online mode reports an unconfigured backend without local fallback', async () => {
  let calls = 0;
  const client = botClient.createClient({ fetch: async () => { calls += 1; } });
  await assert.rejects(client.replyOnline('What is 25 + 15?', { lang: 'en' }), { message: 'backend-not-configured' });
  assert.equal(calls, 0);
});

test('backend failures do not silently substitute a local answer', async () => {
  const client = botClient.createClient({
    endpoint: 'https://math.example.test/api',
    fetch: async () => new Response('unavailable', { status: 503 })
  });
  await assert.rejects(client.reply('25 + 15', { lang: 'en', engine: bot }), { message: 'backend-unavailable' });
  await assert.rejects(botClient.createClient({ endpoint: 'http://remote.example.test' }).reply('25 + 15', { engine: bot }), { message: 'invalid-backend-url' });
  await assert.rejects(botClient.createClient({ endpoint: 'https://user:pass@math.example.test/api' }).replyOnline('25 + 15'), { message: 'invalid-backend-url' });
  await assert.rejects(botClient.createClient({ endpoint: 'https://math.example.test/api?api_key=secret' }).replyOnline('25 + 15'), { message: 'invalid-backend-url' });
});

test('configured backend requests time out rather than hanging indefinitely', async () => {
  const client = botClient.createClient({
    endpoint: 'https://math.example.test/api',
    timeoutMs: 5,
    fetch: async (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    })
  });
  await assert.rejects(client.reply('25 + 15', { lang: 'en', engine: bot }), { message: 'backend-timeout' });
});

test('dashboard exposes a bilingual bot tile, accessible chat, and lazy module loading', () => {
  assert.match(appHtml, /\{id:'mathbot',icon:'∑',title:'mathbot',desc:'mathbotDesc'\}/);
  assert.match(appHtml, /Object\.assign\(translations\.ha,\{mathbot:'MK MATH BOT'/);
  assert.match(appHtml, /Object\.assign\(translations\.en,\{mathbot:'MK MATH BOT'/);
  assert.match(appHtml, /role="log" aria-live="polite"/);
  assert.match(appHtml, /id="botModeSwitch"[^>]+role="group"/);
  assert.ok(appHtml.indexOf('class="bot-mode-switch"') < appHtml.indexOf('class="bot-messages"'));
  assert.match(appHtml, /let mathBotMode='offline'/);
  assert.match(appHtml, /botOfflineMode:'OFFLINE'/);
  assert.match(appHtml, /botOnlineMode:'ONLINE AI'/);
  assert.match(appHtml, /botOnlineNotConfigured/);
  assert.match(appHtml, /<textarea class="bot-input" id="botInput"/);
  assert.match(appHtml, /import\('\.\/math-bot\.js'\)/);
  assert.match(appHtml, /import\('\.\/math-bot-client\.js'\)/);
  assert.doesNotMatch(appHtml, /<script[^>]+src="\.\/math-bot(?:-client)?\.js"/);
  assert.match(appHtml, /window\.SpeechRecognition\|\|window\.webkitSpeechRecognition/);
  assert.match(appHtml, /text\.textContent=message\.text/);
  assert.match(appHtml, /modules\.client\.replyOffline/);
  assert.match(appHtml, /modules\.client\.replyOnline/);
  assert.match(appHtml, /\['unrelated','greeting','identity','follow-up'\]\.includes\(guard\.type\)/);
  assert.match(appHtml, /id="botModeSwitch" role="group"/);
  assert.match(appHtml, /id="botOfflineMode" type="button" aria-pressed="false"/);
  assert.match(appHtml, /id="botOnlineMode" type="button" aria-pressed="false"/);
  assert.match(appHtml, /localStorage\.setItem\('mkcalc-bot-mode',mode\)/);
  assert.match(appHtml, /modules\.client\.replyOffline/);
  assert.match(appHtml, /modules\.client\.replyOnline/);
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '..', 'math-bot.js'), 'utf8'), /\beval\s*\(/);
});