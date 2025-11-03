// src/services/CSSProcessor.js

import puppeteer from 'puppeteer';
import postcss from 'postcss';
import safeParser from 'postcss-safe-parser';
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

    const successfulViewports = [];
    const failedViewports = [];

    if (!this.isValidUrl(config.url)) {
      const duration = Date.now() - startTime;
      this.logger.warn(`❌ Invalid URL provided`, { url: config.url });
      return {
        css: '',
        metadata: {
          success: false,
          partial: false,
          duration,
          url: config.url,
          viewportsTested: 0,
          successfulViewports: [],
          failedViewports: []
        },
        error: 'Invalid URL'
      };
    }

    try {
      const viewports = [
        { width: 360, height: 800 },      // mobile
        { width: 1366, height: 768 }      // desktop
      ];

      for (const vp of viewports) {
        let browser = null;
        let page = null;

        try {
          this.logger.info(`🎯 Generating critical CSS @ ${vp.width}x${vp.height}`);

          browser = await this.browserPool.acquire();
          page = await browser.newPage();

          // Set viewport
          await page.setViewport({
            width: vp.width,
            height: vp.height
          });

          // Enable CSS coverage
          await page.coverage.startCSSCoverage();

          // Navigate to page
          await page.goto(config.url, {
            waitUntil: 'networkidle0',
            timeout: 60000
          });

          // Wait a bit for any dynamic content
          await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 1000)));

          // Get CSS coverage
          const cssCoverage = await page.coverage.stopCSSCoverage();

          // Extract used CSS
          let viewportCss = '';
          
          for (const entry of cssCoverage) {
            if (!entry.url) continue;
            
            const css = entry.text || '';
            const usedRanges = entry.ranges || [];
            
            // Extract only used CSS from ranges
            for (const range of usedRanges) {
              const usedCss = css.substring(range.start, range.end);
              if (usedCss.trim()) {
                viewportCss += usedCss + '\n';
              }
            }
          }

          // Clean and parse CSS
          if (viewportCss.trim().length > 0) {
            try {
              const cleanedCss = await this.cleanCSS(viewportCss);
              
              if (cleanedCss.trim().length > 0) {
                successfulViewports.push(`${vp.width}x${vp.height}`);
                const mq = this.getMediaQueryForViewport(vp);
                criticalCss += mq ? `@media ${mq}{${cleanedCss}}` : cleanedCss;
              } else {
                partial = true;
                failedViewports.push(`${vp.width}x${vp.height}`);
                this.logger.warn(`⚠️ Empty CSS after cleaning @ ${vp.width}x${vp.height}`);
              }
            } catch (cleanError) {
              partial = true;
              failedViewports.push(`${vp.width}x${vp.height}`);
              this.logger.warn(`⚠️ Error cleaning CSS @ ${vp.width}x${vp.height}`, { error: cleanError.message });
            }
          } else {
            partial = true;
            failedViewports.push(`${vp.width}x${vp.height}`);
            this.logger.warn(`⚠️ No CSS captured @ ${vp.width}x${vp.height}`);
          }

          // Close page
          await page.close();

        } catch (err) {
          partial = true;
          failedViewports.push(`${vp.width}x${vp.height}`);
          this.logger.warn(`❌ Failure @ ${vp.width}x${vp.height}`, { error: err.message });
          
          // Try to close page if it exists
          if (page) {
            try {
              await page.close();
            } catch (closeErr) {
              // Ignore close errors
            }
          }
        } finally {
          if (browser) {
            await this.browserPool.release(browser);
          }
        }
      }

      // Final minification
      if (criticalCss) {
        criticalCss = criticalCss
          .replace(/\/\*[\s\S]*?\*\//g, '')  // Remove comments
          .replace(/\s+/g, ' ')               // Collapse whitespace
          .replace(/\s*([{}:;,])\s*/g, '$1') // Remove space around punctuation
          .trim();
      }

      const duration = Date.now() - startTime;

      if (criticalCss && criticalCss.length > 0) {
        return {
          css: criticalCss,
          metadata: {
            success: successfulViewports.length > 0,
            partial: failedViewports.length > 0 && successfulViewports.length > 0,
            duration,
            url: config.url,
            viewportsTested: viewports.length,
            size: criticalCss.length,
            successfulViewports,
            failedViewports
          },
          error: partial ? 'Partial viewport CSS generated' : null
        };
      }

      this.logger.warn(`❌ Critical CSS empty`, {
        url: config.url,
        successfulViewports,
        failedViewports
      });

      return {
        css: '',
        metadata: {
          success: false,
          partial,
          duration,
          url: config.url,
          viewportsTested: viewports.length,
          successfulViewports,
          failedViewports
        },
        error: partial ? 'Generated nothing (some viewports failed)' : 'No critical CSS generated for any viewport'
      };

    } catch (err) {
      const duration = Date.now() - startTime;
      this.logger.error(`🔥 Critical CSS generation error`, { url: config.url, error: err.message });

      return {
        css: '',
        metadata: {
          success: false,
          duration,
          url: config.url,
          successfulViewports,
          failedViewports
        },
        error: `Critical CSS generation failed: ${err.message}`
      };
    }
  }

  /**
   * Clean and optimize CSS using PostCSS
   */
  async cleanCSS(css) {
    try {
      const result = await postcss([]).process(css, { 
        parser: safeParser,
        from: undefined 
      });
      return result.css;
    } catch (err) {
      this.logger.warn('CSS cleaning failed, returning raw CSS', { error: err.message });
      return css;
    }
  }

  getMediaQueryForViewport(vp) {
    if (vp.width <= 480) return 'only screen and (max-width: 480px)';
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