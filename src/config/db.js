// src/config/db.js
import mongoose from 'mongoose';
import config from './config.js';

/**
 * Connect to MongoDB using configuration from config.js
 * @returns {Promise<void>}
 */
export async function connectDB() {
  try {
    // Connection options
    const options = {
      dbName: config.mongo.db,
      // Mongoose 6+ defaults (these are optional but explicit)
      useNewUrlParser: true,
      useUnifiedTopology: true,
    };

    // Connect to MongoDB
    await mongoose.connect(config.mongo.uri, options);

    // Success message
    console.log(`✅ MongoDB connected to DB: ${config.mongo.db}`);

    // Optional: Log connection host in development
    if (config.isDevelopment) {
      console.log(`   Host: ${mongoose.connection.host}`);
    }

    // Handle connection events
    mongoose.connection.on('error', (err) => {
      console.error('❌ MongoDB connection error:', err);
    });

    mongoose.connection.on('disconnected', () => {
      console.warn('⚠️  MongoDB disconnected');
    });

    // Graceful shutdown
    process.on('SIGINT', async () => {
      await mongoose.connection.close();
      console.log('🔌 MongoDB connection closed due to app termination');
      process.exit(0);
    });

  } catch (error) {
    // Log the error with details
    console.error('❌ MongoDB connection failed:');
    console.error(`   Error: ${error.message}`);
    
    // Log stack trace in development
    if (config.isDevelopment) {
      console.error(error.stack);
    }

    // Exit process with failure code (only in production to avoid killing test runners)
    if (config.isProduction) {
      process.exit(1);
    } else {
      // In development/test, throw the error to let the caller handle it
      throw error;
    }
  }
}

/**
 * Disconnect from MongoDB
 * @returns {Promise<void>}
 */
export async function disconnectDB() {
  try {
    await mongoose.connection.close();
    console.log('🔌 MongoDB connection closed');
  } catch (error) {
    console.error('❌ Error closing MongoDB connection:', error.message);
    throw error;
  }
}