// src/controllers/CriticalCssController.js
import CriticalCssModel from '../models/CriticalCssModel.js';
import CSSProcessor from '../services/CSSProcessor.js';
import ScreenshotService from '../services/ScreenshotService.js';
import config from '../config/config.js';
import LoggerService from '../logs/Logger.js';

const cssProcessor = new CSSProcessor();
const screenshotService = new ScreenshotService();
const logger = LoggerService.child({ service: 'CriticalCssController' });

/**
 * URL validation helper
 */
function isValidUrl(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.protocol === 'http:' || urlObj.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Shop domain validation helper
 */
function isValidShopDomain(shop) {
  return /^[a-z0-9-]+\.myshopify\.com$/i.test(shop);
}

/**
 * Template name validation helper
 * Supports Shopify template naming conventions:
 * - Simple: "product", "collection", "index"
 * - Custom: "product.custom", "collection.summer"
 * - With extension: "product.custom.json" (Shopify 2.0 JSON templates)
 */
function isValidTemplate(template) {
  if (!template || typeof template !== 'string') {
    return false;
  }
  
  // Allow alphanumeric, hyphens, underscores, dots
  // Support optional .json extension for Shopify 2.0 templates
  // Examples: "product", "product.custom", "product.custom.json"
  return /^[a-zA-Z0-9-_.]+(?:\.json)?$/.test(template) && 
         template.length >= 2 && 
         template.length <= 100; // Increased to accommodate longer template names with extensions
}

/**
 * Helper function to handle CSS generation results and save to database
 * Reduces duplication between generate and regenerate endpoints
 * 
 * @param {Object} result - Result from generateCriticalCSS service
 * @param {string} shop - Shop domain
 * @param {string} template - Template name
 * @param {string} url - URL used for generation
 * @param {Object|null} existing - Existing record (for regeneration fallback)
 * @returns {Object} Saved record or null on failure
 */
async function saveGeneratedCss(result, shop, template, url, existing = null) {
  const {
    css = '',
    error: generationError = null,
    metadata = {},
    success: topSuccess,
  } = result;
  const success = topSuccess === true || metadata?.success === true;
  const partial = Boolean(metadata?.partial);

  if (!success || !css) {
    logger.error(`CSS generation failed for ${shop}/${template}`, {
      error: generationError || metadata.error || 'Unknown failure',
      url,
    });

    if (existing) {
      await CriticalCssModel.upsertCriticalCss({
        shop,
        template,
        url,
        critical_css: existing.critical_css,
        metadata: {
          ...existing.metadata,
          lastAttemptAt: new Date().toISOString(),
          error: generationError || metadata.error || 'Critical CSS generation failed',
        },
      });
    }

    return null;
  }

  logger.debug(`Generated ${css.length} bytes of CSS for ${shop}/${template}`);

  const saved = await CriticalCssModel.upsertCriticalCss({
    shop,
    template,
    url,
    critical_css: css,
    metadata: {
      ...metadata,
      size: Buffer.byteLength(css, 'utf8'),
      generatedAt: new Date().toISOString(),
      error: null,
      lastAttemptAt: new Date().toISOString(),
    },
  });

  logger.info(`Successfully saved critical CSS for ${shop}/${template}`);
  return saved;
}

/**
 * Generate Critical CSS for a shop/template combination
 * POST /critical-css/generate
 * Body: { shop, template, url }
 */
async function generateCriticalCss(req, res) {
  try {
    const { shop, template, url } = req.body;

    // Validate required fields
    if (!shop || !template || !url) {
      return res.status(400).json({
        ok: false,
        error: 'Missing required fields: shop, template, url'
      });
    }

    // Validate URL format
    if (!isValidUrl(url)) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid URL format. Must be a valid http/https URL'
      });
    }

    // Validate shop domain format
    if (!isValidShopDomain(shop)) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid shop domain. Must be in format: shop.myshopify.com'
      });
    }

    // Validate template name
    if (!isValidTemplate(template)) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid template name. Must be 2-100 characters. Allowed: alphanumeric, hyphens, underscores, dots, and optional .json extension (e.g., product.custom.json)'
      });
    }

    logger.info(`Generating critical CSS for ${shop}/${template}`);

    // Generate critical CSS using CSSProcessor service
    const result = await cssProcessor.generateCriticalCSS({ url, shop, template });

    // Use helper to save result
    const saved = await saveGeneratedCss(result, shop, template, url);

    if (!saved) {
      return res.status(422).json({
        ok: false,
        error: result.error || result.metadata?.error || 'Failed to generate critical CSS'
      });
    }

    return res.status(200).json({
      ok: true,
      message: 'Critical CSS generated successfully',
      data: {
        shop: saved.shop,
        template: saved.template,
        size: saved.metadata.size,
        generatedAt: saved.metadata.generatedAt,
        partial: saved.metadata.partial || false
      }
    });

  } catch (error) {
    logger.error('Error in generateCriticalCss:', error);
    return res.status(500).json({
      ok: false,
      error: error.message || 'Internal server error'
    });
  }
}

/**
 * Get Critical CSS for a shop/template
 * GET /critical-css/:shop/:template
 * 
 * FRONTEND NOTE: Disabled state is NOT an error!
 * Check response structure:
 * - Success with CSS: { ok: true, enabled: true, data: { css, ... } }
 * - Success but disabled: { ok: true, enabled: false, message: '...' }
 * - Error: { ok: false, error: '...' }
 */
