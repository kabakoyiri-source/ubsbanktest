const express = require('express');
const mongoose = require('mongoose');
const Operation = require('../models/Operation');
const Client = require('../models/Client');
const { protect } = require('../middleware/auth');
const { fail, parseAmount, parseCurrency, withLedgerTransaction } = require('../services/ledger');

const router = express.Router();
router.use(protect);
const clientFields = 'firstName lastName bankName accountNumber';
const handle = action => async (req, res) => {
  try { await action(req, res); }
  catch (error) {
    const status = error.status || (error.name === 'CastError' || error.name === 'ValidationError' ? 400 : 500);
    const message = error.code === 20
      ? 'La base doit prendre en charge les transactions MongoDB (Atlas ou replica set).'
      : status === 500 ? 'Impossible d’enregistrer l’opération. Réessayez.' : error.message;
    res.status(status).json({ success: false, message });
  }
};
const requireId = id => { if (!mongoose.isValidObjectId(id)) fail(400, 'Identifiant invalide.'); };
async function ownedClient(clientId, userId, session) {
  requireId(clientId);
  const client = await Client.findOne({ _id: clientId, userId }).session(session);
  if (!client) fail(404, 'Bénéficiaire non trouvé.');
  return client;
}
async function changeClientBalance(client, cents, session) {
  const next = Math.round(Number(client.balance || 0) * 100) + cents;
  if (!Number.isSafeInteger(next) || next < 0) fail(400, 'Solde du bénéficiaire insuffisant.');
  client.balance = next / 100;
  await client.save({ session });
}
function requireFunds(balances, currency, cents) {
  if (balances[currency] < cents) fail(400, `Solde insuffisant sur le compte ${currency}. Ajoutez des fonds dans les paramètres.`);
}
async function createOperation(fields, session, client = null) {
  const [operation] = await Operation.create([fields], { session });
  const data = operation.toObject();
  if (client) data.clientId = client.toObject();
  return data;
}

// Old clients may still send admin=true. A balance always uses only the
// connected user's ledger, never another user's deposits or transfers.
router.get('/', handle(async (req, res) => {
  const { clientId, type, status, startDate, endDate } = req.query;
  const query = { userId: req.user.id };
  if (clientId) { requireId(clientId); query.clientId = clientId; }
  if (type) query.type = type;
  if (status) query.status = status;
  if (startDate || endDate) {
    query.createdAt = {};
    for (const [value, key] of [[startDate, '$gte'], [endDate, '$lte']]) {
      if (!value) continue;
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) fail(400, 'Date invalide.');
      query.createdAt[key] = date;
    }
  }
  const operations = await Operation.find(query).populate('clientId', clientFields).sort({ createdAt: -1 });
  res.json({ success: true, count: operations.length, data: operations });
}));

router.get('/history/:clientId', handle(async (req, res) => {
  await ownedClient(req.params.clientId, req.user.id, null);
  const operations = await Operation.find({ clientId: req.params.clientId, userId: req.user.id }).populate('clientId', clientFields).sort({ createdAt: -1 });
  res.json({ success: true, count: operations.length, data: operations });
}));

router.get('/:id', handle(async (req, res) => {
  requireId(req.params.id);
  const operation = await Operation.findOne({ _id: req.params.id, userId: req.user.id }).populate('clientId', clientFields);
  if (!operation) fail(404, 'Opération introuvable.');
  res.json({ success: true, data: operation });
}));

// Personal-project funding: a completed deposit without card details.
router.post('/', handle(async (req, res) => {
  const { clientId, type, description, reason, recipientAccountNumber } = req.body;
  if (!['deposit', 'withdrawal', 'transfer', 'payment'].includes(type)) fail(400, 'Type d’opération invalide.');
  const cents = parseAmount(req.body.amount);
  const currency = parseCurrency(req.body.currency);
  if (!clientId && type !== 'deposit') fail(400, 'Veuillez sélectionner un bénéficiaire.');
  const result = await withLedgerTransaction(req.user.id, async ({ session, balances }) => {
    let client = null;
    let signedCents = cents;
    if (clientId) {
      client = await ownedClient(clientId, req.user.id, session);
      const outgoing = type === 'deposit' || type === 'transfer';
      if (outgoing) requireFunds(balances, currency, cents);
      await changeClientBalance(client, outgoing ? cents : -cents, session);
      signedCents = outgoing ? -cents : cents;
    }
    return createOperation({
      userId: req.user.id, clientId: clientId || null, type, amount: signedCents / 100,
      currency, adminAccountType: currency.toLowerCase(),
      description: description || (!client ? 'Ajout de fonds' : ''), reason, recipientAccountNumber,
      status: 'completed', balanceAfter: (balances[currency] + signedCents) / 100
    }, session, client);
  });
  res.status(201).json({ success: true, message: 'Opération enregistrée.', ...result });
}));

