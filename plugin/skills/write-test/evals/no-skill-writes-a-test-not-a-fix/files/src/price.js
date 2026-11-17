// Formats a price given in cents, as the trip page shows it.
function price(cents) {
  return '$' + cents / 100;
}
module.exports = { price };
