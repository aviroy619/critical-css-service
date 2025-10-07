//// src/services/BunnyCDNService.js
//
import axios from 'axios';
import LoggerService from '../logs/Logger.js';

class BunnyCDNService {
  constructor() {
    this.apiKey = process.env.BUNNY_API_KEY;
    this.storageZone = process.env.BUNNY_STORAGE_ZONE; // e.g., 'rabbitloader-css'
    this.cdnUrl = process.env.BUNNY_CDN_URL; // e.g., 'https://rabbitloader-css.b-cdn.net'
    this.logger = LoggerService.child({ service: 'BunnyCDN' });
  }

  /**
   * Upload CSS file to Bunny CDN
   * @param {string} shop - Shop domain
   * @param {string} template - Template name
   * @param {string} css - CSS content
   * @returns {Promise<string>} CDN URL
   */
  async uploadCSS(shop, template, css) {
    try {
      const fileName = `${shop}/${template}.css`;
      const uploadUrl = `https://storage.bunnycdn.com/${this.storageZone}/${fileName}`;

      this.logger.debug(`Uploading CSS to Bunny CDN: ${fileName}`);

      await axios.put(uploadUrl, css, {
        headers: {
          'AccessKey': this.apiKey,
          'Content-Type': 'text/css'
        }
      });

      const cdnUrl = `${this.cdnUrl}/${fileName}`;
      
      this.logger.info(`CSS uploaded successfully to CDN`, {
        shop,
        template,
        url: cdnUrl,
        size: Buffer.byteLength(css, 'utf8')
      });

      return cdnUrl;

    } catch (error) {
      this.logger.error(`Failed to upload CSS to Bunny CDN`, {
        shop,
        template,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Delete CSS file from Bunny CDN
   * @param {string} shop - Shop domain
   * @param {string} template - Template name
   */
  async deleteCSS(shop, template) {
    try {
      const fileName = `${shop}/${template}.css`;
      const deleteUrl = `https://storage.bunnycdn.com/${this.storageZone}/${fileName}`;

      await axios.delete(deleteUrl, {
        headers: {
          'AccessKey': this.apiKey
        }
      });

      this.logger.info(`CSS deleted from CDN`, { shop, template });

    } catch (error) {
      this.logger.warn(`Failed to delete CSS from Bunny CDN`, {
        shop,
        template,
        error: error.message
      });
    }
  }

  /**
   * Purge CDN cache for a file
   * @param {string} url - Full CDN URL to purge
   */
  async purgeCache(url) {
    try {
      await axios.post(
        `https://api.bunny.net/purge`,
        { url },
        {
          headers: {
            'AccessKey': this.apiKey,
            'Content-Type': 'application/json'
          }
        }
      );

      this.logger.info(`CDN cache purged for ${url}`);

    } catch (error) {
      this.logger.warn(`Failed to purge CDN cache`, {
        url,
        error: error.message
      });
    }
  }
}

export default new BunnyCDNService();