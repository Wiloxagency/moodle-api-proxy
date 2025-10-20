import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

export const config = {
  // Server configuration
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  
  // Moodle configuration
  moodle: {
    baseUrl: process.env.MOODLE_BASE_URL || '',
    wsToken: process.env.MOODLE_WS_TOKEN || '',
    webserviceEndpoint: '/webservice/rest/server.php'
  },

  // MongoDB configuration
  mongo: {
    uri: process.env.MONGODB_URI || '',
    dbName: process.env.MONGODB_DB_NAME || 'moodle_dashboard',
    inscripcionesCollection: process.env.MONGODB_INSCRIPCIONES_COLLECTION || 'inscripciones',
    participantesCollection: process.env.MONGODB_PARTICIPANTES_COLLECTION || 'participantes'
  },
  
  // CORS configuration
  cors: {
    allowedOrigins: process.env.ALLOWED_ORIGINS 
      ? process.env.ALLOWED_ORIGINS.split(',') 
      : [
          'http://localhost:3000', 
          'http://localhost:3001', 
          'http://localhost:5173', // Vite dev server
          'http://localhost:5174', // Vite dev server alt
          'http://localhost:4173'  // Vite preview server
        ]
  }
};

// Validate required environment variables
export function validateEnvironment(): void {
  const requiredVars = [
    'MOODLE_BASE_URL',
    'MOODLE_WS_TOKEN',
    'MONGODB_URI'
  ];

  const missing = requiredVars.filter(varName => !process.env[varName]);
  
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}
