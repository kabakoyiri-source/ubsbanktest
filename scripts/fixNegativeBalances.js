const mongoose = require('mongoose');
require('dotenv').config();
const Client = require('../models/Client');

mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/bank-management')
  .then(async () => {
    console.log('✅ Connexion à MongoDB réussie');
    try {
      // Corriger tous les clients avec un solde négatif
      const result = await Client.updateMany(
        { balance: { $lt: 0 } },
        { $set: { balance: 0 } }
      );
      
      console.log(`✅ ${result.modifiedCount} client(s) avec solde négatif corrigé(s)`);
      
      // Afficher les clients corrigés
      const correctedClients = await Client.find({ balance: 0 });
      console.log(`✅ Total de clients avec solde à 0: ${correctedClients.length}`);
      
      await mongoose.connection.close();
      console.log('✅ Connexion fermée');
      process.exit(0);
    } catch (error) {
      console.error('❌ Erreur lors de la correction:', error.message);
      await mongoose.connection.close();
      process.exit(1);
    }
  })
  .catch(err => {
    console.error('❌ Erreur de connexion MongoDB:', err.message);
    process.exit(1);
  });
