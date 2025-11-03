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

  const successfulViewports = [];
  const failedViewports = [];

  if (!this.isValidUrl(config.url)) {
    return {
      css: '',
      metadata: { success: false, error: 'Invalid URL', url: config.url },
      error: 'Invalid URL'
    };
  }

  // Only mobile + desktop
  const viewports = [
    { width: 360, height: 800 },      // mobile
    { width: 1920, height: 1080 }     // desktop
  ];

  for (const vp of viewports) {
    let browser = null;

    try {
      this.logger.info(`🎯 Generating critical CSS @ ${vp.width}x${vp.height}`);

      browser = await this.browserPool.acquire();

      const result = await generate({
        src: config.url,
        width: vp.width,
        height: vp.height,
        inline: false,
        rebase: false,

        // Only required Penthouse config
        penthouse: { puppeteer: { getBrowser: () => browser } },

        // Performance stabilizers
        renderWaitTime: 800,
        blockJSRequests: vp.width > 480   // block JS except mobile
      });

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
      if (browser) await this.browserPool.release(browser);
    }
  }

  // Minify
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

  // Nothing extracted
  this.logger.warn(`❌ Critical CSS empty`, { url: config.url, successfulViewports, failedViewports });

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
    error: partial
      ? 'Generated nothing (some viewports failed)'
      : 'No critical CSS generated for any viewport'
  };
}



  getMediaQueryForViewport(vp) {
  // Mobile CSS only
  if (vp.width <= 480) return 'only screen and (max-width: 480px)';

  // Desktop CSS: no media query, apply globally
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