async function getCriticalCss(req, res) {
  try {
    const { shop, template } = req.params;

    // Fetch from database
    const record = await CriticalCssModel.findByShopAndTemplate(shop, template);

    if (!record) {
      return res.status(404).json({
        ok: false,
        error: `No critical CSS found for shop: ${shop}, template: ${template}`
      });
    }

    // Check if disabled - this is NOT an error, it's a valid state
    // Frontend should check: if (response.ok && !response.enabled) { /* handle disabled */ }
    if (!record.enabled) {
      return res.status(200).json({
        ok: true,
        enabled: false,
        message: 'Critical CSS is disabled for this shop/template',
        data: {
          css: null, // Don't send CSS when disabled
          metadata: record.metadata,
          shop: record.shop,
          template: record.template
        }
      });
    }

    // Enabled - return CSS
    return res.status(200).json({
      ok: true,
      enabled: true,
      data: {
        css: record.critical_css,
        metadata: record.metadata,
        shop: record.shop,
        template: record.template
      }
    });

  } catch (error) {
    logger.error('Error in getCriticalCss:', error);
    return res.status(500).json({
      ok: false,
      error: error.message || 'Internal server error'
    });
  }
}

/**
 * Disable Critical CSS for a shop/template
 * POST /critical-css/:shop/:template/disable
 */
async function disableCriticalCss(req, res) {
  try {
    const { shop, template } = req.params;

    logger.info(`Disabling critical CSS for ${shop}/${template}`);

    // Update enabled flag
    const updated = await CriticalCssModel.disableCriticalCss(shop, template);

    if (!updated) {
      return res.status(404).json({
        ok: false,
        error: `No critical CSS found for shop: ${shop}, template: ${template}`
      });
    }

    return res.status(200).json({
      ok: true,
      message: 'Critical CSS disabled successfully',
      data: {
        shop: updated.shop,
        template: updated.template,
        enabled: updated.enabled
      }
    });

  } catch (error) {
    logger.error('Error in disableCriticalCss:', error);
    return res.status(500).json({
      ok: false,
      error: error.message || 'Internal server error'
    });
  }
}

/**
 * Regenerate Critical CSS for a shop/template
 * POST /critical-css/:shop/:template/regenerate
 */
async function regenerateCriticalCss(req, res) {
  try {
    const { shop, template } = req.params;
    logger.info(`Regenerating critical CSS for ${shop}/${template}`);

    const existing = await CriticalCssModel.findByShopAndTemplate(shop, template);
    if (!existing) {
      return res.status(404).json({
        ok: false,
        error: `No existing critical CSS found for shop: ${shop}, template: ${template}. Use /generate instead.`
      });
    }

    const result = await cssProcessor.generateCriticalCSS({ url: existing.url, shop, template });
    const updated = await saveGeneratedCss(result, shop, template, existing.url, existing);

    if (!updated) {
      return res.status(422).json({
        ok: false,
        error: result.error || result.metadata?.error || 'Failed to regenerate critical CSS'
      });
    }

    return res.status(200).json({
      ok: true,
      message: 'Critical CSS regenerated successfully',
      data: {
        shop: updated.shop,
        template: updated.template,
        size: updated.metadata.size,
        generatedAt: updated.metadata.generatedAt,
        partial: updated.metadata.partial || false
      }
    });

  } catch (error) {
    logger.error('Error in regenerateCriticalCss:', error);
    return res.status(500).json({
      ok: false,
      error: error.message || 'Internal server error'
    });
  }
}

/**
 * Get metadata only for a shop/template
 * GET /critical-css/:shop/:template/metadata
 */
async function getCriticalCssMetadata(req, res) {
  try {
    const { shop, template } = req.params;

    const record = await CriticalCssModel.findByShopAndTemplate(shop, template);

    if (!record) {
      return res.status(404).json({
        ok: false,
        error: `No critical CSS found for shop: ${shop}, template: ${template}`
      });
    }

    return res.status(200).json({
      ok: true,
      data: {
        shop: record.shop,
        template: record.template,
        url: record.url,
        enabled: record.enabled,
        metadata: record.metadata
      }
    });

  } catch (error) {
    logger.error('Error in getCriticalCssMetadata:', error);
    return res.status(500).json({
      ok: false,
      error: error.message || 'Internal server error'
    });
  }
}

/**
 * Get screenshot for a shop/template (debug only)
 * GET /critical-css/:shop/:template/screenshot
 */
async function getCriticalCssScreenshot(req, res) {
  try {
    const { shop, template } = req.params;
    if (!config.isDevelopment && !process.env.DEBUG) {
      return res.status(403).json({
        ok: false,
        error: 'Screenshots are only available in development mode or when DEBUG=true'
      });
    }

    logger.debug(`Capturing screenshot for ${shop}/${template}`);
    const record = await CriticalCssModel.findByShopAndTemplate(shop, template);
    if (!record) {
      return res.status(404).json({
        ok: false,
        error: `No critical CSS found for shop: ${shop}, template: ${template}`
      });
    }

    const screenshotPath = await screenshotService.captureScreenshot(record.url, { width: 1366, height: 768 });
    if (!screenshotPath) {
      return res.status(500).json({
        ok: false,
        error: 'Failed to generate screenshot'
      });
    }

    logger.info(`Screenshot saved: ${screenshotPath}`);
    return res.status(200).json({
      ok: true,
      data: { shop, template, screenshotPath, url: record.url }
    });

  } catch (error) {
    logger.error('Error in getCriticalCssScreenshot:', error);
    return res.status(500).json({
      ok: false,
      error: error.message || 'Internal server error'
    });
  }
}

export default {
  generateCriticalCss,
  getCriticalCss,
  disableCriticalCss,
  regenerateCriticalCss,
  getCriticalCssMetadata,
  getCriticalCssScreenshot
};