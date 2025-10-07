/**
 * criticalCssRoutes.js
 * 
 * REST API routes for Critical CSS operations.
 * Maps HTTP endpoints to CriticalCssController functions.
 * 
 * Base path: /critical-css (mounted in app.js)
 */

import express from 'express';
import CriticalCssController from '../controllers/CriticalCssController.js';

const router = express.Router();

// ============================================================================
// CORE ROUTES
// ============================================================================

/**
 * POST /critical-css/generate
 * Generate critical CSS for a shop + template + URL
 * 
 * Body: {
 *   shop: "mystore.myshopify.com",
 *   template: "product",
 *   url: "https://mystore.myshopify.com/products/example"
 * }
 * 
 * Returns: Generated CSS + metadata
 */
router.post('/generate', CriticalCssController.generateCriticalCss);

/**
 * GET /critical-css/:shop/:template
 * Retrieve stored critical CSS for shop + template
 * 
 * Params:
 *   shop - Shop domain (e.g., "mystore.myshopify.com")
 *   template - Template type (e.g., "product", "home", "collection")
 * 
 * Returns: { css, metadata, enabled }
 */
router.get('/:shop/:template', CriticalCssController.getCriticalCss);

/**
 * POST /critical-css/:shop/:template/disable
 * Disable critical CSS injection for a template
 * 
 * Params:
 *   shop - Shop domain
 *   template - Template type
 * 
 * Returns: Updated document with enabled = false
 */
router.post('/:shop/:template/disable', CriticalCssController.disableCriticalCss);

/**
 * POST /critical-css/:shop/:template/regenerate
 * Force regeneration of critical CSS
 * 
 * Body (optional): {
 *   url: "https://mystore.myshopify.com/products/example"
 * }
 * 
 * Params:
 *   shop - Shop domain
 *   template - Template type
 * 
 * Returns: Newly generated CSS + metadata
 */
router.post('/:shop/:template/regenerate', CriticalCssController.regenerateCriticalCss);

// ============================================================================
// DEBUG & METADATA ROUTES
// ============================================================================

/**
 * GET /critical-css/:shop/:template/metadata
 * Retrieve only metadata (no CSS content)
 * 
 * Params:
 *   shop - Shop domain
 *   template - Template type
 * 
 * Returns: { shop, template, url, enabled, metadata: { size, generatedAt, error } }
 */
router.get('/:shop/:template/metadata', CriticalCssController.getCriticalCssMetadata);

/**
 * GET /critical-css/:shop/:template/screenshot
 * Capture and return screenshot for visual debugging
 * 
 * Params:
 *   shop - Shop domain
 *   template - Template type
 * 
 * Query params (optional):
 *   width - Viewport width (default: 1366)
 *   height - Viewport height (default: 768)
 *   fullPage - Capture full scrollable page (default: false)
 * 
 * Returns: PNG image or screenshot path
 * 
 * Note: May be disabled in production unless DEBUG=true
 */
router.get('/:shop/:template/screenshot', CriticalCssController.getCriticalCssScreenshot);

// ============================================================================
// HEALTH CHECK (Optional)
// ============================================================================

/**
 * GET /critical-css/health
 * Service health check endpoint
 * 
 * Returns: { status: "ok", timestamp, service: "critical-css-service" }
 */
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'critical-css-service',
    version: '1.1.0'
  });
});

export default router;