const mongoose = require('mongoose');

const operationSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  clientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Client',
    required: false // Allow null for admin deposits
  },
  type: {
    type: String,
    enum: ['deposit', 'withdrawal', 'transfer', 'payment'],
    required: true
  },
  amount: {
    type: Number,
    required: [true, 'Please provide an amount'],
  },
  currency: {
    type: String,
    enum: ['CHF', 'EUR', 'USD'],
    default: 'CHF',
    uppercase: true
  },
  description: {
    type: String,
    trim: true
  },
  reason: {
    type: String,
    trim: true
  },
  recipientAccountNumber: {
    type: String,
    trim: true
  },
  // Informations du compte admin source (pour virements sortants)
  adminAccountType: {
    type: String,
    enum: ['eur', 'chf', 'usd'],
    default: 'eur'
  },
  adminAccountName: {
    type: String,
    trim: true
  },
  adminAccountIban: {
    type: String,
    trim: true
  },
  // Type et vitesse de transfert
  transferType: {
    type: String,
    enum: ['instant', 'delayed'],
    default: 'instant'
  },
  transferSpeed: {
    type: String,
    trim: true
  },
  isScheduled: {
    type: Boolean,
    default: false
  },
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed', 'cancelled'],
    default: 'pending'
  },
  balanceAfter: {
    type: Number
  }
}, {
  timestamps: true
});

// Note: Client balance is now updated directly in the routes/operations.js file
// This hook is disabled to avoid double updates and race conditions
// operationSchema.post('save', async function() { ... });

module.exports = mongoose.model('Operation', operationSchema);

