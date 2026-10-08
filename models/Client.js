const mongoose = require('mongoose');

const clientSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false
  },
  firstName: {
    type: String,
    required: false,
    trim: true,
    default: ''
  },
  lastName: {
    type: String,
    required: [true, 'Please provide a last name'],
    trim: true
  },
  email: {
    type: String,
    required: false,
    lowercase: true,
    trim: true,
    default: null
  },
  phone: {
    type: String,
    trim: true
  },
  address: {
    street: String,
    city: String,
    postalCode: String,
    country: String
  },
  accountNumber: {
    type: String,
    unique: true,
    required: false,
    default: null
  },
  bankName: {
    type: String,
    required: [true, 'Please provide a bank name'],
    trim: true
  },
  swiftCode: {
    type: String,
    required: [true, 'Please provide a SWIFT code'],
    trim: true,
    uppercase: true
  },
  bankAddress: {
    type: String,
    required: [true, 'Please provide a bank address'],
    trim: true
  },
  balance: {
    type: Number,
    default: 0,
    min: 0
  },
  status: {
    type: String,
    enum: ['active', 'inactive', 'suspended'],
    default: 'active'
  },
  // Keep referenced beneficiaries for ledger history after removal from the list.
  deletedAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

// Generate account number and email before saving (fallback if not set in route)
clientSchema.pre('save', async function(next) {
  // Generate email if not provided
  if (!this.email) {
    const firstName = (this.firstName || '').toLowerCase().replace(/\s+/g, '');
    const lastName = (this.lastName || '').toLowerCase().replace(/\s+/g, '');
    if (firstName) {
      this.email = `${firstName}.${lastName}@beneficiary.local`;
    } else {
      this.email = `${lastName}@beneficiary.local`;
    }
  }
  
  // Generate account number if not provided
  if (!this.accountNumber || this.accountNumber === null) {
    try {
      const timestamp = Date.now().toString().slice(-8);
      const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
      let accountNumber = `ACC${timestamp}${random}`;
      
      // Ensure uniqueness
      let exists = await mongoose.model('Client').findOne({ accountNumber });
      let attempts = 0;
      while (exists && attempts < 10) {
        const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
        accountNumber = `ACC${timestamp}${random}`;
        exists = await mongoose.model('Client').findOne({ accountNumber });
        attempts++;
      }
      
      this.accountNumber = accountNumber;
    } catch (error) {
      // If error, generate a simple one
      this.accountNumber = `ACC${Date.now()}${Math.floor(Math.random() * 1000)}`;
    }
  }
  next();
});

module.exports = mongoose.model('Client', clientSchema);

