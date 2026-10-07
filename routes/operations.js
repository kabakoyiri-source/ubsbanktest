const express = require('express');
const Operation = require('../models/Operation');
const Client = require('../models/Client');
const { protect } = require('../middleware/auth');

const router = express.Router();

// All routes require authentication
router.use(protect);

// @route   GET /api/operations
// @desc    Get all operations for the logged-in user or all operations if admin=true
// @access  Private
router.get('/', async (req, res) => {
  try {
    const { clientId, type, status, startDate, endDate, admin } = req.query;
    
    // Si admin=true, charger toutes les opérations (pour le dashboard admin)
    let query = admin === 'true' ? {} : { userId: req.user.id };

    if (clientId) query.clientId = clientId;
    if (type) query.type = type;
    if (status) query.status = status;
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const operations = await Operation.find(query)
      .populate('clientId', 'firstName lastName bankName accountNumber')
      .sort({ createdAt: -1 });

    // Debug: vérifier que les données sont bien populées
    console.log('Operations with populated client:', operations.map(op => ({
      id: op._id,
      type: op.type,
      hasClient: !!op.clientId,
      clientBankName: op.clientId?.bankName,
      clientAccountNumber: op.clientId?.accountNumber
    })));

    res.json({
      success: true,
      count: operations.length,
      data: operations
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// @route   GET /api/operations/:id
// @desc    Get a single operation
// @access  Private
router.get('/:id', async (req, res) => {
  try {
    const operation = await Operation.findOne({ 
      _id: req.params.id, 
      userId: req.user.id 
    }).populate('clientId', 'firstName lastName bankName accountNumber');

    if (!operation) {
      return res.status(404).json({
        success: false,
        message: 'Operation not found'
      });
    }

    res.json({
      success: true,
      data: operation
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// @route   POST /api/operations
// @desc    Create a new operation
// @access  Private
router.post('/', async (req, res) => {
  try {
    const { clientId, type, amount, description, reason, recipientAccountNumber, adminAccountId } = req.body;

    console.log('Received operation data:', { clientId, type, amount, adminAccountId, fullBody: req.body }); // Debug
    console.log('Type of amount:', typeof amount, 'Value:', amount);

    // Convertir amount en nombre si c'est une chaîne
    const numericAmount = typeof amount === 'string' ? parseFloat(amount) : amount;

    if (!type || !numericAmount || isNaN(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid type and amount (amount must be a positive number)'
      });
    }

    // For admin deposits (type === 'deposit' without clientId), skip client validation
    let client = null;
    if (clientId) {
      // Verify client belongs to user
      client = await Client.findOne({ 
        _id: clientId
      });

      if (!client) {
        return res.status(404).json({
          success: false,
          message: 'Bénéficiaire not found'
        });
      }
      
      console.log(`Client found: ${client._id}, current balance: ${client.balance}, operation type: ${type}, amount: ${numericAmount}`);
    } else if (type !== 'deposit') {
      // clientId is required for non-deposit operations
      return res.status(400).json({
        success: false,
        message: 'Please provide clientId for this operation type'
      });
    }

    // For admin deposits (no clientId), only create the operation without updating client balance
    if (!clientId && type === 'deposit') {
      console.log('Creating admin deposit with simple operation, amount:', numericAmount);
      try {
        const currency = (req.body.currency || 'CHF').toUpperCase();

        // Create operation for admin deposit
        const operation = await Operation.create({
          userId: req.user.id,
          clientId: null,
          type: 'deposit',
          amount: numericAmount,
          currency: currency,
          description: description || 'Rechargement de solde',
          status: 'completed',
          balanceAfter: 0 // On ne maintient plus de solde cumulé ici, ce sera calculé au front
        });

        console.log('Admin deposit created:', operation._id);

        const populatedOperation = await Operation.findById(operation._id)
          .populate('clientId', 'firstName lastName bankName accountNumber');

        return res.status(201).json({
          success: true,
          message: 'Dépôt effectué avec succès',
          data: populatedOperation
        });
      } catch (createError) {
        console.error('Error creating admin deposit operation:', createError);
        return res.status(400).json({
          success: false,
          message: createError.message || 'Erreur lors de la création de l\'opération'
        });
      }
    }

    // Vérifier d'abord que le client n'a pas déjà un solde négatif
    let balanceBefore = client.balance || 0;
    if (balanceBefore < 0) {
      console.error(`ERROR: Client ${client._id} already has negative balance: ${balanceBefore}`);
      // Corriger le solde à 0 avant de continuer
      balanceBefore = 0;
      client.balance = 0;
      await client.save();
      console.log(`Client balance corrected to 0`);
    }

    // Calculate balance after operation for client operations
    let balanceAfter = balanceBefore;
    
    if (type === 'deposit') {
      // Deposit to client account - CREDIT
      balanceAfter = balanceBefore + numericAmount;
    } else if (type === 'transfer') {
      // For transfers, always credit the beneficiary (client) - money is being sent TO them - CREDIT
      balanceAfter = balanceBefore + numericAmount;
    } else if (type === 'withdrawal' || type === 'payment') {
      // For withdrawals and payments, debit the client - DEBIT
      balanceAfter = balanceBefore - numericAmount;
    } else {
      // Unknown type - should not happen
      return res.status(400).json({
        success: false,
        message: `Type d'opération invalide: ${type}`
      });
    }
    
    // Round to 2 decimal places to avoid floating point issues
    balanceAfter = Math.round(balanceAfter * 100) / 100;

    console.log(`[BALANCE CALC] Client: ${client._id}, Type: ${type}, Before: ${balanceBefore}, Amount: ${numericAmount}, After: ${balanceAfter}`);

    // PROTÉGER LE SOLDE CLIENT - Validation STRICTE AVANT toute sauvegarde
    if (balanceAfter < 0) {
      console.error(`[ERROR] Balance would become negative: ${balanceAfter} (balanceBefore: ${balanceBefore}, type: ${type}, amount: ${numericAmount})`);
      return res.status(400).json({
        success: false,
        message: `Solde insuffisant pour effectuer cette opération. Solde actuel: ${balanceBefore.toFixed(2)} CHF, Montant: ${numericAmount.toFixed(2)} CHF`
      });
    }

    // Double vérification avec une marge de sécurité (arrondi)
    if (Math.round(balanceAfter * 100) < 0) {
      console.error(`[ERROR] Balance calculation error (after rounding): ${balanceAfter}`);
      return res.status(400).json({
        success: false,
        message: `Erreur de calcul: le solde ne peut pas être négatif`
      });
    }

    // --- CALCUL DU MONTANT POUR L'ADMIN ---
    // Si c'est un dépôt vers un client (ou transfert), le montant est NÉGATIF pour l'admin
    const adminAmount = (type === 'deposit' || type === 'transfer') ? -numericAmount : numericAmount;
    // ----------------------------------------

    // Update client balance BEFORE creating operation to avoid hook conflicts
    console.log(`[SAVE] Updating client balance: ${balanceBefore} -> ${balanceAfter} (operation type: ${type}, amount: ${numericAmount})`);
    
    try {
      // S'assurer que le solde est bien positif avant de sauvegarder
      if (balanceAfter < 0) {
        throw new Error(`Balance cannot be negative: ${balanceAfter}`);
      }
      
      client.balance = balanceAfter;
      await client.save({ validateBeforeSave: true });
      console.log(`✅ Client balance updated successfully: ${client.balance}`);
    } catch (saveError) {
      console.error(`[ERROR] Saving client balance failed:`, saveError.message || saveError);
      
      // Si l'erreur est due à un solde négatif (validation Mongoose)
      if (saveError.message && (saveError.message.includes('less than minimum') || saveError.message.includes('negative'))) {
        // Ne pas créer l'opération si le solde est négatif
        return res.status(400).json({
          success: false,
          message: `Erreur: Le solde ne peut pas être négatif (${balanceAfter.toFixed(2)} CHF). Opération annulée. Solde actuel: ${balanceBefore.toFixed(2)} CHF`
        });
      }
      
      // Autre erreur - propager
      throw saveError;
    }

    const operation = await Operation.create({
      userId: req.user.id,
      clientId,
      type,
      amount: adminAmount, // Utiliser le montant avec le bon signe pour l'admin
      currency: lowerCurrency.toUpperCase(),
      description,
      reason,
      recipientAccountNumber,
      status: 'completed',
      balanceAfter: 0 // Plus utilisé, calcul dynamique au front
    });

    const populatedOperation = await Operation.findById(operation._id)
      .populate('clientId', 'bankName accountNumber');

    res.status(201).json({
      success: true,
      data: populatedOperation
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// @route   PUT /api/operations/:id/status
// @desc    Update operation status
// @access  Private
router.put('/:id/status', async (req, res) => {
  try {
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a status'
      });
    }

    const operation = await Operation.findOne({ 
      _id: req.params.id, 
      userId: req.user.id 
    });

    if (!operation) {
      return res.status(404).json({
        success: false,
        message: 'Operation not found'
      });
    }

    operation.status = status;
    await operation.save();

    const populatedOperation = await Operation.findById(operation._id)
      .populate('clientId', 'bankName accountNumber');

    res.json({
      success: true,
      data: populatedOperation
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// @route   GET /api/operations/history/:clientId
// @desc    Get operation history for a specific client
// @access  Private
router.get('/history/:clientId', async (req, res) => {
  try {
    // Verify client belongs to user
    const client = await Client.findOne({ 
      _id: req.params.clientId, 
      userId: req.user.id 
    });

    if (!client) {
      return res.status(404).json({
        success: false,
        message: 'Bénéficiaire not found'
      });
    }

    const operations = await Operation.find({ 
      clientId: req.params.clientId,
      userId: req.user.id 
    })
      .populate('clientId', 'bankName accountNumber')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      count: operations.length,
      data: operations
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// @route   POST /api/operations/transfer
// @desc    Create a new transfer operation with scheduling support
// @access  Private
router.post('/transfer', async (req, res) => {
  try {
    const {
      clientId,
      adminAccountId,
      adminAccountType,
      adminAccountName,
      adminAccountIban,
      type,
      amount,
      description,
      transferType,
      transferSpeed,
      isScheduled
    } = req.body;

    console.log('Creating transfer with data:', {
      clientId,
      adminAccountType,
      adminAccountName,
      type,
      amount,
      transferType,
      transferSpeed,
      isScheduled
    });

    // Validation
    if (!clientId || !adminAccountType || !amount) {
      return res.status(400).json({
        success: false,
        message: 'Veuillez fournir toutes les informations requises'
      });
    }

    const numericAmount = parseFloat(amount);
    if (isNaN(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Montant invalide'
      });
    }

    const client = await Client.findOne({ _id: clientId, userId: req.user.id });
    if (!client) {
      return res.status(404).json({ success: false, message: 'Bénéficiaire non trouvé' });
    }

    const lowerCurrency = (req.body.currency || 'CHF').toLowerCase();
    const scheduled = !!isScheduled;

    // Si virement non planifié: créditer le bénéficiaire
    if (!scheduled) {
      client.balance = (client.balance || 0) + numericAmount;
      await client.save();
    }

    // Create operation with all fields
    const operation = await Operation.create({
      userId: req.user.id,
      clientId,
      adminAccountId,
      adminAccountType,
      adminAccountName,
      adminAccountIban,
      type: type || 'transfer',
      amount: -numericAmount, // Montant négatif pour déduction automatique
      currency: lowerCurrency.toUpperCase(),
      description: description || '',
      transferType: transferType || 'instant',
      transferSpeed: transferSpeed || 'instant',
      isScheduled: scheduled,
      status: scheduled ? 'pending' : 'completed',
      balanceAfter: 0
    });

    console.log('Transfer operation created (Negative amount):', operation._id);

    const populatedOperation = await Operation.findById(operation._id)
      .populate('clientId', 'firstName lastName bankName accountNumber');

    res.status(201).json({
      success: true,
      data: populatedOperation
    });
  } catch (error) {
    console.error('Error creating transfer operation:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// @route   DELETE /api/operations/:id
// @desc    Delete an operation
// @access  Private
router.delete('/:id', async (req, res) => {
  try {
    const { admin } = req.query;
    
    // Si admin=true, permettre de supprimer n'importe quelle opération
    let query = { _id: req.params.id };
    if (admin !== 'true') {
      query.userId = req.user.id;
    }
    
    const operation = await Operation.findOne(query);
    
    if (!operation) {
      return res.status(404).json({
        success: false,
        message: 'Operation not found'
      });
    }

    await Operation.findByIdAndDelete(req.params.id);

    res.json({
      success: true,
      message: 'Operation deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting operation:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

module.exports = router;

