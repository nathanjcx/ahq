# PIN-184 checkout reproduction

This is intentionally the original broken local checkout. Run `npm test` here. Full-price, explicit-zero coupon and zero-tax cases pass; the two taxed fixed-coupon cases fail until a worker fixes the arithmetic. The fixed $10 coupon on $100 at 8% produces $104.40 instead of $97.20.

Amounts are dollars, `taxRate` is a decimal fraction, and `coupon` is a fixed dollar amount. This fixture covers nonnegative subtotals, rates and coupons no greater than subtotal. Changing input validation, currency rounding or the coupon contract is outside PIN-184.

QA must run against the completed patch workspace and save fresh command output. The original fixture, captured original logs and historical full-price check are not proof of a fix.
