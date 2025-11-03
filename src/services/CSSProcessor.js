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

  // Validate URL early and safely
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
  penthouse: { 
    puppeteer: { 
      getBrowser: () => browser 
    },
    timeout: 60000,
    pageLoadSkipTimeout: 5000,
    renderWaitTime: 500,
    blockJSRequests: false
  }
});
        if (result && result.css && result.css.trim().length > 0) {
          successfulViewports.push(`${vp.width}x${vp.height}`);

          const mq = this.getMediaQueryForViewport(vp);

          // Wrap mobile result in MQ, desktop stays global
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

    // Minify CSS
    if (criticalCss) {
      criticalCss = criticalCss
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\s+/g, ' ')
        .trim();
    }

    const duration = Date.now() - startTime;

    // Successful extraction of at least one viewport
    if (criticalCss && criticalCss.length > 0) {
      return {
  css: criticalCss,
  metadata: {
    success: successfulViewports.length > 0, // treat single-viewport success as valid
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
      error: partial
        ? 'Generated nothing (some viewports failed)'
        : 'No critical CSS generated for any viewport'
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
  // Mobile CSS scope
  if (vp.width <= 480) {
    return 'only screen and (max-width: 480px)';
  }

  // Desktop CSS scope
  if (vp.width >= 1024) {
    return 'only screen and (min-width: 1024px)';
  }

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
