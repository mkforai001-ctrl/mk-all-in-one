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
  assert.match(result.answer, /Loss after stated costs: ₦1,000/);
  assert.match(result.answer, /Result per item: ₦10 loss/);
  assert.match(result.answer, /Break-even price per item: ₦1,000/);
  assert.match(result.answer, /not a prediction of future market prices/);
});

test('business calculations include known extra costs and report absent revenue clearly', () => {
  const withTransport = bot.analyze('Bought 10 bags at ₦100 each. Selling price is ₦150 each. I spent ₦50 on transport.', { lang: 'en' });
  assert.match(withTransport.answer, /Profit after stated costs: ₦450/);
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

test('percentage, discount, ratio, conversions, statistics, and linear equations are solved deterministically', () => {
  assert.match(bot.analyze('What is 15% of 2000?', { lang: 'en' }).answer, /15% of 2,000 = 300/);
  assert.match(bot.analyze('Calculate 20% discount from ₦1,000', { lang: 'en' }).answer, /Discount amount: ₦200/);
  assert.match(bot.analyze('Simplify ratio 12:18', { lang: 'en' }).answer, /12:18 = 2:3/);
  assert.match(bot.analyze('Convert 2 km to m', { lang: 'en' }).answer, /2 km = 2,000 m/);
  assert.match(bot.analyze('Find the mean of 2, 4, 6', { lang: 'en' }).answer, /Mean .*: 4/);
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
  assert.match(unrelated.answer, /I am MK MATH BOT/);
  assert.equal(bot.analyze('relationship advice', { lang: 'ha' }).type, 'unrelated');
  assert.match(bot.analyze('Warware: 2x + 3 = 11', { lang: 'ha' }).answer, /x = 8 ÷ 2 = 4/);
  const hausaBusiness = bot.analyze('Jakkuna 3, farashin sayarwa ₦40,000 kowane. Na kashe ₦1,000 a kan gyada da ₦20,000 a kan nama. Lissafa jimillar kuɗin shiga da ragowar kuɗi.', { lang: 'ha' });
  assert.match(hausaBusiness.answer, /₦.*120,000/);
  assert.match(hausaBusiness.answer, /₦.*21,000/);
  assert.match(hausaBusiness.answer, /₦.*99,000/);
  assert.match(hausaBusiness.answer, /ba a bayar da kuɗin sayen kayan ba/);
});

test('unsupported advanced math and invalid input are never answered with invented results', () => {
  const unsupported = bot.analyze('Find the integral of sin(x) from 0 to 1.', { lang: 'en' });
  assert.equal(unsupported.type, 'unsupported');
  assert.match(unsupported.answer, /cannot reliably solve/);
  assert.match(bot.analyze('Calculate 1 / 0', { lang: 'en' }).answer, /Division by zero/);
  assert.equal(bot.analyze('x'.repeat(bot.MAX_INPUT_LENGTH + 1), { lang: 'en' }).type, 'error');
});

test('client uses local deterministic answers when no backend is configured', async () => {
  const client = botClient.createClient();
  const result = await client.reply('What is 25 + 15?', { lang: 'en', engine: bot });
  assert.equal(client.hasBackend, false);
  assert.equal(result.source, 'local');
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
  assert.deepEqual(JSON.parse(request.options.body), { message: '25 + 15', language: 'ha' });
  assert.equal(result.source, 'backend');
  assert.equal(result.answer, 'The answer is 40.');
});

test('backend failures do not silently substitute a local answer', async () => {
  const client = botClient.createClient({
    endpoint: 'https://math.example.test/api',
    fetch: async () => new Response('unavailable', { status: 503 })
  });
  await assert.rejects(client.reply('25 + 15', { lang: 'en', engine: bot }), { message: 'backend-unavailable' });
  await assert.rejects(botClient.createClient({ endpoint: 'http://remote.example.test' }).reply('25 + 15', { engine: bot }), { message: 'invalid-backend-url' });
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
  assert.match(appHtml, /<textarea class="bot-input" id="botInput"/);
  assert.match(appHtml, /import\('\.\/math-bot\.js'\)/);
  assert.match(appHtml, /import\('\.\/math-bot-client\.js'\)/);
  assert.doesNotMatch(appHtml, /<script[^>]+src="\.\/math-bot(?:-client)?\.js"/);
  assert.match(appHtml, /window\.SpeechRecognition\|\|window\.webkitSpeechRecognition/);
  assert.match(appHtml, /text\.textContent=message\.text/);
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '..', 'math-bot.js'), 'utf8'), /\beval\s*\(/);
});