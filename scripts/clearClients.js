const mongoose = require('mongoose');
require('dotenv').config();

// Import du modèle Client
const Client = require('../models/Client');

// Connexion à MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/bank-management')
.then(async () => {
  console.log('✅ Connexion à MongoDB réussie');
  
  try {
    // Supprimer tous les bénéficiaires
    const result = await Client.deleteMany({});
    console.log(`✅ ${result.deletedCount} bénéficiaire(s) supprimé(s) avec succès`);
    
    // Fermer la connexion
    await mongoose.connection.close();
    console.log('✅ Connexion fermée');
    process.exit(0);
  } catch (error) {
    console.error('❌ Erreur lors de la suppression:', error.message);
    await mongoose.connection.close();
    process.exit(1);
  }
})
.catch(err => {
  console.error('❌ Erreur de connexion MongoDB:', err.message);
  process.exit(1);
});

