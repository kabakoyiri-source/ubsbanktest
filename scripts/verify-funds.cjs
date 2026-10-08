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

    // Public beneficiary creation normalizes bank details and ignores protected fields.
    const recipient = { firstName: ' Test ', lastName: ' Recipient ', bankName: ' Test bank ', accountNumber: 'ch55 0023 5235 8890 1234 5', swiftCode: 'test bank', bankAddress: ' Test address ', userId: user.id, balance: 999999, status: 'suspended' };
    const created = await request('/clients', recipient, 'POST', other);
    assert.equal(created.status, 201);
    assert.equal(created.data.userId, other.id);
    assert.equal(created.data.balance, 0);
    assert.equal(created.data.status, 'active');
    assert.equal(created.data.firstName, 'Test');
    assert.equal(created.data.accountNumber, 'CH5500235235889012345');
    assert.equal(created.data.swiftCode, 'TESTBANK');
    assert.equal((await request('/clients', recipient, 'POST', other)).status, 409);
    assert.equal(await Client.countDocuments({ userId: other._id }), 2, 'Duplicate IBAN must never be replaced by a generated account');
    for (const missing of ['lastName', 'bankName', 'accountNumber', 'swiftCode', 'bankAddress']) {
      assert.equal((await request('/clients', { ...recipient, [missing]: '  ' }, 'POST', other)).status, 400);
    }
    assert.equal((await request('/clients/' + created.data._id, { lastName: 'Changed by another user' }, 'PUT')).status, 404);
    assert.equal((await request('/clients/' + created.data._id, undefined, 'DELETE')).status, 404);
    assert.equal((await Client.findById(created.data._id)).deletedAt, null, 'Another account cannot remove a beneficiary');
    const edited = await request('/clients/' + created.data._id, { lastName: 'Edited', userId: user.id, balance: 100, accountNumber: 'OTHER' }, 'PUT', other);
    assert.equal(edited.status, 200);
    assert.equal(edited.data.userId, other.id);
    assert.equal(edited.data.balance, 0);
    assert.equal(edited.data.accountNumber, created.data.accountNumber);

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

    // Removing a used recipient must retain the ledger and existing reservations.
    const waiting = await transfer(3, { transferType: 'delayed', isScheduled: true });
    assert.equal(waiting.status, 201);
    const beforeRemoval = await balances(user);
    const recipientBalance = (await Client.findById(client.id)).balance;
    const operationCount = await Operation.countDocuments({ userId: user._id });
    assert.equal((await request('/clients/' + client.id, undefined, 'DELETE')).status, 200);
    assert.equal((await request('/clients/' + client.id, undefined, 'DELETE')).status, 200, 'Repeated removal is harmless');
    assert.equal((await request('/clients', undefined, 'GET')).data.length, 0);
    assert.equal((await request('/clients/' + client.id, undefined, 'GET')).status, 404);
    assert.equal((await request('/clients/' + client.id, { status: 'active', deletedAt: null }, 'PUT')).status, 404);
    assert.equal((await transfer(1)).status, 404, 'Removed recipients cannot receive new transfers');
    assert.equal((await request('/operations', { clientId: client.id, type: 'deposit', currency: 'CHF', amount: 1 })).status, 404);
    assert.deepEqual(await balances(user), beforeRemoval, 'Removing a recipient must not change account balances');
    assert.equal((await Client.findById(client.id)).balance, recipientBalance);
    assert.equal(await Operation.countDocuments({ userId: user._id }), operationCount);
    const history = await request('/operations/history/' + client.id, undefined, 'GET');
    assert.equal(history.status, 200);
    assert(history.data.every(operation => operation.clientId?._id === client.id && operation.clientId.lastName === client.lastName), 'History must retain the beneficiary identity');
    assert.equal(history.data.find(operation => operation._id === waiting.data._id).status, 'pending');
    assert.equal((await request('/operations/' + waiting.data._id + '/status', { status: 'completed' }, 'PUT')).status, 200);
    assert.equal((await Client.findById(client.id)).balance, recipientBalance + 3, 'Previously scheduled transfers still work');
    assert.equal((await request('/operations/' + waiting.data._id, undefined, 'DELETE')).status, 200, 'Reversing a past transfer still works after recipient removal');
    assert.equal((await Client.findById(client.id)).balance, recipientBalance);
    const restored = await request('/clients', { firstName: '', lastName: client.lastName, bankName: client.bankName, bankAddress: client.bankAddress, swiftCode: client.swiftCode, accountNumber: client.accountNumber, balance: 99999 });
    assert.equal(restored.status, 201);
    assert.equal(restored.data._id, client.id, 'Re-adding the same IBAN must preserve its history');
    assert.equal(restored.data.balance, recipientBalance);
    assert.equal(restored.data.deletedAt, null);
    assert.equal((await request('/clients', undefined, 'GET')).data.length, 1);

    // A removal racing with a transfer is serialized with the account ledger.
    const racingClient = await makeClient(user, 'Concurrent removal');
    const racing = await Promise.all([
      transfer(1, { clientId: racingClient.id }),
      request('/clients/' + racingClient.id, undefined, 'DELETE'),
    ]);
    assert.equal(racing[1].status, 200);
    assert([201, 404].includes(racing[0].status));
    assert((await Client.findById(racingClient.id)).deletedAt);
    assert(!(await request('/clients', undefined, 'GET')).data.some(item => item._id === racingClient.id));
    assert.equal((await Client.findById(racingClient.id)).balance, racing[0].status === 201 ? 1 : 0);
    const uiUser = await User.create({ firstName: 'Mobile', lastName: 'Test', email: 'mobile@example.test', password: 'local-test-password' });
    const uiClientId = await require('../../frontend/scripts/verify-funds-ui.cjs').verifyFundsUi(base.replace(/\/api$/, ''), token(uiUser));
    assert.deepEqual(await balances(uiUser), { CHF: 7525, EUR: 2000, USD: 0 });
    assert.equal((await Client.findById(uiClientId)).balance, 25.25);
    assert((await Client.findById(uiClientId)).deletedAt, 'UI removal must persist in the database');
    assert.equal((await request('/clients', undefined, 'GET', uiUser)).data.length, 0);
    assert.equal(await Client.countDocuments({ userId: uiUser._id }), 1);
    console.log('PASS: persisted funds and transfers, isolation, reservations, concurrent mutations, rollback, beneficiary removal, preserved history, scheduled-transfer processing and re-adding the same IBAN on a temporary MongoDB replica set.');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await mongoose.disconnect();
    await db.stop();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
