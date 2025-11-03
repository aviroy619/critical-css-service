// src/services/CSSProcessor.js

import { generate } from 'critical';
import penthouse from 'penthouse';
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
        { width: 360, height: 800, method: 'critical' },      // mobile - use critical
        { width: 1366, height: 768, method: 'penthouse' }     // desktop - use penthouse directly
      ];

      for (const vp of viewports) {
        let browser = null;

        try {
          this.logger.info(`🎯 Generating critical CSS @ ${vp.width}x${vp.height} (${vp.method})`);

          browser = await this.browserPool.acquire();

          let result;

          if (vp.method === 'critical') {
            // Use critical package for mobile
            result = await generate({
              src: config.url,
              width: vp.width,
              height: vp.height,
              inline: false,
              rebase: false,
              penthouse: {
                puppeteer: {
                  getBrowser: () => browser
                }
              }
            });
          } else {
            // Use penthouse directly for desktop (more stable)
            const css = await penthouse({
              url: config.url,
              puppeteer: {
                getBrowser: () => browser
              },
              width: vp.width,
              height: vp.height,
              timeout: 60000,
              pageLoadSkipTimeout: 10000,
              renderWaitTime: 1000,
              blockJSRequests: false,
              keepLargerMediaQueries: true
            });
            
            result = { css };
          }

          if (result && result.css && result.css.trim().length > 0) {
            successfulViewports.push(`${vp.width}x${vp.height}`);
            const mq = this.getMediaQueryForViewport(vp);
            criticalCss += mq ? `@media ${mq}{${result.css}}` : result.css;
          } else {
            partial = true;
            failedViewports.push(`${vp.width}x${vp.height}`);
            this.logger.warn(`⚠️ Empty CSS @ ${vp.width}x${vp.height}`);
          }

        } catch (err) {
          partial = true;
          failedViewports.push(`${vp.width}x${vp.height}`);
          this.logger.warn(`❌ Failure @ ${vp.width}x${vp.height}`, { error: err.message });
        } finally {
          if (browser) {
            await this.browserPool.release(browser);
          }
        }
      }

      // Minify CSS
      if (criticalCss) {
        criticalCss = criticalCss
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/\s+/g, ' ')
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