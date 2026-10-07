const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

// Refresh trigger for scheduled operations update
const app = express();

// Middleware CORS - Configuration pour production et développement
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:3002',
  /\.vercel\.app$/,
  /\.loca\.lt$/, // Tous les domaines localtunnel
  /\.ngrok\.io$/ // Tous les domaines ngrok
];

app.use(cors({
  origin: function (origin, callback) {
    // Permettre les requêtes sans origin (comme les apps mobiles ou curl)
    if (!origin) return callback(null, true);
    
    // Vérifier si l'origin est autorisée
    const isAllowed = allowedOrigins.some(allowedOrigin => {
      if (typeof allowedOrigin === 'string') {
        return origin === allowedOrigin;
      }
      if (allowedOrigin instanceof RegExp) {
        return allowedOrigin.test(origin);
      }
      return false;
    });
    
    if (isAllowed) {
      callback(null, true);
    } else {
      console.log('CORS blocked origin:', origin);
      callback(null, true); // En production, on autorise quand même pour le moment
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'ngrok-skip-browser-warning', 'bypass-tunnel-reminder'],
  exposedHeaders: ['Content-Length', 'X-JSON'],
  maxAge: 86400 // 24 heures
}));

// Options preflight pour toutes les routes
app.options('*', cors());

app.use(express.json());

// Restore req.url from req.originalUrl for Vercel rewrites
app.use((req, res, next) => {
  if (req.originalUrl && req.url !== req.originalUrl) {
    req.url = req.originalUrl;
  }
  next();
});

// Middleware to ensure DB connection
app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (error) {
    console.error('Database connection failed:', error);
    res.status(503).json({
      success: false,
      message: 'Database connection failed. Please try again later.',
      details: {
        error: error.message,
        hasMongoUri: !!process.env.MONGODB_URI
      }
    });
  }
});

// Root route - redirect to /api/auth
app.get('/', (req, res) => {
  res.redirect('/api/auth');
});

// Health check route
app.get('/health', (req, res) => {
  res.json({
    success: true,
    status: 'OK',
    timestamp: new Date().toISOString(),
    database: isConnected ? 'Connected' : 'Disconnected'
  });
});

app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    status: 'OK',
    timestamp: new Date().toISOString(),
    database: isConnected ? 'Connected' : 'Disconnected'
  });
});

// Initialize database and demo account
app.get('/api/init', async (req, res) => {
  try {
    await connectDB();
    await createDemoAccount();
    res.json({
      success: true,
      message: 'Database initialized successfully',
      demoAccount: {
        email: 'demo@bank.com',
        password: 'demo123'
      }
    });
  } catch (error) {
    console.error('Initialization error:', error);
    res.status(500).json({
      success: false,
      message: 'Initialization failed: ' + error.message
    });
  }
});

// Routes (compatible with both /api/xxx and /xxx)
app.use('/api/auth', require('./routes/auth'));
app.use('/auth', require('./routes/auth'));
app.use('/api/clients', require('./routes/clients'));
app.use('/clients', require('./routes/clients'));
app.use('/api/operations', require('./routes/operations'));
app.use('/operations', require('./routes/operations'));

// Connect to MongoDB
let isConnected = false;

const connectDB = async () => {
  if (mongoose.connection.readyState === 1) {
    isConnected = true;
    return;
  }

  const primaryUri = process.env.MONGODB_URI;
  const localFallbackUri = 'mongodb://localhost:27017/bank-management';

  if (primaryUri) {
    try {
      console.log('Connecting to MongoDB...');
      await mongoose.connect(primaryUri, {
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
      });
      isConnected = true;
      console.log('✅ MongoDB Connected');
      await createDemoAccount();
      return;
    } catch (err) {
      console.warn('⚠️ MongoDB Atlas connection error:', err.message);
      if (primaryUri !== localFallbackUri) {
        console.log('🔄 Attempting fallback to local MongoDB (localhost:27017)...');
        try {
          await mongoose.connect(localFallbackUri, {
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 45000,
          });
          isConnected = true;
          console.log('✅ Connected to local MongoDB fallback');
          await createDemoAccount();
          return;
        } catch (fallbackErr) {
          console.error('Local MongoDB connection error:', fallbackErr.message);
        }
      }
      throw err;
    }
  } else {
    await mongoose.connect(localFallbackUri, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
    isConnected = true;
    console.log('✅ Connected to local MongoDB');
    await createDemoAccount();
  }
};

// Initialize connection (only for persistent environments)
if (!process.env.VERCEL) {
  connectDB().catch(err => console.error('Initial DB connection failed:', err));
}

// Create demo account
async function createDemoAccount() {
  try {
    const User = require('./models/User');
    const demoEmail = 'demo@bank.com';
    const demoPassword = 'demo123';
    
    const existingUser = await User.findOne({ email: demoEmail });
    if (!existingUser) {
      const demoUser = await User.create({
        email: demoEmail,
        password: demoPassword,
        firstName: 'Demo',
        lastName: 'User',
        role: 'admin'
      });
      console.log('✅ Compte démo créé avec succès!');
      console.log('📧 Email: demo@bank.com');
      console.log('🔑 Mot de passe: demo123');
    } else {
      console.log('ℹ️  Compte démo existe déjà');
      console.log('📧 Email: demo@bank.com');
      console.log('🔑 Mot de passe: demo123');
    }
  } catch (error) {
    console.error('Erreur lors de la création du compte démo:', error.message);
  }
}

const PORT = process.env.PORT || 3000;
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

module.exports = app;

