export function checkoutTotal(subtotal, taxRate, coupon = 0) {
  const discounted = subtotal - coupon;
  const tax = discounted * taxRate;
  return discounted + tax + (coupon > 0 ? tax : 0);
}
