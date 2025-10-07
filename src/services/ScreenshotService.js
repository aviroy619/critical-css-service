/**
 * ScreenshotService.js
 * 
 * Centralized screenshot capture utility for the Critical CSS Service.
 * Uses BrowserPool for efficient browser instance reuse.
 * Returns structured results (never throws).
 * All logging through LoggerService.
 */

import path from 'node:path';
import fs from 'node:fs';
import browserPool from '../services/BrowserPool.js';
import LoggerService from '../logs/Logger.js';
import config from '../config/config.js';

// Default user agent fallback
const DEFAULT_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36';

/**
 * Validates if a URL is properly formatted
 * @param {string} url - URL to validate
 * @returns {boolean}
 */
function isValidUrl(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.protocol === 'http:' || urlObj.protocol === 'https:';
  } catch (error) {
    return false;
  }
}

/**
 * Ensures directory exists for a file path
 * @param {string} filePath - Full file path
 */
function ensureDirectoryExists(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

class ScreenshotService {
  /**
   * Captures a screenshot of the specified URL
   *
   * @param {string} url - Target webpage URL
   * @param {Object} options - Configuration options
   * @param {number} [options.width=1366] - Viewport width
   * @param {number} [options.height=768] - Viewport height
   * @param {string} [options.userAgent] - Custom user agent (defaults to config)
   * @param {boolean} [options.fullPage=false] - Capture entire scrollable page
   * @param {string} [options.path] - File path to save screenshot (optional)
   * @param {number} [options.timeout=30000] - Navigation timeout in milliseconds
   *
   * @returns {Promise<Object>} Structured result object
   */
  static async captureScreenshot(url, options = {}) {
    // Default options
    const {
      width = 1366,
      height = 768,
      userAgent = config.USER_AGENT ?? DEFAULT_UA,
      fullPage = false,
      path: filePath = null,
      timeout = 30000,
    } = options;

    const startTime = Date.now();

    // Validate URL
    if (!url || !isValidUrl(url)) {
      const error = `Invalid URL provided: ${url}`;
      LoggerService.error('Screenshot capture failed - invalid URL', { url, attemptedAt: new Date().toISOString() });
      return {
        success: false,
        buffer: null,
        path: null,
        error,
        metadata: {
          url,
          attemptedAt: new Date().toISOString(),
        },
      };
    }

    let browser = null;
    let page = null;

    try {
      // Acquire browser from pool
      LoggerService.debug('Acquiring browser from pool for screenshot capture', { url });
      browser = await browserPool.acquire();

      // Create new page
      page = await browser.newPage();

      // Set viewport
      await page.setViewport({ width, height });
      LoggerService.debug(`Viewport set to ${width}x${height}`, { url });

      // Set user agent
      await page.setUserAgent(userAgent);

      // Navigate to URL
      LoggerService.debug(`Navigating to ${url} with timeout ${timeout}ms`);
      await page.goto(url, {
        waitUntil: 'networkidle2',
        timeout
      });

      // Capture screenshot
      const screenshotOptions = {
        fullPage,
        type: 'png',
      };

      let buffer = null;
      let savedPath = null;

      if (filePath) {
        // Save to file
        ensureDirectoryExists(filePath);
        screenshotOptions.path = filePath;
        await page.screenshot(screenshotOptions);
        savedPath = filePath;
        
        // Get file size for metadata
        const stats = fs.statSync(filePath);
        buffer = null; // Don't return buffer when saving to file

        LoggerService.info(`Screenshot saved successfully to file`, {
          url,
          path: filePath,
          size: stats.size,
          dimensions: { width, height },
          fullPage,
          duration: Date.now() - startTime
        });
      } else {
        // Return buffer
        buffer = await page.screenshot(screenshotOptions);

        LoggerService.info(`Screenshot captured successfully to buffer`, {
          url,
          size: buffer.length,
          dimensions: { width, height },
          fullPage,
          duration: Date.now() - startTime
        });
      }

      // Close page
      await page.close();
      LoggerService.debug('Screenshot captured, releasing browser to pool', { url });

      // Return success result
      return {
        success: true,
        buffer,
        path: savedPath,
        error: null,
        metadata: {
          url,
          size: buffer ? buffer.length : (savedPath ? fs.statSync(savedPath).size : 0),
          dimensions: { width, height },
          fullPage,
          timestamp: new Date().toISOString(),
          duration: Date.now() - startTime
        }
      };

    } catch (error) {
      // Log error
      LoggerService.error('Screenshot capture failed', {
        url,
        error: error.message,
        stack: error.stack,
        timeout,
        duration: Date.now() - startTime
      });

      // Close page if it exists
      if (page) {
        try {
          await page.close();
        } catch (closeError) {
          LoggerService.debug('Error closing page after screenshot failure', {
            error: closeError.message
          });
        }
      }

      // Return error result
      return {
        success: false,
        buffer: null,
        path: null,
        error: error.message || 'Unknown error during screenshot capture',
        metadata: {
          url,
          attemptedAt: new Date().toISOString(),
          duration: Date.now() - startTime
        }
      };

    } finally {
      // Always release browser back to pool
      if (browser) {
        try {
          await browserPool.release(browser);
          LoggerService.debug('Browser released back to pool', { url });
        } catch (releaseError) {
          LoggerService.error('Error releasing browser to pool', {
            error: releaseError.message,
            stack: releaseError.stack
          });
        }
      }
    }
  }

  /**
   * Convenience method for capturing full-page screenshots
   *
   * @param {string} url - Target webpage URL
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} Structured result object
   */
  static async captureFullPage(url, options = {}) {
    return this.captureScreenshot(url, { ...options, fullPage: true });
  }

  /**
   * Convenience method for capturing and saving to specific path
   *
   * @param {string} url - Target webpage URL
   * @param {string} filePath - Where to save the screenshot
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} Structured result object
   */
  static async captureAndSave(url, filePath, options = {}) {
    return this.captureScreenshot(url, { ...options, path: filePath });
  }
}

export default ScreenshotService;