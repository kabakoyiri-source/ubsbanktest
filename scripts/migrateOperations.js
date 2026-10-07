const mongoose = require('mongoose')
const Operation = require('../models/Operation')

async function migrate() {
  try {
    // Connexion à la base de données
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/ubs')
    
    console.log('Début de la migration des opérations...')
    
    // Mettre à jour toutes les opérations sans isScheduled
    const result = await Operation.updateMany(
      { isScheduled: { $exists: false } },
      { 
        $set: { 
          isScheduled: false,
          transferType: 'instant',
          status: 'completed'
        }
      }
    )
    
    console.log(`Migration terminée: ${result.modifiedCount} opérations mises à jour`)
    
    // Vérifier les opérations mises à jour
    const updatedOps = await Operation.find({
      isScheduled: false,
      transferType: 'instant',
      status: 'completed'
    }).limit(5)
    
    console.log('Exemple d\'opérations mises à jour:')
    updatedOps.forEach(op => {
      console.log(`- ID: ${op._id}, Type: ${op.type}, isScheduled: ${op.isScheduled}, transferType: ${op.transferType}, Status: ${op.status}`)
    })
    
    process.exit(0)
  } catch (error) {
    console.error('Erreur lors de la migration:', error)
    process.exit(1)
  }
}

migrate()
