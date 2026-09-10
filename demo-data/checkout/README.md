# Pinecone checkout

A local checkout calculator with a browser preview and Node tests. No dependencies or payment service.

Run `npm start`, then open http://127.0.0.1:4179. Set `PORT` to change the port.
Run `npm test` for the checkout cases.

The starting version deliberately contains PIN-184. A fixed $10 coupon on a $100 order with 8% sales tax returns $104.40 instead of $97.20. The coupon path in `checkout.js` adds tax twice. Two tests fail until an agent fixes it. Full-price checkout must remain $108.

Amounts are dollars, `taxRate` is a decimal fraction, and `coupon` is a fixed dollar amount. This fixture covers nonnegative subtotals, rates and coupons no greater than subtotal. Changing input validation, currency rounding or the coupon contract is outside PIN-184.

The browser imports the same `checkoutTotal` function that the tests exercise. Fixing that function changes the preview as well. The office copies this project into each bug workspace and gives dependent QA the completed patch.

QA must run against the completed patch workspace and save fresh command output. Original logs and the historical full-price check do not prove a fix.

The office's pull request artifact is simulated. Its patch and test output come from the local files and executed tests; it does not publish to GitHub.
