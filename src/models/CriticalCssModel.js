// src/models/CriticalCssModel.js
import mongoose from 'mongoose';
/**
 * Logger Service Integration
 * 
 * ⚠️ PRODUCTION DEPLOYMENT CHECKLIST:
 * 1. Uncomment the line below
 * 2. Remove the temporary logger (lines 13-30)
 * 3. Verify LoggerService supports: error(msg, err), info(msg), debug(msg), warn(msg)
 * 
 * const logger = require('../services/LoggerService').getLogger('CriticalCssModel');
 */

// TEMPORARY LOGGER - Remove before production
const logger = {
  error: (message, error) => {
    const timestamp = new Date().toISOString();
    console.error(`[${timestamp}] [CriticalCssModel][ERROR] ${message}`, error?.message || error);
  },
  info: (message) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [CriticalCssModel][INFO] ${message}`);
  },
  debug: (message) => {
    if (process.env.LOG_LEVEL === 'debug') {
      const timestamp = new Date().toISOString();
      console.log(`[${timestamp}] [CriticalCssModel][DEBUG] ${message}`);
    }
  },
  warn: (message) => {
    const timestamp = new Date().toISOString();
    console.warn(`[${timestamp}] [CriticalCssModel][WARN] ${message}`);
  }
};

/**
 * Helper function to normalize Mongoose documents to plain objects with ISO dates
 * Ensures consistent API responses across all methods
 * 
 * ⚠️ FRONTEND NOTE: All date fields are returned as ISO 8601 strings (e.g., "2025-01-15T10:30:00.000Z")
 * Not as JavaScript Date objects. Parse with new Date(isoString) if needed.
 * 
 * @param {Object|Array} data - Mongoose document(s) or plain object(s)
 * @returns {Object|Array} Plain object(s) with Date fields converted to ISO strings
 */
function normalizeResponse(data) {
  if (!data) return data;
  
  // Handle arrays
  if (Array.isArray(data)) {
    return data.map(item => normalizeResponse(item));
  }
  
  // Convert Mongoose document to plain object if needed
  const plain = data.toObject ? data.toObject() : data;
  
  // Convert Date fields in metadata to ISO strings
  if (plain.metadata) {
    if (plain.metadata.generatedAt instanceof Date) {
      plain.metadata.generatedAt = plain.metadata.generatedAt.toISOString();
    } else if (plain.metadata.generatedAt === null) {
      plain.metadata.generatedAt = null;
    }
    
    if (plain.metadata.lastAttemptAt instanceof Date) {
      plain.metadata.lastAttemptAt = plain.metadata.lastAttemptAt.toISOString();
    } else if (plain.metadata.lastAttemptAt === null) {
      plain.metadata.lastAttemptAt = null;
    }

    // Convert errorHistory timestamps to ISO strings
    if (plain.metadata.errorHistory && Array.isArray(plain.metadata.errorHistory)) {
      plain.metadata.errorHistory = plain.metadata.errorHistory.map(errEntry => ({
        ...errEntry,
        timestamp: errEntry.timestamp instanceof Date 
          ? errEntry.timestamp.toISOString() 
          : errEntry.timestamp
      }));
    }
  }
  
  return plain;
}

/**
 * Mongoose Schema for Critical CSS templates
 * Collection: templates
 */
const CriticalCssSchema = new mongoose.Schema(
  {
    shop: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      index: true,
      validate: {
        validator: function(v) {
          // Basic validation for Shopify shop format
          return /^[a-z0-9-]+\.myshopify\.com$/i.test(v);
        },
        message: props => `${props.value} is not a valid Shopify shop domain`
      }
    },

    template: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      index: true,
      validate: {
        validator: function(v) {
          // Support Shopify template naming conventions (future-proof):
          // - Standard: "product", "collection", "index", "cart"
          // - Custom: "product.custom", "collection.summer", "page.about-us"
          // - With extension: "product.custom.json", "product.custom.summer.json"
          // - Multi-level: "product.custom.variant.json" (future-proof for nested templates)
          // 
          // Pattern breakdown:
          // - ^[a-zA-Z0-9_-]+ : First segment (required)
          // - (?:\.[a-zA-Z0-9_-]+)* : Additional segments with dots (optional, repeating)
          // - (?:\.json)? : Optional .json extension
          // 
          // Note: If Shopify reintroduces .liquid extensions, update regex to:
          // /^[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*(?:\.(json|liquid))?$/
          return /^[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*(?:\.json)?$/.test(v) && 
                 v.length >= 2 && 
                 v.length <= 100;
        },
        message: props => `${props.value} is not a valid Shopify template name. Must be 2-100 characters with alphanumeric, hyphens, underscores, dots, and optional .json extension.`
      }
    },

    url: {
      type: String,
      required: true,
      trim: true,
      validate: {
        validator: function(v) {
          // Basic URL validation
          return /^https?:\/\/.+/.test(v);
        },
        message: props => `${props.value} is not a valid URL`
      }
    },

    critical_css: {
      type: String,
      required: false, // Allow empty CSS during initial creation or failed generation
      default: ''
    },

      enabled: {
      type: Boolean,
      required: true,
      default: true,
      index: true
    },

    cdn_url: {
      type: String,
      required: false,
      default: null
    },


    metadata: {
      size: {
        type: Number,
        required: false,
        default: 0,
        min: 0
      },
      generatedAt: {
        type: Date,
        required: false,
        default: null, // null = never successfully generated CSS
        index: true // Allow queries like "find all CSS generated in last 24 hours"
      },
      lastAttemptAt: {
        type: Date,
        required: false,
        default: null // null = never attempted generation (tracks both success and failure)
      },
      error: {
        type: String,
        default: null,
        maxlength: 1000 // Prevent excessively long error messages
      },
      errorHistory: {
        type: [{
          error: {
            type: String,
            required: true,
            maxlength: 1000
          },
          timestamp: {
            type: Date,
            required: true,
            default: Date.now
          }
        }],
        default: [],
        validate: {
          validator: function(v) {
            // Keep only last 3 errors for debugging
            return v.length <= 3;
          },
          message: 'Error history cannot exceed 3 entries'
        }
      }
    }
  },
  {
    timestamps: true, // Adds createdAt and updatedAt
    collection: 'templates'
  }
);

// Compound unique index on shop + template
CriticalCssSchema.index({ shop: 1, template: 1 }, { unique: true });

// Additional indexes for common queries
CriticalCssSchema.index({ shop: 1, enabled: 1 }); // Find enabled templates for a shop
CriticalCssSchema.index({ 'metadata.generatedAt': -1 }); // Find recently generated CSS

/**
 * Static method: Upsert Critical CSS data for a shop/template combination
 * 
 * Important semantics:
 * - `generatedAt`: Only updated when CSS is successfully generated (data.critical_css is truthy)
 * - `lastAttemptAt`: Always updated on every upsert (tracks all attempts, success or failure)
 * - `error`: Current error (or null if successful)
 * - `errorHistory`: Last 3 errors with timestamps (useful for ops/debugging)
 * 
 * @param {Object} data - { shop, template, url, critical_css, error }
 * @returns {Promise<Object>} Plain object (normalized) with ISO date strings
 */
CriticalCssSchema.statics.upsertCriticalCss = async function(data) {
  try {
    if (!data.shop || !data.template) {
      throw new Error('Shop and template are required');
    }

    const size = data.critical_css ? Buffer.byteLength(data.critical_css, 'utf8') : 0;

    // Build base update object
    const update = {
      $set: {
        url: data.url,
        critical_css: data.critical_css || '',
        enabled: true, // Re-enable on upsert (assumes this is intentional regeneration)
        'metadata.size': size,
        'metadata.lastAttemptAt': new Date(), // Always update attempt time
        'metadata.error': data.error ? data.error.slice(0, 1000) : null
      }
    };

    // Only update generatedAt if new CSS was actually provided
    // This prevents failed attempts from incorrectly updating the success timestamp
    if (data.critical_css) {
      update.$set['metadata.generatedAt'] = new Date();
    }

    // If there's an error, add it to error history (keep last 3)
    if (data.error) {
      update.$push = {
        'metadata.errorHistory': {
          $each: [{
            error: data.error.slice(0, 1000),
            timestamp: new Date()
          }],
          $slice: -3 // Keep only last 3 errors
        }
      };
    } else if (data.critical_css) {
      // Clear error history on successful generation
      update.$set['metadata.errorHistory'] = [];
    }

    logger.debug(`Upserting CSS for ${data.shop}/${data.template}: ${size} bytes`);

    const options = { 
      upsert: true, 
      new: true, 
      setDefaultsOnInsert: true,
      lean: false // Get Mongoose doc first, then normalize
    };
    
    const result = await this.findOneAndUpdate(
      { shop: data.shop, template: data.template },
      update,
      options
    );

    logger.info(`Successfully upserted CSS for ${data.shop}/${data.template}`);
    
    // Normalize to plain object with ISO dates for API consistency
    return normalizeResponse(result);

  } catch (err) {
    logger.error('Error in upsertCriticalCss', err);
    throw err;
  }
};

/**
 * Static method: Find Critical CSS by shop and template
 * @param {string} shop - Shop domain (e.g., "mystore.myshopify.com")
 * @param {string} template - Template name (e.g., "product" or "product.custom")
 * @returns {Promise<Object|null>} Plain object (normalized) with ISO date strings, or null
 */
CriticalCssSchema.statics.findByShopAndTemplate = async function(shop, template) {
  try {
    const record = await this.findOne({ shop, template }).lean();
    return normalizeResponse(record);

  } catch (err) {
    logger.error('Error in findByShopAndTemplate', err);
    throw err;
  }
};

/**
 * Static method: Disable Critical CSS for a shop/template
 * @param {string} shop - Shop domain
 * @param {string} template - Template name
 * @returns {Promise<Object|null>} Plain object (normalized) with ISO date strings, or null
 */
CriticalCssSchema.statics.disableCriticalCss = async function(shop, template) {
  try {
    if (!shop || !template) {
      throw new Error('Shop and template are required');
    }

    logger.info(`Disabling CSS for ${shop}/${template}`);

    const result = await this.findOneAndUpdate(
      { shop, template },
      { $set: { enabled: false } },
      { new: true, lean: true }
    );

    return normalizeResponse(result);

  } catch (err) {
    logger.error('Error in disableCriticalCss', err);
    throw err;
  }
};

/**
 * Static method: Enable Critical CSS for a shop/template
 * @param {string} shop - Shop domain
 * @param {string} template - Template name
 * @returns {Promise<Object|null>} Plain object (normalized) with ISO date strings, or null
 */
CriticalCssSchema.statics.enableCriticalCss = async function(shop, template) {
  try {
    if (!shop || !template) {
      throw new Error('Shop and template are required');
    }

    logger.info(`Enabling CSS for ${shop}/${template}`);

    const result = await this.findOneAndUpdate(
      { shop, template },
      { $set: { enabled: true } },
      { new: true, lean: true }
    );

    return normalizeResponse(result);

  } catch (err) {
    logger.error('Error in enableCriticalCss', err);
    throw err;
  }
};

/**
 * Static method: Get all templates for a shop
 * @param {string} shop - Shop domain
 * @param {boolean} onlyEnabled - Only return enabled templates (default: true)
 * @returns {Promise<Array>} Array of plain objects (normalized) with ISO date strings
 */
CriticalCssSchema.statics.findByShop = async function(shop, onlyEnabled = true) {
  try {
    const filter = { shop };
    if (onlyEnabled) filter.enabled = true;
    
    const records = await this.find(filter, '-critical_css')
      .sort({ template: 1 })
      .lean();
    
    return normalizeResponse(records);

  } catch (err) {
    logger.error('Error in findByShop', err);
    throw err;
  }
};

/**
 * Static method: Delete Critical CSS for a shop/template
 * @param {string} shop - Shop domain
 * @param {string} template - Template name
 * @returns {Promise<Object|null>} Plain object (normalized) with ISO date strings, or null
 */
CriticalCssSchema.statics.deleteCriticalCss = async function(shop, template) {
  try {
    if (!shop || !template) {
      throw new Error('Shop and template are required');
    }

    logger.warn(`Deleting CSS for ${shop}/${template}`);

    const result = await this.findOneAndDelete({ shop, template }).lean();

    if (result) {
      logger.info(`Successfully deleted CSS for ${shop}/${template}`);
    }

    return normalizeResponse(result);

  } catch (err) {
    logger.error('Error in deleteCriticalCss', err);
    throw err;
  }
};

/**
 * Static method: Find templates that need regeneration
 * Useful for scheduled jobs that refresh stale CSS
 * @param {Object} criteria
 * @param {number} criteria.olderThanDays - Find CSS older than X days (default: 30)
 * @param {number} criteria.limit - Maximum results to return (default: 100)
 * @returns {Promise<Array>} Array of plain objects (normalized) with ISO date strings
 */
CriticalCssSchema.statics.findStaleTemplates = async function(criteria = {}) {
  try {
    const { olderThanDays = 30, limit = 100 } = criteria;
    
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    logger.debug(`Finding templates older than ${cutoffDate.toISOString()}`);

    const results = await this.find({
      enabled: true,
      $or: [
        { 'metadata.generatedAt': { $lt: cutoffDate } },
        { 'metadata.generatedAt': null } // Never successfully generated
      ]
    })
      .select('shop template url metadata.generatedAt metadata.lastAttemptAt metadata.error metadata.errorHistory')
      .sort({ 'metadata.generatedAt': 1 }) // Oldest first (null values come last in ascending sort)
      .limit(limit)
      .lean();

    logger.info(`Found ${results.length} stale templates`);
    
    return normalizeResponse(results);

  } catch (err) {
    logger.error('Error in findStaleTemplates', err);
    throw err;
  }
};

/**
 * Static method: Find templates with recurring errors
 * Useful for identifying problematic templates that consistently fail generation
 * @param {Object} criteria
 * @param {number} criteria.minErrors - Minimum number of errors in history (default: 2)
 * @param {number} criteria.limit - Maximum results to return (default: 50)
 * @returns {Promise<Array>} Array of plain objects (normalized) with ISO date strings
 */
CriticalCssSchema.statics.findProblematicTemplates = async function(criteria = {}) {
  try {
    const { minErrors = 2, limit = 50 } = criteria;

    logger.debug(`Finding templates with at least ${minErrors} errors`);

    const results = await this.find({
      enabled: true,
      'metadata.error': { $ne: null }, // Has current error
      [`metadata.errorHistory.${minErrors - 1}`]: { $exists: true } // Has at least minErrors in history
    })
      .select('shop template url metadata.generatedAt metadata.lastAttemptAt metadata.error metadata.errorHistory')
      .sort({ 'metadata.lastAttemptAt': -1 }) // Most recently attempted first
      .limit(limit)
      .lean();

    logger.info(`Found ${results.length} problematic templates`);
    
    return normalizeResponse(results);

  } catch (err) {
    logger.error('Error in findProblematicTemplates', err);
    throw err;
  }
};

// Create and export the model
const CriticalCss = mongoose.model('CriticalCss', CriticalCssSchema);

export default {
  CriticalCss, // Export model for direct queries if needed
  upsertCriticalCss: (data) => CriticalCss.upsertCriticalCss(data),
  findByShopAndTemplate: (shop, template) => CriticalCss.findByShopAndTemplate(shop, template),
  disableCriticalCss: (shop, template) => CriticalCss.disableCriticalCss(shop, template),
  enableCriticalCss: (shop, template) => CriticalCss.enableCriticalCss(shop, template),
  findByShop: (shop, onlyEnabled) => CriticalCss.findByShop(shop, onlyEnabled),
  deleteCriticalCss: (shop, template) => CriticalCss.deleteCriticalCss(shop, template),
  findStaleTemplates: (criteria) => CriticalCss.findStaleTemplates(criteria),
  findProblematicTemplates: (criteria) => CriticalCss.findProblematicTemplates(criteria)
};