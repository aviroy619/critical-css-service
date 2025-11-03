// src/services/CSSProcessor.js
//
import { generate } from 'critical';
import LoggerService from '../logs/Logger.js';
import { getPool } from '../services/BrowserPool.js';

class CSSProcessor {
  constructor() {
    this.logger = LoggerService.child({ service: 'CSSProcessor' });
    this.browserPool = getPool();
  }

  async generateCriticalCSS(config) {
    const startTime = Date.now();
    let criticalCss = '';
    let partial = false;

    try {
      if (!this.isValidUrl(config.url)) {
        return {
          css: '',
          metadata: { success: false, error: 'Invalid URL', url: config.url },
          error: 'Invalid URL',
        };
      }

      const viewportsToProcess = [
        { width: 360, height: 800 },
        { width: 1366, height: 768 },
        { width: 1920, height: 1080 },
      ];

      // Process each viewport with a fresh browser instance
      for (const viewport of viewportsToProcess) {
        let browser = null;
        try {
          this.logger.debug(`Generating critical CSS for ${config.url} at ${viewport.width}x${viewport.height}`);
          
          // Acquire fresh browser for each viewport to prevent memory issues
          browser = await this.browserPool.acquire();
          
          const result = await generate({
            src: config.url,
            width: viewport.width,
            height: viewport.height,
            inline: false,
            rebase: false,
            penthouse: {
              puppeteer: { getBrowser: () => browser },
            },
          });

          if (result && result.css) {
            const mediaQuery = this.getMediaQueryForViewport(viewport);
            criticalCss += mediaQuery
              ? `@media ${mediaQuery} { ${result.css} }`
              : result.css;
          }
          
          this.logger.debug(`Successfully generated CSS for viewport ${viewport.width}x${viewport.height}`);
          
        } catch (vpErr) {
          this.logger.warn(`Failed to generate critical CSS for viewport ${viewport.width}x${viewport.height}`, { error: vpErr.message });
          partial = true;
        } finally {
          // Always release browser after each viewport to free memory
          if (browser) {
            await this.browserPool.release(browser);
          }
        }
      }

      // Minify concatenated CSS
      if (criticalCss && typeof criticalCss === 'string') {
        // collapse whitespace and remove comments
        criticalCss = criticalCss
          .replace(/\/\*[\s\S]*?\*\//g, '') // strip CSS comments
          .replace(/\s+/g, ' ')
          .trim();
      }

      const duration = Date.now() - startTime;

     // If at least some CSS was collected, return what we have even if partial
if (criticalCss && criticalCss.length > 0) {
  return {
    css: criticalCss,
    metadata: {
      success: !partial,
      partial,
      duration,
      viewports: viewportsToProcess.length,
      url: config.url,
      size: criticalCss.length,
    },
    error: partial ? 'Partial viewport CSS generated' : null,
  };
}

// If absolutely nothing was generated, then fail
return {
  css: '',
  metadata: {
    success: false,
    duration,
    viewports: viewportsToProcess.length,
    url: config.url,
    warning: 'empty',
    partial,
  },
  error: partial
    ? 'Generated nothing (some viewports failed)'
    : 'No critical CSS generated for any viewport',
};


      return {
        css: criticalCss,
        metadata: {
          success: true,
          duration,
          viewports: viewportsToProcess.length,
          url: config.url,
          size: criticalCss.length,
          partial,
        },
        error: null,
      };
    } catch (err) {
      this.logger.error(`Critical CSS generation failed for ${config.url}`, { error: err.message });
      return {
        css: '',
        metadata: { success: false, duration: Date.now() - startTime, url: config.url },
        error: `Critical CSS generation failed: ${err.message}`,
      };
    }
  }

  getMediaQueryForViewport(viewport) {
    if (viewport.width <= 480) return 'only screen and (max-width: 480px)';
    if (viewport.width <= 768) return 'only screen and (max-width: 768px)';
    if (viewport.width <= 1366) return 'only screen and (max-width: 1366px)';
    return null;
  }

  isValidUrl(url) {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }
}

export default CSSProcessor;