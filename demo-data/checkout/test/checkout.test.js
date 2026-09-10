import test from 'node:test';
import assert from 'node:assert/strict';
import { checkoutTotal } from '../checkout.js';

test('full-price checkout applies tax once', () => {
  assert.equal(checkoutTotal(100, 0.08), 108);
});

test('coupon checkout taxes the discounted subtotal once', () => {
  assert.equal(checkoutTotal(100, 0.08, 10), 97.2);
});

test('explicit zero coupon preserves full price', () => {
  assert.equal(checkoutTotal(100, 0.08, 0), 108);
});

test('fixed coupon subtracts an amount rather than a percentage', () => {
  assert.equal(checkoutTotal(200, 0.08, 10), 205.2);
});

test('zero tax leaves the discounted subtotal', () => {
  assert.equal(checkoutTotal(100, 0, 10), 90);
});
