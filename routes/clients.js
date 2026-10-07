const express = require('express');
const Client = require('../models/Client');
const { protect } = require('../middleware/auth');

const router = express.Router();

// All routes require authentication
router.use(protect);

// @route   GET /api/clients
// @desc    Get all clients for the logged-in user
// @access  Private
router.get('/', async (req, res) => {
  try {
    const clients = await Client.find({ userId: req.user.id }).sort({ createdAt: -1 });
    res.json({
      success: true,
      count: clients.length,
      data: clients
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// @route   GET /api/clients/:id
// @desc    Get a single client
// @access  Private
router.get('/:id', async (req, res) => {
  try {
    const client = await Client.findOne({ 
      _id: req.params.id, 
      userId: req.user.id 
    });

    if (!client) {
      return res.status(404).json({
        success: false,
        message: 'Client not found'
      });
    }

    res.json({
      success: true,
      data: client
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// @route   POST /api/clients
// @desc    Create a new client
// @access  Private
router.post('/', async (req, res) => {
  try {
    const fields = ['firstName', 'lastName', 'bankName', 'accountNumber', 'swiftCode', 'bankAddress'];
    const payload = Object.fromEntries(fields.map(field => [field, typeof req.body[field] === 'string' ? req.body[field].trim() : '']));
    if (fields.filter(field => field !== 'firstName').some(field => !payload[field])) {
      return res.status(400).json({ success: false, message: 'Complétez le nom et les coordonnées bancaires du bénéficiaire.' });
    }
    payload.accountNumber = payload.accountNumber.replace(/\s+/g, '').toUpperCase();
    payload.swiftCode = payload.swiftCode.replace(/\s+/g, '').toUpperCase();
    if (!payload.accountNumber || !payload.swiftCode) {
      return res.status(400).json({ success: false, message: 'Renseignez l’IBAN et le code SWIFT du bénéficiaire.' });
    }
    // Beneficiaries belong to the authenticated user; funds come from the ledger.
    const client = await Client.create({ ...payload, userId: req.user.id, balance: 0, status: 'active' });
    res.status(201).json({
      success: true,
      data: client
    });
  } catch (error) {
    if (error.code === 11000 && error.keyPattern?.accountNumber) {
      return res.status(409).json({ success: false, message: 'Ce numéro de compte est déjà enregistré. Vérifiez l’IBAN ou sélectionnez le bénéficiaire existant.' });
    }
    res.status(error.name === 'ValidationError' ? 400 : 500).json({
      success: false,
      message: 'Impossible de créer le bénéficiaire. Vérifiez les informations et réessayez.'
    });
  }
});

// @route   PUT /api/clients/:id
// @desc    Update a client
// @access  Private
router.put('/:id', async (req, res) => {
  try {
    const updates = {};
    for (const field of ['firstName', 'lastName', 'email', 'phone', 'address', 'bankName', 'swiftCode', 'bankAddress', 'status']) {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) updates[field] = req.body[field];
    }
    const client = await Client.findOneAndUpdate({ _id: req.params.id, userId: req.user.id }, { $set: updates }, { new: true, runValidators: true });

    if (!client) {
      return res.status(404).json({
        success: false,
        message: 'Client not found'
      });
    }

    res.json({
      success: true,
      data: client
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// @route   DELETE /api/clients/:id
// @desc    Delete a client
// @access  Private
router.delete('/:id', async (req, res) => {
  try {
    const client = await Client.findOne({ 
      _id: req.params.id, 
      userId: req.user.id 
    });

    if (!client) {
      return res.status(404).json({
        success: false,
        message: 'Client not found'
      });
    }

    await Client.findByIdAndDelete(req.params.id);

    res.json({
      success: true,
      message: 'Client deleted successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

module.exports = router;

