// src/services/BrowserPool.js

import puppeteer from 'puppeteer';
import LoggerService from '../logs/Logger.js';

/**
 * BrowserPool
 * 
 * Manages a pool of Puppeteer browser instances for efficient reuse.
 * Reduces overhead of launching new browsers for each CSS generation request.
 * 
 * Features:
 * - Configurable pool size
 * - Automatic browser health checks
 * - Graceful cleanup on shutdown
 * - Request queuing when pool is full
 */
class BrowserPool {
  constructor(options = {}) {
    this.logger = LoggerService;
    
    // Pool configuration
    this.maxPoolSize = options.maxPoolSize || 3;
    this.minPoolSize = options.minPoolSize || 1;
    this.idleTimeout = options.idleTimeout || 300000; // 5 minutes
    this.launchTimeout = options.launchTimeout || 30000; // 30 seconds
    this.gracePeriod = options.gracePeriod || parseInt(process.env.BROWSERPOOL_GRACE_PERIOD || '10000');
    
    // Pool state
    this.availableBrowsers = [];
    this.busyBrowsers = new Set();
    this.waitingQueue = [];
    this.isShuttingDown = false;
    this.idleTimeouts = new Map(); // Track timeout IDs for each browser
    
    // Statistics
    this.stats = {
      created: 0,
      reused: 0,
      destroyed: 0,
      errors: 0
    };
    
    // Browser launch options with improved stability flags
    this.launchOptions = {
      headless: 'new',
      args: [
         "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--window-size=1920,1080",
    "--single-process",
    "--no-zygote",
    "--disable-infobars",
    "--disable-web-security",
    "--ignore-certificate-errors",
    "--disable-features=IsolateOrigins,site-per-process",
    "--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118 Safari/537.36"
      ],
      timeout: this.launchTimeout,
      ignoreHTTPSErrors: true,
      ...options.launchOptions
    };

    // Periodic cleanup of idle browsers
    this.cleanupInterval = setInterval(() => this.cleanupIdleBrowsers(), 10000);

    this.logger.info(`BrowserPool: Initialized with min=${this.minPoolSize}, max=${this.maxPoolSize}`);
  }

  /**
   * Initialize the browser pool with minimum number of browsers
   */
  async initialize() {
    this.logger.info('BrowserPool: Initializing pool...');
    
    try {
      // Pre-warm the pool with minimum browsers
      const initPromises = [];
      for (let i = 0; i < this.minPoolSize; i++) {
        initPromises.push(this._createBrowser());
      }
      
      await Promise.all(initPromises);
      this.logger.info(`BrowserPool: Successfully initialized with ${this.availableBrowsers.length} browsers`);
    } catch (error) {
      this.logger.error(`BrowserPool: Error during initialization: ${error.message}`);
      throw error;
    }
  }

