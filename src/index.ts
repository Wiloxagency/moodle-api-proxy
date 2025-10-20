import app from './app';
import { config, validateEnvironment } from './config/environment';

// Validate environment variables before starting
try {
  validateEnvironment();
  console.log('✅ Environment variables validated successfully');
} catch (error) {
  console.error('❌ Environment validation failed:', error);
  process.exit(1);
}

// Start the server
const server = app.listen(config.port, () => {
  console.log(`🚀 Moodle API Proxy Server is running`);
  console.log(`📡 Port: ${config.port}`);
  console.log(`🌍 Environment: ${config.nodeEnv}`);
  console.log(`🎯 Moodle URL: ${config.moodle.baseUrl}`);
  console.log(`📋 API Documentation: http://localhost:${config.port}/api`);
  console.log(`💚 Health Check: http://localhost:${config.port}/api/health`);
  console.log(`📚 Example endpoint: http://localhost:${config.port}/api/cursos/categoria/57`);
});

// Graceful shutdown handling
const gracefulShutdown = (signal: string) => {
  console.log(`\n🛑 Received ${signal}. Starting graceful shutdown...`);
  
  server.close((err) => {
    if (err) {
      console.error('❌ Error during server shutdown:', err);
      process.exit(1);
    }
    
    console.log('✅ Server closed successfully');
    process.exit(0);
  });
  
  // Force shutdown after 30 seconds
  setTimeout(() => {
    console.error('⚠️  Forced shutdown after timeout');
    process.exit(1);
  }, 30000);
};

// Handle termination signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('💥 Uncaught Exception:', error);
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

export default server;
