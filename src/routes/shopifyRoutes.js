// src/routes/shopifyRoutes.js
//
import express from 'express';
import ShopifyIntegrationController from '../controllers/ShopifyIntegrationController.js';

const router = express.Router();

// Generate critical CSS for all templates in a shop
router.post('/generate-all-css', ShopifyIntegrationController.generateAllCSSForShop);

// Get CSS CDN URL for a specific template
router.get('/:shop/:template/css-url', ShopifyIntegrationController.getCSSUrl);

// Get template status overview
router.get('/:shop/templates', ShopifyIntegrationController.getTemplateStatus);

export default router;