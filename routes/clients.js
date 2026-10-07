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
    req.body.userId = req.user.id;
    
    // S'assurer que firstName est défini (vide si non fourni)
    if (req.body.firstName === undefined || req.body.firstName === null) {
      req.body.firstName = '';
    }
    
    // Convertir le code SWIFT en majuscules
    if (req.body.swiftCode) {
      req.body.swiftCode = req.body.swiftCode.toUpperCase().trim();
    }
    
    // Si un numéro de compte est fourni, vérifier qu'il est unique
    if (req.body.accountNumber) {
      const exists = await Client.findOne({ accountNumber: req.body.accountNumber });
      if (exists) {
        return res.status(400).json({
          success: false,
          message: 'Ce numéro de compte existe déjà'
        });
      }
    } else {
      // Generate unique account number if not provided
      let accountNumber;
      let isUnique = false;
      let attempts = 0;
      
      while (!isUnique && attempts < 10) {
        const timestamp = Date.now().toString().slice(-8);
        const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
        accountNumber = `ACC${timestamp}${random}`;
        
        const exists = await Client.findOne({ accountNumber });
        if (!exists) {
          isUnique = true;
        }
        attempts++;
      }
      
      if (!isUnique) {
        // Fallback: use timestamp + userId + random
        const timestamp = Date.now().toString();
        const userId = req.user.id.toString().slice(-4);
        const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
        accountNumber = `ACC${timestamp}${userId}${random}`.slice(0, 20);
      }
      
      req.body.accountNumber = accountNumber;
    }
    
    const client = await Client.create(req.body);
    res.status(201).json({
      success: true,
      data: client
    });
  } catch (error) {
    // Handle duplicate account number error
    if (error.code === 11000 && error.keyPattern?.accountNumber) {
      // Retry with a new account number
      try {
        const timestamp = Date.now().toString();
        const userId = req.user.id.toString().slice(-4);
        const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
        req.body.accountNumber = `ACC${timestamp}${userId}${random}`.slice(0, 20);
        
        const client = await Client.create(req.body);
        return res.status(201).json({
          success: true,
          data: client
        });
      } catch (retryError) {
        return res.status(500).json({
          success: false,
          message: 'Error creating client. Please try again.'
        });
      }
    }
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// @route   PUT /api/clients/:id
// @desc    Update a client
// @access  Private
router.put('/:id', async (req, res) => {
  try {
    let client = await Client.findOne({ 
      _id: req.params.id
    });

    if (!client) {
      return res.status(404).json({
        success: false,
        message: 'Client not found'
      });
    }

    // Don't allow updating accountNumber or balance directly
    delete req.body.accountNumber;
    delete req.body.balance;

    client = await Client.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true
    });

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

