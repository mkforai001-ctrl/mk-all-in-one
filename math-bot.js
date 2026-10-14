'use strict';

(function attachMathBot(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.MKMathBot = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function createMathBot() {
  const MAX_INPUT_LENGTH = 4000;
  const MAX_MONEY_CENTS = BigInt(Number.MAX_SAFE_INTEGER);
  const NUMBER_WORDS = {
    zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    ɗaya: 1, daya: 1, biyu: 2, uku: 3, huɗu: 4, hudu: 4, biyar: 5, shida: 6, bakwai: 7, takwas: 8, tara: 9, goma: 10
  };
  const NUMBER_SOURCE = '(?:\\d[\\d,]*(?:\\.\\d+)?|' + Object.keys(NUMBER_WORDS).join('|') + ')';
  const CURRENCY_SOURCE = '(?:₦\\s*|NGN\\s*)?';
  const PLAIN_AMOUNT_SOURCE = '(\\d[\\d,]*(?:\\.\\d{1,3})?)';

  function numberValue(value) {
    const normalized = String(value).trim().toLocaleLowerCase();
    if (Object.hasOwn(NUMBER_WORDS, normalized)) return NUMBER_WORDS[normalized];
    const number = Number(normalized.replaceAll(',', ''));
    return Number.isFinite(number) ? number : null;
  }

  function parseCents(value) {
    const normalized = String(value).replaceAll(',', '').trim();
    const match = normalized.match(/^(-?)(\d+)(?:\.(\d+))?$/);
    if (!match || (match[3] || '').length > 3) return null;
    const fraction = (match[3] || '').padEnd(3, '0');
    let cents = BigInt(match[2]) * 100n + BigInt(fraction.slice(0, 2));
    if (Number(fraction[2]) >= 5) cents += 1n;
    if (match[1]) cents = -cents;
    return cents <= MAX_MONEY_CENTS && cents >= -MAX_MONEY_CENTS ? cents : null;
  }

  function formatNumber(value, lang) {
    if (!Number.isFinite(value)) throw new Error('invalid-result');
    return new Intl.NumberFormat(lang === 'ha' ? 'ha-NG' : 'en-NG', { maximumFractionDigits: 6 }).format(value);
  }

  function formatMoney(cents, lang) {
    if (cents > MAX_MONEY_CENTS || cents < -MAX_MONEY_CENTS) throw new Error('invalid-result');
    return new Intl.NumberFormat(lang === 'ha' ? 'ha-NG' : 'en-NG', {
      style: 'currency', currency: 'NGN', minimumFractionDigits: 0, maximumFractionDigits: 2
    }).format(Number(cents) / 100);
  }

  function roundedCents(amount) {
    if (!Number.isFinite(amount) || Math.abs(amount * 100) > Number.MAX_SAFE_INTEGER) throw new Error('invalid-result');
    return BigInt(Math.round(amount * 100));
  }

  function evaluateExpression(source) {
    const input = source.replaceAll('−', '-').replaceAll(',', '').replace(/₦|NGN/gi, '').replace(/\s+/g, '');
    const tokens = [];
    const matcher = /(?:sqrt|log|ln|sin|cos|tan|abs|pi|e)\b|π|(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?|[()+\-*/%^]/giy;
    let cursor = 0;
    while (cursor < input.length) {
      matcher.lastIndex = cursor;
      const match = matcher.exec(input);
      if (!match) throw new Error('unsupported-expression');
      tokens.push(match[0]);
      cursor = matcher.lastIndex;
    }
    if (!tokens.length) throw new Error('unsupported-expression');
    let index = 0;

    function primary() {
      const token = tokens[index++];
      if (token === '+' || token === '-') {
        const value = primary();
        return token === '-' ? -value : value;
      }
      if (token === '(') {
        const value = addition();
        if (tokens[index++] !== ')') throw new Error('unsupported-expression');
        return value;
      }
      if (['sqrt', 'log', 'ln', 'sin', 'cos', 'tan', 'abs'].includes(token)) {
        let argument;
        if (tokens[index] === '(') {
          index += 1;
          argument = addition();
          if (tokens[index++] !== ')') throw new Error('unsupported-expression');
        } else {
          argument = primary();
        }
        if (token === 'sqrt') {
          if (argument < 0) throw new Error('invalid-domain');
          return Math.sqrt(argument);
        }
        if (token === 'log' || token === 'ln') {
          if (argument <= 0) throw new Error('invalid-domain');
          return token === 'log' ? Math.log10(argument) : Math.log(argument);
        }
        if (token === 'sin') return Math.sin(argument);
        if (token === 'cos') return Math.cos(argument);
        if (token === 'tan') {
          if (Math.abs(Math.cos(argument)) < 1e-12) throw new Error('invalid-domain');
          return Math.tan(argument);
        }
        return Math.abs(argument);
      }
      if (token === 'pi' || token === 'π') return Math.PI;
      if (token === 'e') return Math.E;
      const value = Number(token);
      if (!Number.isFinite(value)) throw new Error('invalid-result');
      return value;
    }

    function power() {
      let value = primary();
      if (tokens[index] === '^') {
        index += 1;
        value **= power();
      }
      if (tokens[index] === '%' && (index + 1 === tokens.length || tokens[index + 1] === ')')) {
        index += 1;
        value /= 100;
      }
      return value;
    }

    function multiplication() {
      let value = power();
      while (['*', '/', '%'].includes(tokens[index])) {
        const operator = tokens[index++];
        const right = power();
        if ((operator === '/' || operator === '%') && right === 0) throw new Error('division-by-zero');
        if (operator === '*') value *= right;
        if (operator === '/') value /= right;
        if (operator === '%') value %= right;
      }
      return value;
    }

    function addition() {
      let value = multiplication();
      while (tokens[index] === '+' || tokens[index] === '-') {
        const operator = tokens[index++];
        const right = multiplication();
        value = operator === '+' ? value + right : value - right;
      }
      return value;
    }

    const result = addition();
    if (index !== tokens.length || !Number.isFinite(result)) throw new Error('invalid-result');
    return result;
  }

  function parseLinear(source) {
    const input = source.toLowerCase().replace(/\s+/g, '').replace(/(\d)x/g, '$1*x').replace(/x(\d)/g, 'x*$1');
    const tokens = [];
    const matcher = /(?:\d+(?:\.\d*)?|\.\d+)|x|[()+\-*/]/gy;
    let cursor = 0;
    while (cursor < input.length) {
      matcher.lastIndex = cursor;
      const match = matcher.exec(input);
      if (!match) throw new Error('unsupported-equation');
      tokens.push(match[0]);
      cursor = matcher.lastIndex;
    }
    let index = 0;
    const add = (left, right) => [left[0] + right[0], left[1] + right[1]];
    const subtract = (left, right) => [left[0] - right[0], left[1] - right[1]];
    const multiply = (left, right) => {
      if (left[0] !== 0 && right[0] !== 0) throw new Error('nonlinear-equation');
      return [left[0] * right[1] + left[1] * right[0], left[1] * right[1]];
    };
    const divide = (left, right) => {
      if (right[0] !== 0 || right[1] === 0) throw new Error('unsupported-equation');
      return [left[0] / right[1], left[1] / right[1]];
    };
    function factor() {
      const token = tokens[index++];
      if (token === '+' || token === '-') {
        const value = factor();
        return token === '-' ? [-value[0], -value[1]] : value;
      }
      if (token === '(') {
        const value = expression();
        if (tokens[index++] !== ')') throw new Error('unsupported-equation');
        return value;
      }
      if (token === 'x') return [1, 0];
      const value = Number(token);
      if (!Number.isFinite(value)) throw new Error('unsupported-equation');
      return [0, value];
    }
    function term() {
      let value = factor();
      while (tokens[index] === '*' || tokens[index] === '/') {
        const operator = tokens[index++];
        value = operator === '*' ? multiply(value, factor()) : divide(value, factor());
      }
      return value;
    }
    function expression() {
      let value = term();
      while (tokens[index] === '+' || tokens[index] === '-') {
        const operator = tokens[index++];
        value = operator === '+' ? add(value, term()) : subtract(value, term());
      }
      return value;
    }
    const result = expression();
    if (index !== tokens.length) throw new Error('unsupported-equation');
    return result;
  }

  function solveEquation(source) {
    const sides = source.toLowerCase().replace(/^(?:solve|find\s+x|lissafa|warware)\s*:?\s*/i, '').split('=');
    if (sides.length !== 2 || !sides.some(side => /x/i.test(side))) return null;
    const left = parseLinear(sides[0]);
    const right = parseLinear(sides[1]);
    const coefficient = left[0] - right[0];
    if (coefficient === 0) throw new Error('no-unique-solution');
    const difference = right[1] - left[1];
    return { value: difference / coefficient, dividend: difference, divisor: coefficient };
  }

  function analyzeBusiness(text, lang) {
    const isHa = lang === 'ha';
    const lower = text.toLocaleLowerCase();
    const quantityPattern = new RegExp(`\\b(?:sold|bought|purchased|na\\s+sayar\\s+da|na\\s+sayi|na\\s+saye)\\s+(${NUMBER_SOURCE})\\s+([\\p{L}]+)|\\b(${NUMBER_SOURCE})\\s+(bags?|bowls?|items?|pieces?|units?|jakkuna?|kwano)\\b|\\b(?:nasiyo|na\\s+siyo)\\s+(?:masara\\s+)?(?:kawano|kwano)\\s+(${NUMBER_SOURCE})\\b`, 'iu');
    const quantityMatch = lower.match(quantityPattern);
    let quantity = quantityMatch ? numberValue(quantityMatch[1] || quantityMatch[3] || quantityMatch[5]) : null;
    if (quantity === null) {
      const reverseQuantity = new RegExp(`\\b(?:bags?|bowls?|items?|pieces?|units?|jakkuna?|kwano)\\s+(${NUMBER_SOURCE})\\b`, 'iu').exec(lower);
      quantity = reverseQuantity ? numberValue(reverseQuantity[1]) : null;
    }
    const salePatterns = [
      new RegExp(`(?:selling\\s+price|sale\\s+price|current\\s+(?:selling\\s+)?price|farashin\\s+sayarwa)\\s*(?:is|of|na|=|:)?\\s*${CURRENCY_SOURCE}${PLAIN_AMOUNT_SOURCE}`, 'iu'),
      new RegExp(`(?:sold|sell|selling)\\s+(?:for|at)\\s*${CURRENCY_SOURCE}${PLAIN_AMOUNT_SOURCE}`, 'iu'),
      new RegExp(`(?:sold|sell|selling)\\s+each\\s+(?:for|at)\\s*${CURRENCY_SOURCE}${PLAIN_AMOUNT_SOURCE}`, 'iu'),
      new RegExp(`(?:each|per\\s+[\\p{L}]+).{0,40}?(?:sold|sell|selling)\\s+(?:for|at)\\s*${CURRENCY_SOURCE}${PLAIN_AMOUNT_SOURCE}`, 'iu'),
      new RegExp(`(?:kowace|kowane).{0,40}?${CURRENCY_SOURCE}${PLAIN_AMOUNT_SOURCE}`, 'iu'),
      new RegExp(`na\\s+siyar\\s+ita\\s+akan\\s+(?:kawano|kwano)\\s+(?:daya|ɗaya|guda)\\s*(?:naira\\s*)?${PLAIN_AMOUNT_SOURCE}`, 'iu')
    ];
    const costPatterns = [
      new RegExp(`(?:purchase\\s+price|cost\\s+price|farashin\\s+saye)\\s*(?:is|of|na|=|:)?\\s*${CURRENCY_SOURCE}${PLAIN_AMOUNT_SOURCE}`, 'iu'),
      new RegExp(`(?:bought|purchased|sayi|saye).{0,80}?\\b(?:at|for)\\s*${CURRENCY_SOURCE}${PLAIN_AMOUNT_SOURCE}\\s*each`, 'iu'),
      new RegExp(`(?:duk|kowace|kowane)\\s+(?:kawano|kwano)\\s+(?:daya|ɗaya|guda)\\s+naira\\s*${PLAIN_AMOUNT_SOURCE}`, 'iu')
    ];
    const findCents = patterns => {
      for (const pattern of patterns) {
        const match = pattern.exec(text);
        if (match) {
          const cents = parseCents(match[1]);
          if (cents !== null) return { cents, index: match.index, amountIndex: match.index + match[0].lastIndexOf(match[1]) };
        }
      }
      return null;
    };
    const unitRevenue = findCents(salePatterns);
    const unitCost = findCents(costPatterns);
    const moneyMentions = [...text.matchAll(/(?:₦\s*|NGN\s*)(\d[\d,]*(?:\.\d{1,3})?)/giu)];
    const excluded = new Set([unitRevenue?.amountIndex, unitCost?.amountIndex].filter(Number.isInteger));
    const expenses = [];
    for (const mention of moneyMentions) {
      const index = mention.index;
      if ([...excluded].some(start => Math.abs(start - index) < 4)) continue;
      const context = lower.slice(Math.max(0, index - 100), index);
      if (/(spent|expense|expenses|paid|transport|cost|kashe|kuɗin|kudin|kuɗaɗe|kudade)/iu.test(context)) {
        const cents = parseCents(mention[1]);
        if (cents !== null && cents >= 0n) expenses.push(cents);
      }
    }
    const explicitRevenuePattern = new RegExp(`(?:total\\s+revenue|revenue|sales|income|jimillar\\s+ku[ɗd]in\\s+sayarwa)\\s*(?:is|was|of|na|=|:)?\\s*${CURRENCY_SOURCE}${PLAIN_AMOUNT_SOURCE}`, 'iu');
    const explicitRevenueMatch = explicitRevenuePattern.exec(text);
    const explicitRevenue = explicitRevenueMatch ? parseCents(explicitRevenueMatch[1]) : null;
    const calculatedRevenue = quantity !== null && unitRevenue ? BigInt(quantity) * unitRevenue.cents : null;
    if (calculatedRevenue !== null && explicitRevenue !== null && calculatedRevenue !== explicitRevenue) {
      return { type: 'math', answer: isHa
        ? `Jimillar kuɗin shiga da aka rubuta (${formatMoney(explicitRevenue, lang)}) ba ta yi daidai da adadi ${quantity} × farashin guda ${formatMoney(unitRevenue.cents, lang)} = ${formatMoney(calculatedRevenue, lang)} ba. Duba lambobin kafin lissafin ragowa ko riba.`
        : `The stated total revenue (${formatMoney(explicitRevenue, lang)}) conflicts with ${quantity} × unit selling price ${formatMoney(unitRevenue.cents, lang)} = ${formatMoney(calculatedRevenue, lang)}. Please check the figures before calculating a balance or profit.` };
    }
    const revenueCents = calculatedRevenue ?? explicitRevenue;
    const costCents = quantity !== null && unitCost ? BigInt(quantity) * unitCost.cents : null;
    const isBusiness = quantityMatch || unitRevenue || unitCost || expenses.length || /revenue|profit|loss|expense|balance|sell|sold|bought|purchase|break.?even|sayar|riba|asara|kashe/iu.test(lower);
    if (!isBusiness) return null;
    if (quantity !== null && (!Number.isSafeInteger(quantity) || quantity <= 0)) {
      return { type: 'math', answer: isHa ? 'Yawan kaya ya kamata ya zama cikakkiyar lamba sama da sifili.' : 'Quantity must be a positive whole number.' };
    }
    if (revenueCents === null || revenueCents === undefined) {
      return {
        type: 'math',
        answer: isHa ? 'Na fahimci cewa wannan tambaya ce ta kasuwanci, amma farashin sayarwa ko jimillar kuɗin shiga bai bayyana ba. Ka ƙara adadin da ya ɓace.' : 'I understand this is a business calculation, but I could not identify a selling price or total revenue. Please provide the missing amount.'
      };
    }
    const otherExpenses = expenses.reduce((sum, amount) => sum + amount, 0n);
    const totalExpenses = (costCents ?? 0n) + otherExpenses;
    const balance = revenueCents - otherExpenses;
    const lines = isHa
      ? [`Jimillar kuɗin shiga: ${formatMoney(revenueCents, lang)}`]
      : [`Total revenue: ${formatMoney(revenueCents, lang)}`];
    if (quantity !== null && unitRevenue) {
      lines.push(`${quantity} × ${formatMoney(unitRevenue.cents, lang)} = ${formatMoney(revenueCents, lang)}`);
    }
    if (costCents !== null) {
      lines.push(isHa
        ? `Jimillar kuɗin saye: ${quantity} × ${formatMoney(unitCost.cents, lang)} = ${formatMoney(costCents, lang)}`
        : `Total purchase cost: ${quantity} × ${formatMoney(unitCost.cents, lang)} = ${formatMoney(costCents, lang)}`);
    }
    if (otherExpenses > 0n) {
      lines.push(isHa
        ? `Sauran kuɗaɗen da aka ambata: ${formatMoney(otherExpenses, lang)}`
        : `Other stated expenses: ${formatMoney(otherExpenses, lang)}`);
    }
    if (expenses.length > 1) lines.push(isHa ? 'An tara duk kuɗaɗen da aka ambata.' : 'All explicitly stated expenses are included.');
    if (costCents !== null) {
      const profit = revenueCents - totalExpenses;
      const profitLabel = profit >= 0n
        ? (otherExpenses > 0n
          ? (isHa ? 'Riba bayan kuɗaɗen da aka ambata, kafin ƙarin kuɗaɗen da ba a ambata ba' : 'Profit after stated expenses, before additional unreported expenses')
          : (isHa ? 'Riba kafin ƙarin kuɗaɗen da ba a ambata ba' : 'Profit before additional unreported expenses'))
        : (otherExpenses > 0n
          ? (isHa ? 'Asara bayan kuɗaɗen da aka ambata, kafin ƙarin kuɗaɗen da ba a ambata ba' : 'Loss after stated expenses, before additional unreported expenses')
          : (isHa ? 'Asara kafin ƙarin kuɗaɗen da ba a ambata ba' : 'Loss before additional unreported expenses'));
      lines.push(`${profitLabel}: ${formatMoney(profit < 0n ? -profit : profit, lang)}`);
      if (revenueCents !== 0n) {
        lines.push(`${isHa ? 'Kason riba ko asara bisa kuɗin shiga' : 'Profit/loss margin on revenue'}: ${formatNumber(Number(profit) / Number(revenueCents) * 100, lang)}%`);
      } else {
        lines.push(isHa ? 'Ba za a iya lissafa kaso bisa kuɗin shiga sifili ba.' : 'Profit/loss margin cannot be calculated with zero revenue.');
      }
      if (costCents !== null && costCents > 0n) {
        lines.push(`${isHa ? 'Ribar kaso bisa kuɗin saye' : 'Return on purchase cost'}: ${formatNumber(Number(profit) / Number(costCents) * 100, lang)}%`);
      }
      if (quantity !== null && quantity > 0) {
        const quantityBigInt = BigInt(quantity);
        const unitResult = ((profit < 0n ? -profit : profit) + quantityBigInt / 2n) / quantityBigInt;
        lines.push(`${isHa ? 'Sakamako na kowane kaya' : 'Result per item'}: ${formatMoney(unitResult, lang)} ${profit < 0n ? (isHa ? 'asara' : 'loss') : (isHa ? 'riba' : 'profit')}`);
        const breakEven = (totalExpenses + quantityBigInt - 1n) / quantityBigInt;
        lines.push(`${isHa ? 'Farashin raba-kansu a kalla' : 'Break-even price per item'}: ${formatMoney(breakEven, lang)}`);
      }
      if (/should i sell|should we sell|sell\?|ya kamata.*sayar/iu.test(text)) {
        lines.push(isHa
          ? 'Wannan lissafi ne bisa farashin da aka bayar; ba hasashen kasuwa ba ne.'
          : 'This is based only on the prices provided; it is not a prediction of future market prices.');
      }
    } else {
      if (otherExpenses > 0n) lines.push(`${isHa ? 'Ragowar kuɗi bayan sauran kuɗaɗen da aka lissafa' : 'Balance after the other stated expenses'}: ${formatMoney(balance, lang)}`);
      lines.push(isHa
        ? 'Ba za a iya tabbatar da ribar kasuwanci ba domin ba a bayar da kuɗin sayen kayan ba. Ragowar kuɗi ba lallai ya zama riba ba.'
        : 'Business profit cannot be determined because the original purchase cost was not provided. The remaining balance is not necessarily profit.');
    }
    return { type: 'math', answer: lines.join('\n'), values: { quantity, revenueCents: String(revenueCents), expensesCents: String(totalExpenses), balanceCents: String(balance) } };
  }

  function analyze(text, options = {}) {
    const lang = options.lang === 'ha' ? 'ha' : 'en';
    const input = String(text ?? '').trim();
    if (!input || input.length > MAX_INPUT_LENGTH) {
      return { type: 'error', answer: lang === 'ha' ? 'Shigarwar ta yi tsawo sosai. A takaita ta zuwa haruffa 4,000.' : 'That message is too long. Please keep it under 4,000 characters.' };
    }
    const isHa = lang === 'ha';
    const normalized = input.normalize('NFC').toLocaleLowerCase().replace(/[.!?]+$/u, '').trim();
    if (/^(?:hi|hello|hey|good morning|good afternoon|good evening|sannu|ina kwana|ina wuni|barka da safiya|barka da yamma|na gode|thanks|thank you)$/iu.test(normalized)) {
      return { type: 'greeting', answer: isHa ? 'Sannu! Ni ne MK MATH BOT, mataimakin lissafi. Ka kawo tambayarka mu warware ta tare.' : 'Hello! I am MK MATH BOT, your mathematics assistant. Ask a question and we can work through it together.' };
    }
    if (/^(?:who are you|what is your name|what is mk math bot|what is this bot|what can you do|what do you do|waye kai|waye ke|menene mk math bot|menene sunanka|me kake iya yi)$/iu.test(normalized)) {
      return { type: 'identity', answer: isHa ? 'Ni ne MK MATH BOT. Ina taimakawa da lissafin da injin cikin na’ura ke goyan baya; lissafi mai rikitarwa na iya buƙatar sabis na Online AI da aka haɗa.' : 'I am MK MATH BOT. I help with mathematics supported by the on-device engine; complex problems may require a configured Online AI service.' };
    }
    const contextText = Array.isArray(options.context) ? options.context.map(item => typeof item?.text === 'string' ? item.text : '').join(' ').slice(-12000) : '';
    const followUp = /^(?:why(?: is that)?|how did you get that|how much(?: is it| do i get| remains| will i pay)?|what remains|what is left|what is my profit|explain that|show the steps|check my work|is that correct|me ya sa(?: amsar ta zama haka)?|ka nuna min mataki(?:-mataki)?|ka duba ko na yi daidai|nawa(?: ne| ya rage| zan samu| ce ribata| na kashe| zan biya)?|na ci riba nawa|idan na sayar fa)$/iu.test(normalized);
    if (followUp && contextText) {
      const previousQuestion = [...options.context].reverse().find(item => item?.role === 'user' && typeof item.text === 'string')?.text;
      if (previousQuestion) {
        const previousResult = analyze(previousQuestion, { lang });
        if (previousResult.type === 'math') return { type: 'follow-up', answer: isHa ? `Dangane da tambayarka ta baya:\n${previousResult.answer}` : `Based on your previous question:\n${previousResult.answer}` };
      }
      return { type: 'clarification', answer: isHa ? 'Wane sakamako ko mataki kake so in yi bayani a kai? Ka nuna min ɓangaren tambayar.' : 'Which result or step from the previous calculation would you like me to explain or check?' };
    }
    if (followUp) {
      return { type: 'clarification', answer: isHa ? 'Don Allah ka turo tambayar lissafin ko lambobin da kake magana a kai.' : 'Please include the calculation or numbers you are referring to.' };
    }
    if (/^(?:how much|what remains|what is left|what is my profit|how much will i pay|nawa ne|nawa zan samu|nawa ce ribata|na ci riba nawa|nawa na kashe|nawa ya rage|nawa zan biya|idan na sayar fa|ka warware min|ka nuna min mataki(?:-mataki)?|ka duba ko na yi daidai)$/iu.test(normalized)) {
      return { type: 'clarification', answer: isHa ? 'Don Allah ka turo tambayar lissafin ko lambobin da kake magana a kai.' : 'Please include the calculation or numbers you are referring to.' };
    }
    const mathTopic = /[\d₦%+=*/^()]|\b(math|mathematics|algebra|geometry|trigonometry|calculus|calculate|compute|evaluate|prove|proof|theorem|show that|simplify|factor|expand|differentiate|integrate|derive|what is|solve|equation|inequality|polynomial|matrix|matrices|determinant|vector|sequence|series|limit|percentage|percent|profit|loss|revenue|expense|balance|cost|price|discount|ratio|interest|loan|area|volume|perimeter|triangle|circle|angle|mean|median|variance|probability|statistics|convert|square root|square|root|sqrt|log|ln|sin|cos|tan|abs|derivative|integral|lissafi|lissafa|lissafi na|nawa|riba|asara|kaso|ragi|lamuni|farashi|kuɗi|kudi|sayar|saye|mataki|matakai|ma'auni|ma'aunai|jerin)\b/iu.test(input);
    if (!mathTopic) {
      return { type: 'unrelated', answer: isHa ? 'Aboki, ni MK MATH BOT ne, mataimakinka na lissafi. An tsara ni domin taimaka maka wajen warware matsalolin lissafi, fahimtar sakamakonsu, da ba da shawara bisa lissafi. Ka kawo min tambayar lissafi, mu warware ta tare!' : "Friend, I'm MK MATH BOT, your mathematics assistant. I'm designed to help with calculations, mathematical reasoning, and advice based on numerical results. Please ask me a mathematics-related question and I'll help you work through it." };
    }
    try {
      const interestMatch = new RegExp(`(simple|compound)\\s+interest\\s+(?:on|of)\\s*${CURRENCY_SOURCE}${PLAIN_AMOUNT_SOURCE}[^.!?\\n]{0,60}?(?:at|rate(?:\\s+of)?)\\s*(\\d+(?:\\.\\d+)?)\\s*%[^.!?\\n]{0,30}?(?:for|over)\\s*(\\d+(?:\\.\\d+)?)\\s*(years?|months?)`, 'iu').exec(input);
      if (interestMatch) {
        const principalCents = parseCents(interestMatch[2]);
        const rate = Number(interestMatch[3]);
        const duration = Number(interestMatch[4]);
        const durationYears = /month/i.test(interestMatch[5]) ? duration / 12 : duration;
        if (principalCents === null || principalCents <= 0n || !Number.isFinite(rate) || rate < 0 || !Number.isFinite(durationYears) || durationYears <= 0) throw new Error('invalid-interest');
        const principal = Number(principalCents) / 100;
        const totalAmount = interestMatch[1].toLowerCase() === 'compound'
          ? principal * Math.pow(1 + rate / 100, durationYears)
          : principal * (1 + rate / 100 * durationYears);
        const totalCents = roundedCents(totalAmount);
        const interestCents = totalCents - principalCents;
        const compound = interestMatch[1].toLowerCase() === 'compound';
        const kind = compound ? (isHa ? 'Ribar da ake haɗawa duk shekara' : 'Compound interest (annual compounding)') : (isHa ? 'Riba mai sauƙi' : 'Simple interest');
        const time = `${formatNumber(duration, lang)} ${interestMatch[5].toLowerCase()}`;
        return { type: 'math', answer: `${isHa ? 'Babban kuɗi' : 'Principal'}: ${formatMoney(principalCents, lang)}\n${kind}: ${formatMoney(interestCents, lang)} (${formatMoney(principalCents, lang)} × ${formatNumber(rate, lang)}% × ${time}${compound ? (isHa ? '; ana haɗawa sau ɗaya a shekara' : '; compounded annually') : ''})\n${isHa ? 'Jimillar bayan lokaci' : 'Total amount'}: ${formatMoney(totalCents, lang)}` };
      }

      const loanMatch = new RegExp(`(?:loan|lamuni)\\s*(?:of|for|amount)?\\s*${CURRENCY_SOURCE}${PLAIN_AMOUNT_SOURCE}[^.!?\\n]{0,60}?(?:at|interest\\s+rate(?:\\s+of)?|riba(?:\\s+ta\\s+shekara)?)\\s*(\\d+(?:\\.\\d+)?)\\s*%[^.!?\\n]{0,30}?(?:for|over|na)\\s*(\\d+(?:\\.\\d+)?)\\s*(months?|years?|watanni|shekaru)`, 'iu').exec(input);
      if (loanMatch) {
        const principalCents = parseCents(loanMatch[1]);
        const rate = Number(loanMatch[2]);
        const duration = Number(loanMatch[3]);
        const durationUnit = loanMatch[4].toLowerCase();
        const months = durationUnit.startsWith('year') || durationUnit === 'shekaru' ? duration * 12 : duration;
        if (principalCents === null || principalCents <= 0n || !Number.isFinite(rate) || rate < 0 || !Number.isSafeInteger(months) || months < 1 || months > 1200) throw new Error('invalid-loan');
        const principal = Number(principalCents) / 100;
        const monthlyRate = rate / 1200;
        const payment = monthlyRate === 0 ? principal / months : principal * monthlyRate / (1 - Math.pow(1 + monthlyRate, -months));
        const totalCents = roundedCents(payment * months);
        const interestCents = totalCents - principalCents;
        const monthlyCents = roundedCents(payment);
        return { type: 'math', answer: `${isHa ? 'Biyan kowane wata (ƙiyasta)' : 'Estimated monthly payment'}: ${formatMoney(monthlyCents, lang)}\n${isHa ? 'Jimillar biya' : 'Total repayment'}: ${formatMoney(totalCents, lang)}\n${isHa ? 'Jimillar riba' : 'Total interest'}: ${formatMoney(interestCents, lang)}\n${isHa ? 'An ɗauka cewa ana biyan kuɗi kowane wata ba tare da ƙarin kuɗaɗe ba.' : 'Assumes fixed monthly repayments with no fees or additional charges.'}` };
      }

      const business = analyzeBusiness(input, lang);
      if (business) return business;

      const percentOf = new RegExp(`(-?\\d+(?:\\.\\d+)?)\\s*(?:%|percent|per cent|kaso)\\s*(?:of|na)\\s*(?:₦|NGN\\s*)?(${PLAIN_AMOUNT_SOURCE})`, 'iu').exec(input);
      if (percentOf) {
        const percent = Number(percentOf[1]);
        const base = Number(percentOf[2].replaceAll(',', ''));
        const result = percent / 100 * base;
        if (!Number.isFinite(result)) throw new Error('invalid-result');
        return { type: 'math', answer: isHa ? `${formatNumber(percent, lang)}% na ${formatNumber(base, lang)} = ${formatNumber(result, lang)}` : `${formatNumber(percent, lang)}% of ${formatNumber(base, lang)} = ${formatNumber(result, lang)}` };
      }

      const discountPatterns = [
        new RegExp(`(?:discount|rangwame)\\s*(?:of|na)?\\s*(\\d+(?:\\.\\d+)?)\\s*%?.{0,60}?(?:from|off|on|of|daga|kan)\\s*(?:₦|NGN\\s*)?(${PLAIN_AMOUNT_SOURCE})`, 'iu'),
        new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(?:%|percent|per cent)\\s*(?:discount|rangwame)\\s*(?:from|off|on|of|daga|kan)\\s*(?:₦|NGN\\s*)?(${PLAIN_AMOUNT_SOURCE})`, 'iu')
      ];
      const discount = discountPatterns.map(pattern => pattern.exec(input)).find(Boolean);
      if (discount) {
        const percent = Number(discount[1]);
        const price = parseCents(discount[2]);
        if (price === null || percent < 0 || percent > 100) throw new Error('invalid-discount');
        const reduction = BigInt(Math.round(percent * 100)) * price / 10000n;
        const finalPrice = price - reduction;
        return { type: 'math', answer: isHa ? `Rangwame: ${formatMoney(reduction, lang)}\nSabon farashi: ${formatMoney(finalPrice, lang)}` : `Discount amount: ${formatMoney(reduction, lang)}\nFinal price: ${formatMoney(finalPrice, lang)}` };
      }

      const equation = /(?:solve|find\s+x|x|lissafa|warware)\s*:?\s*[^.!?\n]{0,120}=\s*[^.!?\n]{1,120}/iu.exec(input) || /(?:\d|x)\s*[+\-*/]\s*[^.!?\n]{0,100}=\s*[^.!?\n]{1,100}/iu.exec(input);
      if (equation) {
        const solution = solveEquation(equation[0]);
        if (solution !== null && Number.isFinite(solution.value)) return { type: 'math', answer: isHa
          ? `Warware: x = ${formatNumber(solution.dividend, lang)} ÷ ${formatNumber(solution.divisor, lang)} = ${formatNumber(solution.value, lang)}`
          : `Rearrange and divide: x = ${formatNumber(solution.dividend, lang)} ÷ ${formatNumber(solution.divisor, lang)} = ${formatNumber(solution.value, lang)}` };
      }

      const ratio = /(?:ratio|rabo)\s*(?:of|na)?\s*(\d+)\s*[:/]\s*(\d+)/iu.exec(input);
      if (ratio) {
        const left = Number(ratio[1]);
        const right = Number(ratio[2]);
        const gcd = (a, b) => b ? gcd(b, a % b) : a;
        const divisor = gcd(left, right) || 1;
        return { type: 'math', answer: isHa ? `Rabo: ${left}:${right} = ${left / divisor}:${right / divisor}` : `Ratio: ${left}:${right} = ${left / divisor}:${right / divisor}` };
      }

      const conversion = /(\d+(?:\.\d+)?)\s*(km|m|cm|mm|kg|g|lb|l|ml)\s*(?:to|in|zuwa)\s*(km|m|cm|mm|kg|g|lb|l|ml)\b/iu.exec(input);
      if (conversion) {
        const factors = { km: ['length', 1000], m: ['length', 1], cm: ['length', 0.01], mm: ['length', 0.001], kg: ['mass', 1], g: ['mass', 0.001], lb: ['mass', 0.45359237], l: ['volume', 1], ml: ['volume', 0.001] };
        const from = conversion[2].toLowerCase();
        const to = conversion[3].toLowerCase();
        if (factors[from][0] !== factors[to][0]) throw new Error('incompatible-units');
        const result = Number(conversion[1]) * factors[from][1] / factors[to][1];
        return { type: 'math', answer: `${formatNumber(Number(conversion[1]), lang)} ${from} = ${formatNumber(result, lang)} ${to}` };
      }

      const mean = /(?:mean|average|matsakaici)\s+(?:of|na)?\s*([\d.,\s]+(?:,\s*\d+(?:\.\d+)?)*)/iu.exec(input);
      if (mean) {
        const values = mean[1].split(/[\s,]+/).filter(Boolean).map(Number);
        if (!values.length || values.some(value => !Number.isFinite(value))) throw new Error('invalid-numbers');
        const average = values.reduce((sum, value) => sum + value, 0) / values.length;
        return { type: 'math', answer: `${isHa ? 'Matsakaici' : 'Mean'} (${values.map(value => formatNumber(value, lang)).join(', ')}): ${formatNumber(average, lang)}` };
      }

      const geometry = /(?:area|yankin)\s+(?:of\s+)?(?:a\s+)?(rectangle|rectangular|murabba'i)\s+(?:with\s+)?(?:length|tsawo)\s*(?:of|=|na)?\s*(\d+(?:\.\d+)?).{0,40}?(?:width|faɗi|fadi)\s*(?:of|=|na)?\s*(\d+(?:\.\d+)?)/iu.exec(input);
      if (geometry) {
        const area = Number(geometry[2]) * Number(geometry[3]);
        return { type: 'math', answer: isHa ? `Yanki: ${formatNumber(Number(geometry[2]), lang)} × ${formatNumber(Number(geometry[3]), lang)} = ${formatNumber(area, lang)} murabba'i` : `Rectangle area: ${geometry[2]} × ${geometry[3]} = ${formatNumber(area, lang)} square units` };
      }

      const expression = input.replace(/what is|calculate|compute|evaluate|solve|please|lissafa|nawa ne|=\s*\?/giu, ' ').match(/(?:\b(?:sqrt|log|ln|sin|cos|tan|abs|pi|e)\b|π|[\d.,₦\s()+\-*/%^−])+/iu)?.[0];
      const containsValue = expression && (/[\dπ]/u.test(expression) || /\b(?:pi|e)\b/iu.test(expression));
      const containsFunction = expression && /\b(?:sqrt|log|ln|sin|cos|tan|abs)\b/iu.test(expression);
      const containsOperator = expression && /[+\-*/%^]/u.test(expression);
      if (expression && containsValue && (containsFunction || containsOperator || /^\s*(?:pi|π|e)\s*$/iu.test(expression))) {
        const result = evaluateExpression(expression);
        const radiansNote = /\b(?:sin|cos|tan)\b/iu.test(expression) ? (isHa ? ' (kusurwoyi suna amfani da radian)' : ' (angles are in radians)') : '';
        return { type: 'math', answer: `${expression.trim()} = ${formatNumber(result, lang)}${radiansNote}` };
      }
      return {
        type: 'unsupported',
        answer: isHa ? 'Ba zan ƙirƙiri amsa ba: wannan tambayar tana buƙatar tsarin lissafi da ba a goyan baya a yanayin lissafin cikin na’ura ba. Ka sake tsara ta ko ka shigar da matakai da lambobi a sarari.' : 'I cannot reliably solve this with the available local math engine. Please provide the equation, quantities, units, or calculation steps more explicitly.'
      };
    } catch (error) {
      const messages = {
        'division-by-zero': isHa ? 'Ba za a iya rabawa da sifili ba.' : 'Division by zero is undefined.',
        'invalid-domain': isHa ? 'Wannan lissafi yana wajen iyakar lambobin da aka yarda.' : 'That operation is outside its valid mathematical domain.',
        'invalid-discount': isHa ? 'Rangwame ya kamata ya kasance tsakanin 0% da 100%.' : 'Discount must be between 0% and 100%.',
        'incompatible-units': isHa ? 'Ba za a iya canza waɗannan nau’in raka’a kai tsaye ba.' : 'Those units cannot be converted directly.',
        'no-unique-solution': isHa ? 'Wannan lissafin ba shi da amsa guda ɗaya.' : 'This equation does not have a unique solution.',
        'nonlinear-equation': isHa ? 'Wannan tsarin lissafi mai canji da yawa ba ya cikin abin da ake goyan baya.' : 'This nonlinear equation is outside the supported local solver.',
        'invalid-numbers': isHa ? 'Duba lambobin da aka shigar.' : 'Please check the numbers in the question.',
        'invalid-result': isHa ? 'Sakamakon ya wuce iyakar lissafi mai aminci.' : 'The result is outside the safe calculation range.',
        'invalid-interest': isHa ? 'Duba adadin kuɗi, ribar kaso, da tsawon lokaci.' : 'Check the principal, interest rate, and duration.',
        'invalid-loan': isHa ? 'Duba adadin lamuni, ribar kaso, da tsawon lokacin biya.' : 'Check the loan amount, interest rate, and repayment duration.'
      };
      return { type: 'error', answer: messages[error.message] || (isHa ? 'Ba a iya lissafa wannan shigarwar ba. Duba lambobi da bayanai.' : 'I could not calculate that input. Please check the numbers and details.') };
    }
  }

  return Object.freeze({ analyze, evaluateExpression, formatMoney, parseCents, MAX_INPUT_LENGTH });
});