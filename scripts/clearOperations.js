const mongoose = require('mongoose');
require('dotenv').config();

// Import du modèle Operation
const Operation = require('../models/Operation');

// Connexion à MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/bank-management')
.then(async () => {
  console.log('✅ Connexion à MongoDB réussie');
  
  try {
    // Supprimer toutes les opérations
    const result = await Operation.deleteMany({});
    console.log(`✅ ${result.deletedCount} opération(s) supprimée(s) avec succès`);
    
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