router.post('/transfer', handle(async (req, res) => {
  const { clientId, adminAccountType, adminAccountName, adminAccountIban, description } = req.body;
  const currency = parseCurrency(req.body.currency || adminAccountType);
  if (typeof adminAccountType !== 'string' || adminAccountType.toUpperCase() !== currency) fail(400, 'Le compte source doit correspondre à la devise du virement.');
  const cents = parseAmount(req.body.amount);
  const transferType = req.body.transferType || (req.body.isScheduled === true ? 'delayed' : 'instant');
  if (!['instant', 'delayed'].includes(transferType)) fail(400, 'Type de virement invalide.');
  const scheduled = transferType === 'delayed';
  if (req.body.isScheduled !== undefined && req.body.isScheduled !== scheduled) fail(400, 'Planification incohérente.');
  if (!scheduled && cents > 2000000) fail(400, `Le montant maximum pour un virement instantané est de 20 000 ${currency}.`);
  const result = await withLedgerTransaction(req.user.id, async ({ session, balances }) => {
    const client = await ownedClient(clientId, req.user.id, session);
    if (client.status !== 'active') fail(400, 'Ce bénéficiaire est indisponible.');
    requireFunds(balances, currency, cents);
    if (!scheduled) await changeClientBalance(client, cents, session);
    return createOperation({
      userId: req.user.id, clientId, type: 'transfer', amount: -cents / 100,
      currency, adminAccountType: currency.toLowerCase(), adminAccountName, adminAccountIban,
      description: description || '', transferType, transferSpeed: scheduled ? '2-3 days' : 'instant',
      isScheduled: scheduled, status: scheduled ? 'pending' : 'completed',
      balanceAfter: (balances[currency] - cents) / 100
    }, session, client);
  });
  res.status(201).json({ success: true, ...result });
}));

router.put('/:id/status', handle(async (req, res) => {
  requireId(req.params.id);
  const { status } = req.body;
  if (!['completed', 'failed', 'cancelled'].includes(status)) fail(400, 'Statut invalide.');
  const result = await withLedgerTransaction(req.user.id, async ({ session }) => {
    const operation = await Operation.findOne({ _id: req.params.id, userId: req.user.id }).session(session);
    if (!operation) fail(404, 'Opération introuvable.');
    if (operation.status === status) return operation.toObject();
    if (operation.status !== 'pending' || operation.type !== 'transfer') fail(400, 'Seul un virement en attente peut changer de statut.');
    if (status === 'completed') {
      const client = await ownedClient(operation.clientId, req.user.id, session);
      await changeClientBalance(client, Math.abs(Math.round(operation.amount * 100)), session);
      operation.isScheduled = false;
    }
    operation.status = status;
    await operation.save({ session });
    return operation.toObject();
  });
  res.json({ success: true, ...result });
}));

router.delete('/:id', handle(async (req, res) => {
  requireId(req.params.id);
  const result = await withLedgerTransaction(req.user.id, async ({ session, balances }) => {
    const operation = await Operation.findOne({ _id: req.params.id, userId: req.user.id }).session(session);
    if (!operation) fail(404, 'Opération introuvable.');
    if (operation.status === 'completed') {
      const cents = Math.round(operation.amount * 100);
      const currency = parseCurrency(operation.currency);
      if (cents > 0 && balances[currency] < cents) fail(409, 'Ces fonds ont déjà été utilisés et ne peuvent pas être supprimés.');
      if (operation.clientId) {
        const client = await ownedClient(operation.clientId, req.user.id, session);
        await changeClientBalance(client, cents, session);
      }
    }
    await operation.deleteOne({ session });
    return null;
  });
  res.json({ success: true, message: 'Opération supprimée.', ...result });
}));

module.exports = router;
