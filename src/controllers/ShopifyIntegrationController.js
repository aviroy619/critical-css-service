// src/controllers/ShopifyIntegrationController.js
import ShopifyShop from '../models/ShopifyShopModel.js';
import CSSProcessor from '../services/CSSProcessor.js';
import BunnyCDNService from '../services/BunnyCDNService.js';
import LoggerService from '../logs/Logger.js';

const cssProcessor = new CSSProcessor();
const logger = LoggerService.child({ service: 'ShopifyIntegration' });

class ShopifyIntegrationController {
  
  /**
   * Generate critical CSS for all templates in a shop
   * POST /api/shopify/generate-all-css
   * Body: { shop: "mystore.myshopify.com" }
   */
  async generateAllCSSForShop(req, res) {
    try {
      const { shop } = req.body;

      if (!shop) {
        return res.status(400).json({
          ok: false,
          error: 'Shop parameter required'
        });
      }

      // Get shop data with template groups
      const shopData = await ShopifyShop.findOne({ shop });
      
      if (!shopData?.site_structure?.template_groups) {
        return res.status(404).json({
          ok: false,
          error: 'No site structure found. Run site analysis first in Shopify app.'
        });
      }

      const templateGroups = shopData.site_structure.template_groups;
      const templates = templateGroups instanceof Map 
        ? Array.from(templateGroups.entries())
        : Object.entries(templateGroups);

      const results = [];
      const errors = [];

      // Process each template
      for (const [templateName, group] of templates) {
        if (!group.sample_page) {
          logger.warn(`No sample page for template ${templateName}, skipping`);
          continue;
        }

        try {
          const url = group.sample_page.startsWith('http') 
            ? group.sample_page 
            : `https://${shop}${group.sample_page}`;

          logger.info(`Generating critical CSS for ${shop}/${templateName}`);

          // Generate CSS
          const result = await cssProcessor.generateCriticalCSS({
            url,
            shop,
            template: templateName
          });

          if (!result.css) {
            throw new Error(result.error || 'No CSS generated');
          }

          // Upload to Bunny CDN
          const cdnUrl = await BunnyCDNService.uploadCSS(shop, templateName, result.css);

          // Save to MongoDB
          if (!shopData.critical_css) {
            shopData.critical_css = new Map();
          }

          shopData.critical_css.set(templateName, {
            css: result.css,
            size: Buffer.byteLength(result.css, 'utf8'),
            generated_at: new Date(),
            cdn_url: cdnUrl,
            enabled: true
          });

          results.push({
            template: templateName,
            success: true,
            cdn_url: cdnUrl,
            size: result.metadata.size,
            page_count: group.count
          });

          // Wait 2 seconds between templates to avoid overloading
          await new Promise(resolve => setTimeout(resolve, 2000));

        } catch (error) {
          logger.error(`Failed to generate CSS for ${templateName}`, {
            error: error.message
          });
          
          errors.push({
            template: templateName,
            error: error.message
          });
        }
      }

      // Save updated shop data
      await shopData.save();

      return res.json({
        ok: true,
        message: `Generated critical CSS for ${results.length} templates`,
        results,
        errors,
        summary: {
          total_templates: templates.length,
          successful: results.length,
          failed: errors.length
        }
      });

    } catch (error) {
      logger.error('Error in generateAllCSSForShop', { error: error.message });
      return res.status(500).json({
        ok: false,
        error: error.message
      });
    }
  }

  /**
   * Get critical CSS CDN URL for a template
   * GET /api/shopify/:shop/:template/css-url
   */
  async getCSSUrl(req, res) {
    try {
      const { shop, template } = req.params;

      const shopData = await ShopifyShop.findOne({ shop });
      
      if (!shopData?.critical_css) {
        return res.status(404).json({
          ok: false,
          error: 'No critical CSS found for this shop'
        });
      }

      const templateCSS = shopData.critical_css.get(template);
      
      if (!templateCSS || !templateCSS.enabled) {
        return res.status(404).json({
          ok: false,
          error: 'No critical CSS found for this template'
        });
      }

      return res.json({
        ok: true,
        cdn_url: templateCSS.cdn_url,
        size: templateCSS.size,
        generated_at: templateCSS.generated_at
      });

    } catch (error) {
      logger.error('Error in getCSSUrl', { error: error.message });
      return res.status(500).json({
        ok: false,
        error: error.message
      });
    }
  }

  /**
   * Get all templates with CSS status
   * GET /api/shopify/:shop/templates
   */
  async getTemplateStatus(req, res) {
    try {
      const { shop } = req.params;

      const shopData = await ShopifyShop.findOne({ shop });
      
      if (!shopData) {
        return res.status(404).json({
          ok: false,
          error: 'Shop not found'
        });
      }

      const templateGroups = shopData.site_structure?.template_groups;
      if (!templateGroups) {
        return res.json({
          ok: true,
          templates: []
        });
      }

      const templates = templateGroups instanceof Map 
        ? Array.from(templateGroups.entries())
        : Object.entries(templateGroups);

      const status = templates.map(([name, group]) => {
        const cssData = shopData.critical_css?.get(name);
        
        return {
          template: name,
          page_count: group.count,
          sample_page: group.sample_page,
          has_css: !!cssData,
          enabled: cssData?.enabled || false,
          cdn_url: cssData?.cdn_url || null,
          size: cssData?.size || 0,
          generated_at: cssData?.generated_at || null
        };
      });

      return res.json({
        ok: true,
        shop,
        templates: status
      });

    } catch (error) {
      logger.error('Error in getTemplateStatus', { error: error.message });
      return res.status(500).json({
        ok: false,
        error: error.message
      });
    }
  }
}

export default new ShopifyIntegrationController();