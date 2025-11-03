// src/services/CSSProcessor.js

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
          error: 'Invalid URL'
        };
      }

      const viewports = [
        { width: 360, height: 800 },
        { width: 1366, height: 768 },
        { width: 1920, height: 1080 }
      ];

      for (const vp of viewports) {
        let browser = null;
        try {
          this.logger.info(`Generating critical CSS @ ${vp.width}x${vp.height}`);

          browser = await this.browserPool.acquire();

          const r = await generate({
            src: config.url,
            width: vp.width,
            height: vp.height,
            inline: false,
            rebase: false,
            penthouse: { puppeteer: { getBrowser: () => browser } }
          });

          if (r && r.css && r.css.trim().length > 0) {
            const mq = this.getMediaQueryForViewport(vp);
            criticalCss += mq ? `@media ${mq}{${r.css}}` : r.css;
          } else {
            partial = true;
            this.logger.warn(`Viewport ${vp.width}x${vp.height} returned empty CSS`);
          }
        } catch (err) {
          partial = true;
          this.logger.warn(`Viewport ${vp.width}x${vp.height} failed`, { error: err.message });
        } finally {
          if (browser) await this.browserPool.release(browser);
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

      // ✅ At least some CSS generated
      if (criticalCss && criticalCss.length > 0) {
        return {
          css: criticalCss,
          metadata: {
            success: !partial,
            partial,
            duration,
            url: config.url,
            viewports: viewports.length,
            size: criticalCss.length
          },
          error: partial ? 'Partial viewport CSS generated' : null
        };
      }

      // ❌ Nothing generated at all
      return {
        css: '',
        metadata: {
          success: false,
          partial,
          duration,
          url: config.url,
          viewports: viewports.length
        },
        error: partial
          ? 'Generated nothing (some viewports failed)'
          : 'No critical CSS generated for any viewport'
      };

    } catch (err) {
      const duration = Date.now() - startTime;
      this.logger.error(`Critical CSS generation failed for ${config.url}`, { error: err.message });

      return {
        css: '',
        metadata: { success: false, duration, url: config.url },
        error: `Critical CSS generation failed: ${err.message}`
      };
    }
  }

  getMediaQueryForViewport(vp) {
    if (vp.width <= 480) return 'only screen and (max-width: 480px)';
    if (vp.width <= 768) return 'only screen and (max-width: 768px)';
    if (vp.width <= 1366) return 'only screen and (max-width: 1366px)';
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
