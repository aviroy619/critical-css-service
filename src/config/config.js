// src/config/config.js
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

/**
 * Central configuration module
 * Loads environment variables and provides defaults
 */

const config = {
  // Server configuration
  PORT: parseInt(process.env.PORT, 10) || 3010,

  // MongoDB configuration
  mongo: {
    uri: process.env.MONGO_URI,
    db: process.env.MONGO_DB,
  },

  // Logging configuration
  logLevel: process.env.LOG_LEVEL || 'info',

  // Puppeteer configuration
  puppeteer: {
    timeout: parseInt(process.env.PUPPETEER_TIMEOUT, 10) || 120000, // 2 minutes default
    headless: process.env.PUPPETEER_HEADLESS === 'false'
      ? false
      : process.env.PUPPETEER_HEADLESS || 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  },

  // User Agent string
  userAgent: process.env.USER_AGENT || 
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',

  // Environment
  env: process.env.NODE_ENV || 'development',
  isDevelopment: process.env.NODE_ENV !== 'production',
  isProduction: process.env.NODE_ENV === 'production',
};

/**
 * Validate critical configuration values
 */
function validateConfig() {
  const errors = [];

  if (!config.mongo.uri) {
    errors.push('MONGO_URI is required');
  }

  if (!config.mongo.db) {
    errors.push('MONGO_DB is required');
  }

  if (config.puppeteer.timeout < 1000) {
    errors.push('PUPPETEER_TIMEOUT must be at least 1000ms');
  }

  if (errors.length > 0) {
    throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
  }
}

// Run validation on module load
validateConfig();

export default config;