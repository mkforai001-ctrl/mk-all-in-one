'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
const definition = script?.match(/const calculatorMath=Object\.freeze\((\{[\s\S]*?\n\})\);/)?.[1];
assert.ok(definition, 'calculatorMath must remain available in the inline app script');
const calculatorMath = vm.runInNewContext(`(${definition})`);

test('basic arithmetic supports decimals, negatives, chaining, and remainder', () => {
  assert.equal(calculatorMath.basic(25, 15, '+'), 40);
  assert.equal(calculatorMath.basic(2.5, 1.25, '*'), 3.125);
  assert.equal(calculatorMath.basic(-7, 3, '%'), -1);
  assert.equal(calculatorMath.basic(calculatorMath.basic(25, 15, '+'), 2, '*'), 80);
  assert.throws(() => calculatorMath.basic(4, 0, '/'), { message: 'divideZero' });
  assert.throws(() => calculatorMath.basic(4, 0, '%'), { message: 'divideZero' });
});

test('percentage accepts decimals and negative values and rejects overflow', () => {
  assert.equal(calculatorMath.percentage(15, 2000), 300);
  assert.equal(calculatorMath.percentage(-12.5, 80), -10);
  assert.throws(() => calculatorMath.percentage(200, Number.MAX_VALUE), { message: 'invalidResult' });
});

test('profit totals and margin use revenue as the margin denominator', () => {
  const result = calculatorMath.profit(100, 150, 10);
  assert.equal(result.totalCost, 1000);
  assert.equal(result.totalRevenue, 1500);
  assert.equal(result.profit, 500);
  assert.equal(result.perItem, 50);
  assert.ok(Math.abs(result.margin - 100 / 3) < 1e-12);
  assert.equal(calculatorMath.profit(100, 0, 2).margin, 0);
  assert.throws(() => calculatorMath.profit(1, 2, 0), { message: 'validPrices' });
  assert.throws(() => calculatorMath.profit(Number.MAX_VALUE, 1, 2), { message: 'invalidResult' });
});

test('discount handles both boundaries and rejects invalid inputs', () => {
  assert.deepEqual({ ...calculatorMath.discount(1000, 20) }, { amount: 200, finalPrice: 800 });
  assert.deepEqual({ ...calculatorMath.discount(1000, 0) }, { amount: 0, finalPrice: 1000 });
  assert.deepEqual({ ...calculatorMath.discount(1000, 100) }, { amount: 1000, finalPrice: 0 });
  assert.throws(() => calculatorMath.discount(100, 101), { message: 'validDiscount' });
  assert.throws(() => calculatorMath.discount(Number.MAX_VALUE, 100), { message: 'invalidResult' });
});

test('loan estimates handle zero interest, monthly and yearly durations, and invalid values', () => {
  assert.deepEqual({ ...calculatorMath.loan(12000, 0, 12) }, { payment: 1000, total: 12000, interest: 0 });
  assert.equal(calculatorMath.loanMonths(12, 'months'), 12);
  const yearlyMonths = calculatorMath.loanMonths(1, 'years');
  assert.equal(yearlyMonths, 12);
  const yearly = calculatorMath.loan(12000, 12, yearlyMonths);
  assert.ok(Math.abs(yearly.payment - 1066.185) < 0.001);
  assert.throws(() => calculatorMath.loanMonths(101, 'years'), { message: 'validLoan' });
  assert.throws(() => calculatorMath.loan(12000, -1, 12), { message: 'validLoan' });
  assert.throws(() => calculatorMath.loan(12000, 5, 1201), { message: 'validLoan' });
  assert.throws(() => calculatorMath.loan(Number.MAX_VALUE, 10, 12), { message: 'invalidResult' });
});