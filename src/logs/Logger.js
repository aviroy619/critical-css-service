/**
 * Logger.js
 * 
 * Centralized logging service for the Critical CSS Service.
 * Provides consistent, structured logging across all modules.
 * 
 * Features:
 * - JSON-formatted logs with timestamps
 * - Log levels: INFO, ERROR, WARN, DEBUG with filtering
 * - Metadata support for contextual information
 * - DEBUG mode controlled by environment variable
 * - Easy integration with external log aggregation services
 */

import fs from "fs";
import path from "path";

class LoggerService {
  /**
   * Initialize logger configuration
   */
  static init() {
    this.logLevel = (process.env.LOG_LEVEL || 'info').toLowerCase();
    this.logToFile = process.env.LOG_TO_FILE === 'true';
    this.logFilePath = process.env.LOG_FILE_PATH || path.join(process.cwd(), 'app.log');

    // Numeric level mapping for filtering
    this.levels = { error: 0, warn: 1, info: 2, debug: 3 };
    
    // Ensure log directory exists
    if (this.logToFile) {
      const logDir = path.dirname(this.logFilePath);
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }
    }
  }

  /**
   * Format log message with timestamp and metadata
   * 
   * @param {string} level - Log level (INFO, ERROR, WARN, DEBUG)
   * @param {string} msg - Log message
   * @param {Object} meta - Additional metadata to include
   * @returns {string} Formatted JSON log string
   */
  static format(level, msg, meta = {}) {
    return JSON.stringify({
      timestamp: new Date().toISOString(),
      level: level.toLowerCase(),
      message: msg,
      ...meta,
    });
  }

  /**
   * Format log message for console output (human-readable)
   * 
   * @param {string} level - Log level
   * @param {string} msg - Log message
   * @param {Object} meta - Additional metadata
   * @returns {string} Formatted console-friendly string
   */
  static formatConsole(level, msg, meta = {}) {
    const timestamp = new Date().toISOString();
    const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
    return `[${timestamp}] [${level}] ${msg}${metaStr}`;
  }

  /**
   * Write log to file if enabled (async for better performance)
   * 
   * @param {string} formattedLog - Formatted log string
   */
  static writeToFile(formattedLog) {
    if (this.logToFile) {
      try {
        // Use async write for better performance in high-volume scenarios
        fs.appendFile(this.logFilePath, formattedLog + '\n', 'utf8', (err) => {
          if (err) {
            console.error('Failed to write to log file:', err.message);
          }
        });
      } catch (error) {
        console.error('Failed to write to log file:', error.message);
      }
    }
  }

  /**
   * Log informational messages
   * Use for: successful operations, status updates, general info
   * 
   * @param {string} msg - Log message
   * @param {Object} meta - Additional metadata
   * 
   * @example
   * LoggerService.info('Server started', { port: 3000 });
   * LoggerService.info('Critical CSS generated', { shop: 'store.myshopify.com', size: 1024 });
   */
  static info(msg, meta = {}) {
    if (this.levels[this.logLevel] >= this.levels.info) {
      const json = this.format('INFO', msg, meta);
      console.log(this.formatConsole('INFO', msg, meta));
      this.writeToFile(json);
    }
  }

  /**
   * Log error messages
   * Use for: exceptions, failures, critical issues
   * 
   * @param {string} msg - Error message
   * @param {Object} meta - Additional metadata (should include error details)
   * 
   * @example
   * LoggerService.error('Database connection failed', { error: err.message, stack: err.stack });
   * LoggerService.error('CSS generation failed', { shop, template, error: err.message });
   */
  static error(msg, meta = {}) {
    if (this.levels[this.logLevel] >= this.levels.error) {
      const json = this.format('ERROR', msg, meta);
      console.error(this.formatConsole('ERROR', msg, meta));
      this.writeToFile(json);
    }
  }

  /**
   * Log warning messages
   * Use for: recoverable issues, deprecations, potential problems
   * 
   * @param {string} msg - Warning message
   * @param {Object} meta - Additional metadata
   * 
   * @example
   * LoggerService.warn('Browser pool nearing max size', { current: 8, max: 10 });
   * LoggerService.warn('CSS size exceeds recommendation', { size: 150000, recommended: 100000 });
   */
  static warn(msg, meta = {}) {
    if (this.levels[this.logLevel] >= this.levels.warn) {
      const json = this.format('WARN', msg, meta);
      console.warn(this.formatConsole('WARN', msg, meta));
      this.writeToFile(json);
    }
  }

  /**
   * Log debug messages (when LOG_LEVEL=debug)
   * Use for: detailed flow tracking, variable inspection, troubleshooting
   * 
   * @param {string} msg - Debug message
   * @param {Object} meta - Additional metadata
   * 
   * @example
   * LoggerService.debug('Acquiring browser from pool', { poolSize: 5 });
   * LoggerService.debug('Navigating to URL', { url: 'https://example.com', timeout: 30000 });
   */
  static debug(msg, meta = {}) {
    if (this.levels[this.logLevel] >= this.levels.debug) {
      const json = this.format('DEBUG', msg, meta);
      console.debug(this.formatConsole('DEBUG', msg, meta));
      this.writeToFile(json);
    }
  }

  /**
   * Log with custom level
   * Allows for future extensibility
   * Note: Custom levels bypass log level filtering
   * 
   * @param {string} level - Custom log level
   * @param {string} msg - Log message
   * @param {Object} meta - Additional metadata
   */
  static log(level, msg, meta = {}) {
    const normalizedLevel = level.toLowerCase();
    
    // If it's a known level, apply filtering
    if (this.levels[normalizedLevel] !== undefined) {
      if (this.levels[this.logLevel] >= this.levels[normalizedLevel]) {
        const json = this.format(level.toUpperCase(), msg, meta);
        console.log(this.formatConsole(level.toUpperCase(), msg, meta));
        this.writeToFile(json);
      }
    } else {
      // Unknown/custom levels always log (for extensibility)
      const json = this.format(level.toUpperCase(), msg, meta);
      console.log(this.formatConsole(level.toUpperCase(), msg, meta));
      this.writeToFile(json);
    }
  }

  /**
   * Create a child logger with default metadata
   * Useful for module-specific logging
   * 
   * @param {Object} defaultMeta - Default metadata to include in all logs
   * @returns {Object} Child logger instance
   * 
   * @example
   * const cssLogger = LoggerService.child({ service: 'CSSProcessor' });
   * cssLogger.info('Processing started'); // Automatically includes { service: 'CSSProcessor' }
   */
  static child(defaultMeta = {}) {
    return {
      info: (msg, meta = {}) => this.info(msg, { ...defaultMeta, ...meta }),
      error: (msg, meta = {}) => this.error(msg, { ...defaultMeta, ...meta }),
      warn: (msg, meta = {}) => this.warn(msg, { ...defaultMeta, ...meta }),
      debug: (msg, meta = {}) => this.debug(msg, { ...defaultMeta, ...meta }),
      log: (level, msg, meta = {}) => this.log(level, msg, { ...defaultMeta, ...meta })
    };
  }

  /**
   * Get current logger configuration
   * 
   * @returns {Object} Current configuration
   */
  static getConfig() {
    return {
      logLevel: this.logLevel,
      logToFile: this.logToFile,
      logFilePath: this.logFilePath
    };
  }

  /**
   * Rotate log file (for manual rotation or cron jobs)
   * Renames current log file with timestamp
   * 
   * Note: For automatic rotation in production, consider:
   * - Setting up a cron job to call this method
   * - Using external logrotate on the server
   * - Implementing a size-based rotation trigger
   */
  static rotateLogFile() {
    if (!this.logToFile || !fs.existsSync(this.logFilePath)) {
      return;
    }

    try {
      const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
      const rotatedPath = this.logFilePath.replace('.log', `-${timestamp}.log`);
      
      // Rename the current log file
      fs.renameSync(this.logFilePath, rotatedPath);
      
      // Log rotation message (this will create a new log file)
      this.info('Log file rotated', { 
        from: this.logFilePath, 
        to: rotatedPath 
      });
    } catch (error) {
      this.error('Failed to rotate log file', { error: error.message });
    }
  }
}

LoggerService.init();
export default LoggerService;