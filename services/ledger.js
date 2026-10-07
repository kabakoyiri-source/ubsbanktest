const mongoose = require('mongoose');
const User = require('../models/User');
const Operation = require('../models/Operation');

const CURRENCIES = ['CHF', 'EUR', 'USD'];
function fail(status, message) { throw Object.assign(new Error(message), { status }); }
function parseAmount(value) {
  if (typeof value !== 'number' && typeof value !== 'string') fail(400, 'Montant invalide.');
  if (typeof value === 'string' && !/^\d+(?:[.,]\d{1,2})?$/.test(value.trim())) fail(400, 'Saisissez un montant positif avec deux décimales au maximum.');
  const amount = Number(String(value).replace(',', '.'));
  const cents = Math.round(amount * 100);
  if (!Number.isSafeInteger(cents) || cents <= 0 || Math.abs(amount * 100 - cents) > .000001) fail(400, 'Montant invalide.');
  return cents;
}
function parseCurrency(value = 'CHF') {
  const currency = typeof value === 'string' ? value.toUpperCase() : '';
  if (!CURRENCIES.includes(currency)) fail(400, 'Devise invalide. Choisissez CHF, EUR ou USD.');
  return currency;
}
function calculateBalances(operations) {
  const balances = { CHF: 0, EUR: 0, USD: 0 };
  for (const operation of operations) {
    const currency = (operation.currency || 'CHF').toUpperCase();
    if (!CURRENCIES.includes(currency)) continue;
    const cents = Math.round(Number(operation.amount || 0) * 100);
    if (!Number.isSafeInteger(cents)) fail(500, 'Montant enregistré invalide.');
    if (operation.status === 'completed') balances[currency] += cents;
    else if (operation.status === 'pending') balances[currency] -= Math.abs(cents);
    if (!Number.isSafeInteger(balances[currency])) fail(400, 'Le montant dépasse la limite du compte.');
  }
  return balances;
}
async function readBalances(userId, session) {
  const operations = await Operation.find({ userId }).select('amount currency status').session(session).lean();
  return calculateBalances(operations);
}
async function withLedgerTransaction(userId, mutation) {
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      // Serialize all mutations of this user's ledger before reading its
      // balance. Conflicting transfers retry against the latest balance.
      const lock = await User.updateOne({ _id: userId }, { $inc: { ledgerRevision: 1 } }, { session });
      if (!lock.matchedCount) fail(401, 'Compte introuvable.');
      const balances = await readBalances(userId, session);
      const data = await mutation({ session, balances });
      const after = await readBalances(userId, session);
      const values = Object.fromEntries(CURRENCIES.map(currency => [currency, after[currency] / 100]));
      await User.updateOne({ _id: userId }, { $set: { balances: values } }, { session });
      result = { data, balances: values };
    }, { readPreference: 'primary', readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
    return result;
  } finally { await session.endSession(); }
}
module.exports = { CURRENCIES, fail, parseAmount, parseCurrency, calculateBalances, withLedgerTransaction };
