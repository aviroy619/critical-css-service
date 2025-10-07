/**
 * app.js
 * 
 * Main entrypoint for the Critical CSS Service.
 * 
 * Responsibilities:
 * - Initialize Express application
 * - Connect to MongoDB
 * - Mount middleware and routes
 * - Start HTTP server
 * - Handle graceful shutdown
 */

import express from 'express';
import { connectDB, disconnectDB } from './config/db.js';
import criticalCssRoutes from './routes/criticalCssRoutes.js';
import LoggerService from './logs/Logger.js';
import { defaultPool as BrowserPool } from './services/BrowserPool.js';
import config from './config/config.js';
import shopifyRoutes from './routes/shopifyRoutes.js';

// ============================================================================
// EXPRESS APP INITIALIZATION
// ============================================================================

const app = express();

// ============================================================================
// MIDDLEWARE
// ============================================================================

// Parse JSON request bodies
app.use(express.json());

// Parse URL-encoded form data
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  
  // Log after response is sent
  res.on('finish', () => {
    const duration = Date.now() - start;
    LoggerService.info('HTTP Request', {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip
    });
  });
  
  next();
});

// ============================================================================
// HEALTH CHECK ENDPOINT
// ============================================================================

/**
 * GET /health
 * Service health check endpoint
 * 
 * Returns server status, uptime, and timestamp
 */
app.get('/health', (req, res) => {
  res.json({
    ok: true,
    service: 'critical-css-service',
    version: '1.1.0',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    memory: {
      used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
      unit: 'MB'
    }
  });
});

// ============================================================================
// API ROUTES
// ============================================================================

/**
 * Mount Critical CSS routes at /api/critical-css
 * All routes defined in criticalCssRoutes.js are accessible here
 */
app.use('/api/critical-css', criticalCssRoutes);

// ============================================================================
// 404 HANDLER
// ============================================================================

app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Cannot ${req.method} ${req.path}`,
    timestamp: new Date().toISOString()
  });
});

// ============================================================================
// ERROR HANDLER
// ============================================================================

app.use((err, req, res, next) => {
  LoggerService.error('Unhandled error in request', {
    error: err.message,
    stack: err.stack,
    method: req.method,
    path: req.path
  });

  res.status(err.status || 500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'production' 
      ? 'An unexpected error occurred' 
      : err.message,
    timestamp: new Date().toISOString()
  });
});
// Mount Shopify integration routes
app.use('/api/shopify', shopifyRoutes);

// ============================================================================
// SERVER STARTUP
// ============================================================================

const PORT = config.PORT || 3000;
let server;

/**
 * Start the application server
 * 1. Connect to MongoDB
 * 2. Start Express server
 * 3. Log successful startup
 */
async function start() {
  try {
    // Connect to MongoDB
    LoggerService.info('Connecting to MongoDB...');
    await connectDB();
    LoggerService.info('MongoDB connected successfully');

    // Start HTTP server
    server = app.listen(PORT, () => {
      LoggerService.info(`🚀 Critical CSS Service started`, {
        port: PORT,
        environment: process.env.NODE_ENV || 'development',
        nodeVersion: process.version,
        pid: process.pid
      });
      
      LoggerService.info(`📍 API available at http://localhost:${PORT}/api/critical-css`);
      LoggerService.info(`💚 Health check at http://localhost:${PORT}/health`);
    });

    // Handle server errors
    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        LoggerService.error(`Port ${PORT} is already in use`);
      } else {
        LoggerService.error('Server error', { error: error.message, stack: error.stack });
      }
      process.exit(1);
    });

  } catch (error) {
    LoggerService.error('Failed to start application', {
      error: error.message,
      stack: error.stack
    });
    process.exit(1);
  }
}

// ============================================================================
// GRACEFUL SHUTDOWN
// ============================================================================

/**
 * Graceful shutdown handler
 * Ensures clean cleanup of resources before exit:
 * 1. Stop accepting new connections
 * 2. Close MongoDB connection
 * 3. Shutdown browser pool
 * 4. Exit process
 */
async function shutdown(signal) {
  LoggerService.info(`Received ${signal}. Starting graceful shutdown...`);

  // Stop accepting new connections
  if (server) {
    await new Promise((resolve) =>
      server.close(() => {
        LoggerService.info('HTTP server closed');
        resolve();
      })
    );
  }

  try {
    // Close MongoDB connection
    LoggerService.info('Closing MongoDB connection...');
    await disconnectDB();
    LoggerService.info('MongoDB connection closed');

    // Shutdown browser pool
    LoggerService.info('Shutting down browser pool...');
    await BrowserPool.shutdown();
    LoggerService.info('Browser pool shut down');

    LoggerService.info('Graceful shutdown complete');
    process.exit(0);

  } catch (error) {
    LoggerService.error('Error during shutdown', {
      error: error.message,
      stack: error.stack
    });
    process.exit(1);
  }
}

// Handle shutdown signals
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  LoggerService.error('Uncaught Exception', {
    error: error.message,
    stack: error.stack
  });
  shutdown('uncaughtException');
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  LoggerService.error('Unhandled Promise Rejection', {
    reason: reason,
    promise: promise
  });
  shutdown('unhandledRejection');
});

// ============================================================================
// START APPLICATION
// ============================================================================

start();

// Export app for testing
export default app;