  /**
   * Acquire a browser from the pool
   * 
   * @returns {Promise<Object>} Browser instance
   */
  async acquire() {
    if (this.isShuttingDown) {
      throw new Error('BrowserPool is shutting down, cannot acquire new browser');
    }

    // Try to get an available browser
    if (this.availableBrowsers.length > 0) {
      const browser = this.availableBrowsers.pop();
      
      // Clear any pending idle timeout for this browser
      if (this.idleTimeouts.has(browser)) {
        clearTimeout(this.idleTimeouts.get(browser));
        this.idleTimeouts.delete(browser);
      }
      
      // Validate existing browser before reusing
      if (browser && !browser.isConnected()) {
        this.logger.warn('BrowserPool: Browser from pool was disconnected. Relaunching...');
        try {
          await browser.close();
        } catch (_) {
          // Ignore close errors for already disconnected browsers
        }
        // Retry acquisition
        return this.acquire();
      }
      
      // Verify browser is still connected
      if (browser.isConnected()) {
        this.busyBrowsers.add(browser);
        this.stats.reused++;
        this.logger.debug('BrowserPool: Browser acquired (reused)', {
          busy: this.busyBrowsers.size,
          available: this.availableBrowsers.length
        });
        return browser;
      } else {
        // Browser disconnected, destroy and immediately retry
        this.logger.warn('BrowserPool: Found disconnected browser, destroying and retrying...');
        await this._destroyBrowser(browser);
        return this.acquire(); // Recursive retry
      }
    }

    // Create new browser if under max pool size
    if (this.busyBrowsers.size + this.availableBrowsers.length < this.maxPoolSize) {
      try {
        const browser = await this._createBrowser();
        this.busyBrowsers.add(browser);
        this.logger.debug('BrowserPool: Browser acquired (new)', {
          busy: this.busyBrowsers.size,
          available: this.availableBrowsers.length
        });
        return browser;
      } catch (err) {
        this.logger.error(`BrowserPool: Failed to create browser: ${err.message}`);
        throw new Error(`BrowserPool: Unable to create new browser instance - ${err.message}`);
      }
    }

    // Pool is full, wait for a browser to be released
    this.logger.debug('BrowserPool: Pool full, waiting for available browser...');
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        const index = this.waitingQueue.findIndex(item => item.resolve === resolve);
        if (index !== -1) {
          this.waitingQueue.splice(index, 1);
        }
        reject(new Error('Timeout waiting for browser from pool'));
      }, this.launchTimeout);

      this.waitingQueue.push({ resolve, reject, timeoutId });
    });
  }

  /**
   * Release a browser back to the pool
   * 
   * @param {Object} browser - Browser instance to release
   */
  async release(browser) {
    if (!browser) {
      this.logger.warn('BrowserPool: Attempted to release null browser');
      return;
    }

    // Remove from busy set first
    this.busyBrowsers.delete(browser);

    // If browser crashed while in use, don't return it to pool
    if (!browser.isConnected()) {
      this.logger.warn('BrowserPool: Released browser was disconnected. Not returning to pool.');
      try {
        await browser.close();
      } catch (_) {
        // Ignore close errors for already disconnected browsers
      }
      return;
    }

    // Atomic handoff to queued waiters - ensures thread safety
    if (this.waitingQueue.length > 0) {
      const { resolve, reject, timeoutId } = this.waitingQueue.shift();
      clearTimeout(timeoutId);
      
      // Verify browser is still connected before handing off
      if (browser.isConnected()) {
        this.busyBrowsers.add(browser);
        resolve(browser);
        this.logger.debug('BrowserPool: Browser immediately reassigned to waiting request', {
          busy: this.busyBrowsers.size,
          waiting: this.waitingQueue.length
        });
      } else {
        // Browser disconnected during handoff - requeue the waiter instead of rejecting
        this.logger.warn('BrowserPool: Released browser was disconnected during handoff, requeueing waiter');
        await this._destroyBrowser(browser);
        this.waitingQueue.unshift({ resolve, reject, timeoutId }); // Put back at front of queue
        
        // Try to create a new browser for the requeued waiter
        try {
          const newBrowser = await this._createBrowser();
          const nextWaiter = this.waitingQueue.shift();
          if (nextWaiter) {
            clearTimeout(nextWaiter.timeoutId);
            this.busyBrowsers.add(newBrowser);
            nextWaiter.resolve(newBrowser);
          }
        } catch (err) {
          // If we can't create a browser, the waiter will timeout naturally
          this.logger.error('BrowserPool: Failed to create replacement browser for requeued waiter');
        }
      }
      return;
    }

    // No waiters - return to available pool
    this.availableBrowsers.push(browser);
    this.logger.debug('BrowserPool: Browser released to pool', {
      busy: this.busyBrowsers.size,
      available: this.availableBrowsers.length
    });
    
    // Schedule idle timeout
    this._scheduleIdleCheck(browser);
  }

  /**
   * Create a new browser instance
   * 
   * @private
   * @returns {Promise<Object>} Browser instance
   */
  async _createBrowser() {
    try {
      this.logger.debug('BrowserPool: Creating new browser...');
      
      // Allow headless mode override via environment or options
      const headlessMode = process.env.PUPPETEER_HEADLESS || this.launchOptions.headless || 'new';
      
      const browser = await puppeteer.launch({
        ...this.launchOptions,
        headless: headlessMode
      });
      
      this.stats.created++;
      this.logger.debug(`BrowserPool: Browser created successfully (total created: ${this.stats.created})`, {
        busy: this.busyBrowsers.size,
        available: this.availableBrowsers.length
      });
      
      return browser;
    } catch (error) {
      this.stats.errors++;
      this.logger.error(`BrowserPool: Failed to create browser: ${error.message}`);
      throw error;
    }
  }

  /**
   * Destroy a browser instance
   * 
   * @private
   * @param {Object} browser - Browser to destroy
   */
  async _destroyBrowser(browser) {
    try {
      if (browser && browser.isConnected()) {
        await browser.close();
      }
      this.stats.destroyed++;
      this.logger.debug(`BrowserPool: Browser destroyed (total destroyed: ${this.stats.destroyed})`);
    } catch (error) {
      this.logger.error(`BrowserPool: Error destroying browser: ${error.message}`);
    }
  }

  /**
   * Schedule idle timeout check for a browser
   * 
   * @private
   * @param {Object} browser - Browser to check
   */
  _scheduleIdleCheck(browser) {
    setTimeout(() => {
      // If browser is still available (not reused) and we have more than minimum, destroy it
      const index = this.availableBrowsers.indexOf(browser);
      if (index !== -1 && this.availableBrowsers.length > this.minPoolSize) {
        this.availableBrowsers.splice(index, 1);
        this._destroyBrowser(browser);
        this.logger.debug('BrowserPool: Idle browser destroyed to reduce pool size');
      }
    }, this.idleTimeout);
  }

  /**
   * Cleanup idle browsers that exceed minimum pool size
   */
  cleanupIdleBrowsers() {
    if (this.isShuttingDown) return;

    while (this.availableBrowsers.length > this.minPoolSize) {
      const browser = this.availableBrowsers.pop();
      this._destroyBrowser(browser);
      this.logger.debug('BrowserPool: Cleaned up idle browser');
    }
  }

  /**
   * Get current pool statistics
   * 
   * @returns {Object} Pool statistics
   */
  getStats() {
    return {
      ...this.stats,
      available: this.availableBrowsers.length,
      busy: this.busyBrowsers.size,
      waiting: this.waitingQueue.length,
      total: this.availableBrowsers.length + this.busyBrowsers.size
    };
  }

  /**
   * Shutdown the browser pool gracefully
   * 
   * @param {Object} options - Shutdown options
   * @param {number} [options.gracePeriod] - Grace period in ms for busy browsers to finish
   * @param {Function} [options.onGracePeriodStart] - Callback when grace period starts
   */
  async shutdown(options = {}) {
    this.logger.info('BrowserPool: Shutting down...');
    this.isShuttingDown = true;

    // Clear cleanup interval
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    // Reject all waiting requests
    while (this.waitingQueue.length > 0) {
      const { reject, timeoutId } = this.waitingQueue.shift();
      clearTimeout(timeoutId);
      reject(new Error('BrowserPool is shutting down'));
    }
    this.logger.debug(`BrowserPool: Rejected ${this.waitingQueue.length} waiting requests`);

    // Allow busy browsers a grace period to finish
    const gracePeriod = options.gracePeriod || this.gracePeriod;
    const busyCount = this.busyBrowsers.size;
    
    if (busyCount > 0) {
      this.logger.info(`BrowserPool: Waiting up to ${gracePeriod}ms for ${busyCount} busy browser(s) to finish...`);
      
      // Optional callback when grace period starts
      if (options.onGracePeriodStart) {
        try {
          await options.onGracePeriodStart(busyCount, gracePeriod);
        } catch (err) {
          this.logger.error(`BrowserPool: Error in onGracePeriodStart callback: ${err.message}`);
        }
      }
      
      await new Promise((resolve) => setTimeout(resolve, gracePeriod));
    }

    // Destroy all browsers
    const allBrowsers = [...this.availableBrowsers, ...this.busyBrowsers];
    const closePromises = allBrowsers.map(browser => this._destroyBrowser(browser));

    // Force close any remaining busy browsers after grace period
    if (this.busyBrowsers.size > 0) {
      this.logger.warn(`BrowserPool: Force closing ${this.busyBrowsers.size} busy browser(s) after grace period`);
    }

    await Promise.allSettled(closePromises);
    
    this.availableBrowsers = [];
    this.busyBrowsers.clear();
    
    this.logger.info('BrowserPool: Shutdown complete');
    this.logger.info(`BrowserPool: Final stats - ${JSON.stringify(this.getStats())}`);
  }
}

// Singleton instance
let poolInstance = null;

/**
 * Exported API
 * - getPool(): Returns the singleton pool instance (creates if needed)
 * - shutdownPool(): Gracefully closes and resets pool
 * - defaultPool: The singleton pool instance (ready to use)
 */

export const getPool = (options) => {
  if (!poolInstance) {
    poolInstance = new BrowserPool(options);
  }
  return poolInstance;
};

export const shutdownPool = async () => {
  if (poolInstance) {
    await poolInstance.shutdown();
    poolInstance = null;
  }
};

// Default export is always the singleton instance
// Services can import as: import browserPool from './BrowserPool.js'
// Then use directly: browserPool.acquire(), browserPool.release(), etc.
export const defaultPool = getPool();
export default defaultPool;