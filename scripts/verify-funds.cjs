const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const User = require('../models/User');
const Client = require('../models/Client');
const Operation = require('../models/Operation');
const { calculateBalances } = require('../services/ledger');

async function main() {
  const db = await MongoMemoryReplSet.create({ replSet: { count: 1 }, binary: { downloadDir: path.resolve(__dirname, '../.mongo-test-cache') } });
  let server;
  try {
    await mongoose.connect(db.getUri(), { dbName: 'funds_tests' });
    await User.init(); await Client.init(); await Operation.init();
    const user = await User.create({ firstName: 'Test', lastName: 'Funds', email: 'funds@example.test', password: 'local-test-password' });
    const other = await User.create({ firstName: 'Other', lastName: 'User', email: 'other@example.test', password: 'local-test-password' });
    const makeClient = (owner, lastName) => Client.create({ userId: owner._id, lastName, bankName: 'Test bank', swiftCode: 'TESTBANK', bankAddress: 'Test address' });
    const client = await makeClient(user, 'Beneficiary');
    const otherClient = await makeClient(other, 'Other beneficiary');
    const app = express();
    app.use(express.json());
    app.use('/api/operations', require('../routes/operations'));
    app.use('/api/clients', require('../routes/clients'));
    app.get('/api/auth/me', require('../middleware/auth').protect, (req, res) => res.json({ success: true, user: req.user }));
    const frontend = path.resolve(__dirname, '../../frontend/dist');
    app.use(express.static(frontend));
    app.get('*', (req, res) => res.sendFile(path.join(frontend, 'index.html')));
    server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
    const base = 'http://127.0.0.1:' + server.address().port + '/api';
    const token = owner => jwt.sign({ id: owner.id }, process.env.JWT_SECRET || 'your-secret-key-change-this-in-production');
    const request = async (url, body, method = 'POST', owner = user) => {
      const response = await fetch(base + url, { method, headers: { Authorization: 'Bearer ' + token(owner), 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { status: response.status, ...await response.json() };
    };
    const balances = async owner => calculateBalances(await Operation.find({ userId: owner._id }).lean());
    const transfer = (amount, extra = {}) => request('/operations/transfer', { clientId: client.id, adminAccountType: 'chf', currency: 'CHF', amount, transferType: 'instant', isScheduled: false, ...extra });
    assert.equal((await fetch(base + '/operations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'deposit', amount: 100 }) })).status, 401);
    assert.equal((await transfer(10)).status, 400);
    assert.equal((await Client.findById(client.id)).balance, 0);
    for (const amount of [0, -1, '12junk', 'Infinity', true, 1.001]) assert.equal((await request('/operations', { type: 'deposit', amount, currency: 'CHF' })).status, 400);
    assert.equal((await request('/operations', { type: 'deposit', amount: 10, currency: 'GBP' })).status, 400);
    const deposit = await request('/operations', { type: 'deposit', amount: '100,50', currency: 'CHF' });
    assert.equal(deposit.status, 201);
    assert.equal(deposit.balances.CHF, 100.5);
    assert.equal((await transfer(25.25)).status, 201);
    assert.equal((await balances(user)).CHF, 7525);
    assert.equal((await Client.findById(client.id)).balance, 25.25);
    assert.equal((await transfer(100)).status, 400);
    assert.equal((await transfer(1, { clientId: otherClient.id })).status, 404);
    assert.equal((await transfer(1, { currency: 'EUR' })).status, 400);
    assert.equal((await request('/operations', { type: 'deposit', amount: 1000, currency: 'CHF' }, 'POST', other)).status, 201);
    const list = await request('/operations?admin=true', undefined, 'GET');
    assert(list.data.every(operation => operation.userId === user.id));
    const clients = await request('/clients', undefined, 'GET');
    assert.equal(clients.data.length, 1);

    const reserved = await transfer(50, { transferType: 'delayed', isScheduled: true });
    assert.equal(reserved.status, 201);
    assert.equal(reserved.balances.CHF, 25.25);
    assert.equal((await Client.findById(client.id)).balance, 25.25);
    assert.equal((await transfer(30)).status, 400);
    assert.equal((await request('/operations/' + reserved.data._id + '/status', { status: 'cancelled' }, 'PUT')).balances.CHF, 75.25);
    assert.equal((await request('/operations/' + deposit.data._id, undefined, 'DELETE')).status, 409, 'Spent funds cannot be removed');

    // Two simultaneous transfers cannot both consume the same available funds.
    const concurrent = await Promise.all([transfer(50), transfer(50)]);
    assert.deepEqual(concurrent.map(response => response.status).sort(), [201, 400]);
    assert.equal((await balances(user)).CHF, 2525);
    assert.equal((await Client.findById(client.id)).balance, 75.25);

    // A failure while writing the ledger must roll back the beneficiary credit.
    const originalCreate = Operation.create;
    Operation.create = async () => { throw new Error('Simulated ledger failure'); };
    try { assert.equal((await transfer(5)).status, 500); }
    finally { Operation.create = originalCreate; }
    assert.equal((await balances(user)).CHF, 2525);
    assert.equal((await Client.findById(client.id)).balance, 75.25);

    assert.equal((await request('/operations', { type: 'deposit', amount: 10.1, currency: 'EUR' })).status, 201);
    assert.equal((await transfer(5.05, { adminAccountType: 'eur', currency: 'EUR' })).status, 201);
    assert.equal((await balances(user)).EUR, 505);
    assert.equal((await balances(user)).CHF, 2525);
    const completed = await transfer(5, { transferType: 'delayed', isScheduled: true });
    assert.equal(completed.status, 201);
    const before = (await Client.findById(client.id)).balance;
    const endpoint = '/operations/' + completed.data._id + '/status';
    assert.equal((await request(endpoint, { status: 'completed' }, 'PUT')).status, 200);
    assert.equal((await request(endpoint, { status: 'completed' }, 'PUT')).status, 200);
    assert.equal((await Client.findById(client.id)).balance, before + 5);
    const stored = await User.findById(user.id);
    assert.equal(stored.balances.CHF, (await balances(user)).CHF / 100);
    const uiUser = await User.create({ firstName: 'Mobile', lastName: 'Test', email: 'mobile@example.test', password: 'local-test-password' });
    const uiClient = await makeClient(uiUser, 'Mobile beneficiary');
    await require('../../frontend/scripts/verify-funds-ui.cjs').verifyFundsUi(base.replace(/\/api$/, ''), token(uiUser), uiClient.id);
    assert.deepEqual(await balances(uiUser), { CHF: 7525, EUR: 2000, USD: 0 });
    assert.equal((await Client.findById(uiClient.id)).balance, 25.25);
    console.log('PASS: persisted deposits and transfers, currency isolation, insufficient funds, user isolation, pending reservations, concurrent transfers, rollback and repeat completion on a temporary MongoDB replica set.');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await mongoose.disconnect();
    await db.stop();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
