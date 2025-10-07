// src/models/ShopifyShopModel.js
import mongoose from 'mongoose';

/**
 * Read-only model to access Shopify app's shop data
 * This service only READS from this collection, never writes
 */
const ShopifyShopSchema = new mongoose.Schema({
  shop: String,
  access_token: String,
  short_id: String,
  
  // Site structure from Shopify app
  site_structure: {
    last_analyzed: Date,
    active_theme: String,
    template_groups: {
      type: Map,
      of: mongoose.Schema.Types.Mixed
    }
  },
  
  // Critical CSS storage (written by this service)
  critical_css: {
    type: Map,
    of: {
      css: String,
      size: Number,
      generated_at: Date,
      cdn_url: String,
      enabled: Boolean
    }
  }
}, {
  collection: 'shops', // Same collection as Shopify app
  timestamps: true
});

/**
 * Get ShopifyShop model using secondary connection to RLPlatforms database
 * @returns {mongoose.Model}
 */
const getShopifyShopModel = () => {
  if (!global.shopifyDbConnection) {
    throw new Error('Shopify database connection not initialized. Ensure db.js has been loaded.');
  }
  
  // Return existing model or create new one (prevents OverwriteModelError)
  return global.shopifyDbConnection.models.ShopifyShop || 
         global.shopifyDbConnection.model('ShopifyShop', ShopifyShopSchema);
};

export default getShopifyShopModel();