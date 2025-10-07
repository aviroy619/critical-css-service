/**
 * validators.js
 * 
 * Pure utility functions for input validation across the Critical CSS Service.
 * All functions return boolean values and never throw errors.
 * 
 * Can be reused in controllers, services, models, and tests.
 */

/**
 * Validates if a string is a properly formatted HTTP or HTTPS URL
 * 
 * @param {string} url - URL string to validate
 * @returns {boolean} True if valid HTTP/HTTPS URL, false otherwise
 * 
 * @example
 * isValidUrl("https://example.com"); // true
 * isValidUrl("http://example.com/path"); // true
 * isValidUrl("ftp://example.com"); // false
 * isValidUrl("not-a-url"); // false
 * isValidUrl(""); // false
 * isValidUrl(null); // false
 */
function isValidUrl(url) {
  // Check for null, undefined, or non-string values
  if (!url || typeof url !== 'string') {
    return false;
  }

  try {
    const urlObj = new URL(url);
    // Only allow HTTP and HTTPS protocols
    return urlObj.protocol === 'http:' || urlObj.protocol === 'https:';
  } catch (error) {
    return false;
  }
}

/**
 * Validates if a string is a valid Shopify shop domain
 * Must end with .myshopify.com and follow Shopify's naming rules
 * 
 * Rules:
 * - Must end with .myshopify.com
 * - Subdomain must start with alphanumeric character
 * - Can contain alphanumeric characters and hyphens
 * - Cannot start or end with a hyphen
 * 
 * @param {string} shop - Shop domain to validate
 * @returns {boolean} True if valid Shopify domain, false otherwise
 * 
 * @example
 * isValidShopDomain("store123.myshopify.com"); // true
 * isValidShopDomain("my-store.myshopify.com"); // true
 * isValidShopDomain("store.com"); // false
 * isValidShopDomain("-invalid.myshopify.com"); // false
 * isValidShopDomain("store-.myshopify.com"); // false
 */
function isValidShopDomain(shop) {
  // Check for null, undefined, or non-string values
  if (!shop || typeof shop !== 'string') {
    return false;
  }

  // Regex explanation:
  // ^[a-zA-Z0-9]         - Must start with alphanumeric
  // [a-zA-Z0-9-]*        - Can contain alphanumeric and hyphens
  // [a-zA-Z0-9]          - Must end with alphanumeric (not hyphen)
  // \.myshopify\.com$    - Must end with .myshopify.com
  const shopDomainRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\.myshopify\.com$/;
  
  return shopDomainRegex.test(shop);
}

/**
 * Validates if a string is a valid Shopify template name
 * 
 * Supports:
 * - Core templates: product, collection, cart, index, page, blog, article, etc.
 * - Custom templates: product.custom, page.about-us
 * - Shopify 2.0 JSON templates: product.json, page.faq.json
 * - Alternate templates: product.alternate.json
 * 
 * @param {string} template - Template name to validate
 * @returns {boolean} True if valid template name, false otherwise
 * 
 * @example
 * isValidTemplate("product"); // true
 * isValidTemplate("collection"); // true
 * isValidTemplate("page.about-us"); // true
 * isValidTemplate("product.custom"); // true
 * isValidTemplate("cart.json"); // true
 * isValidTemplate("product.alternate.json"); // true
 * isValidTemplate("random"); // false
 * isValidTemplate(""); // false
 */
function isValidTemplate(template) {
  // Check for null, undefined, or non-string values
  if (!template || typeof template !== 'string') {
    return false;
  }

  // List of valid core Shopify template types
  const validCoreTemplates = [
    'product',
    'collection',
    'cart',
    'index',
    'page',
    'blog',
    'article',
    'search',
    'customers/account',
    'customers/login',
    'customers/order',
    'customers/register',
    'gift_card',
    'password',
    '404',
    'list-collections'
  ];

  // Regex explanation:
  // ^                                  - Start of string
  // (product|collection|...)           - Core template type
  // (\.[a-z0-9-]+)*                    - Optional custom suffix (e.g., .custom, .about-us)
  // (\.json)?                          - Optional .json extension
  // $                                  - End of string
  const coreTemplatesPattern = validCoreTemplates.join('|');
  const templateRegex = new RegExp(
    `^(${coreTemplatesPattern})(\\.[a-z0-9-]+)*(\.json)?$`,
    'i'
  );

  return templateRegex.test(template);
}

/**
 * Sanitizes a template name by normalizing format
 * 
 * Operations:
 * - Convert to lowercase
 * - Trim whitespace
 * - Remove potentially dangerous characters
 * - Replace multiple dots/hyphens with single ones
 * - Remove leading/trailing dots and hyphens
 * 
 * @param {string} template - Template name to sanitize
 * @returns {string} Sanitized template name
 * 
 * @example
 * sanitizeTemplateName("  PRODUCT.Custom  "); // "product.custom"
 * sanitizeTemplateName("page..about--us"); // "page.about-us"
 * sanitizeTemplateName("cart.json"); // "cart.json"
 */
function sanitizeTemplateName(template) {
  // Check for null, undefined, or non-string values
  if (!template || typeof template !== 'string') {
    return '';
  }

  return template
    .toLowerCase()                    // Convert to lowercase
    .trim()                           // Remove leading/trailing whitespace
    .replace(/[^a-z0-9.\-/]/g, '')    // Remove non-alphanumeric except dots, hyphens, slashes
    .replace(/\.{2,}/g, '.')          // Replace multiple dots with single dot
    .replace(/-{2,}/g, '-')           // Replace multiple hyphens with single hyphen
    .replace(/^[.\-]+|[.\-]+$/g, ''); // Remove leading/trailing dots and hyphens
}

/**
 * Validates if a string represents a valid CSS size
 * Used for metadata validation
 * 
 * @param {number|string} size - Size to validate (in bytes)
 * @returns {boolean} True if valid size, false otherwise
 * 
 * @example
 * isValidCssSize(1024); // true
 * isValidCssSize("1024"); // true
 * isValidCssSize(0); // true
 * isValidCssSize(-1); // false
 * isValidCssSize("abc"); // false
 */
function isValidCssSize(size) {
  if (size === null || size === undefined) {
    return false;
  }

  const numericSize = typeof size === 'string' ? parseInt(size, 10) : size;
  
  return !isNaN(numericSize) && numericSize >= 0 && Number.isFinite(numericSize);
}

/**
 * Validates if a string is a valid ISO 8601 datetime
 * Used for metadata timestamp validation
 * 
 * @param {string} dateString - Date string to validate
 * @returns {boolean} True if valid ISO datetime, false otherwise
 * 
 * @example
 * isValidISODate("2025-10-02T12:00:00Z"); // true
 * isValidISODate("2025-10-02T12:00:00.000Z"); // true
 * isValidISODate("invalid"); // false
 */
function isValidISODate(dateString) {
  if (!dateString || typeof dateString !== 'string') {
    return false;
  }

  const date = new Date(dateString);
  return !isNaN(date.getTime()) && date.toISOString() === dateString;
}

/**
 * Validates shop and template combination
 * Convenience function for common validation pattern
 * 
 * @param {string} shop - Shop domain
 * @param {string} template - Template name
 * @returns {Object} Validation result with details
 * 
 * @example
 * validateShopTemplate("store.myshopify.com", "product");
 * // { valid: true, errors: [] }
 * 
 * validateShopTemplate("invalid", "random");
 * // { valid: false, errors: ["Invalid shop domain", "Invalid template name"] }
 */
function validateShopTemplate(shop, template) {
  const errors = [];

  if (!isValidShopDomain(shop)) {
    errors.push('Invalid shop domain');
  }

  if (!isValidTemplate(template)) {
    errors.push('Invalid template name');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  isValidUrl,
  isValidShopDomain,
  isValidTemplate,
  sanitizeTemplateName,
  isValidCssSize,
  isValidISODate,
  validateShopTemplate
};