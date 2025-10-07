import request from "supertest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import app from "../app.js";
import CriticalCssModel from "../models/CriticalCssModel.js";

let mongoServer;

// ============================================================================
// Setup & Teardown
// ============================================================================
beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
});

afterEach(async () => {
  // Clear collections after each test for isolation
  await CriticalCssModel.deleteMany({});
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

// ============================================================================
// Model Tests: CriticalCssModel.js
// ============================================================================
describe("CriticalCssModel - Validation", () => {
  
  describe("Shop Validation", () => {
    it("should accept valid myshopify.com domain", async () => {
      const doc = new CriticalCssModel({
        shop: "store.myshopify.com",
        template: "product",
        url: "https://store.myshopify.com/products/test",
        critical_css: "body{margin:0}"
      });
      await expect(doc.save()).resolves.toBeDefined();
    });

    it("should reject invalid shop domain", async () => {
      const doc = new CriticalCssModel({
        shop: "store.com",
        template: "product",
        url: "https://store.com/products/test",
        critical_css: "body{margin:0}"
      });
      await expect(doc.save()).rejects.toThrow(/Invalid shop domain/);
    });

    it("should reject shop without subdomain", async () => {
      const doc = new CriticalCssModel({
        shop: "myshopify.com",
        template: "product",
        url: "https://myshopify.com/products/test",
        critical_css: "body{margin:0}"
      });
      await expect(doc.save()).rejects.toThrow(/Invalid shop domain/);
    });
  });

  describe("Template Validation", () => {
    it("should accept standard template: product", async () => {
      const doc = new CriticalCssModel({
        shop: "store.myshopify.com",
        template: "product",
        url: "https://store.myshopify.com/products/test",
        critical_css: "body{margin:0}"
      });
      await expect(doc.save()).resolves.toBeDefined();
    });

    it("should accept namespaced template: page.about-us", async () => {
      const doc = new CriticalCssModel({
        shop: "store.myshopify.com",
        template: "page.about-us",
        url: "https://store.myshopify.com/pages/about-us",
        critical_css: "body{margin:0}"
      });
      await expect(doc.save()).resolves.toBeDefined();
    });

    it("should accept JSON template: product.json", async () => {
      const doc = new CriticalCssModel({
        shop: "store.myshopify.com",
        template: "product.json",
        url: "https://store.myshopify.com/products/test.json",
        critical_css: "body{margin:0}"
      });
      await expect(doc.save()).resolves.toBeDefined();
    });

    it("should reject invalid template name", async () => {
      const doc = new CriticalCssModel({
        shop: "store.myshopify.com",
        template: "random@invalid",
        url: "https://store.myshopify.com/",
        critical_css: "body{margin:0}"
      });
      await expect(doc.save()).rejects.toThrow(/Invalid template name/);
    });
  });
});

describe("CriticalCssModel - Database Operations", () => {
  
  describe("Upsert Critical CSS", () => {
    it("should insert new entry if none exists", async () => {
      const result = await CriticalCssModel.upsertCriticalCss(
        "store.myshopify.com",
        "product",
        "https://store.myshopify.com/products/test",
        "body{margin:0;padding:0}"
      );

      expect(result).toBeDefined();
      expect(result.shop).toBe("store.myshopify.com");
      expect(result.template).toBe("product");
      expect(result.critical_css).toBe("body{margin:0;padding:0}");
      expect(result.metadata.size).toBeGreaterThan(0);
    });

    it("should update existing entry with new CSS", async () => {
      // Insert initial
      await CriticalCssModel.upsertCriticalCss(
        "store.myshopify.com",
        "product",
        "https://store.myshopify.com/products/test",
        "body{margin:0}"
      );

      // Update
      const result = await CriticalCssModel.upsertCriticalCss(
        "store.myshopify.com",
        "product",
        "https://store.myshopify.com/products/test",
        "body{margin:0;padding:10px}"
      );

      expect(result.critical_css).toBe("body{margin:0;padding:10px}");
      
      // Verify only one document exists
      const count = await CriticalCssModel.countDocuments({
        shop: "store.myshopify.com",
        template: "product"
      });
      expect(count).toBe(1);
    });

    it("should add error to errorHistory when failing", async () => {
      const errorMsg = "Puppeteer timeout";
      
      const result = await CriticalCssModel.upsertCriticalCss(
        "store.myshopify.com",
        "product",
        "https://store.myshopify.com/products/test",
        null,
        errorMsg
      );

      expect(result.metadata.error).toBe(errorMsg);
      expect(result.errorHistory).toHaveLength(1);
      expect(result.errorHistory[0].message).toBe(errorMsg);
    });
  });

  describe("Enable/Disable Operations", () => {
    beforeEach(async () => {
      await CriticalCssModel.upsertCriticalCss(
        "store.myshopify.com",
        "product",
        "https://store.myshopify.com/products/test",
        "body{margin:0}"
      );
    });

    it("should disable critical CSS", async () => {
      const result = await CriticalCssModel.toggleEnabled(
        "store.myshopify.com",
        "product",
        false
      );

      expect(result.enabled).toBe(false);
    });

    it("should enable critical CSS", async () => {
      // First disable
      await CriticalCssModel.toggleEnabled(
        "store.myshopify.com",
        "product",
        false
      );

      // Then enable
      const result = await CriticalCssModel.toggleEnabled(
        "store.myshopify.com",
        "product",
        true
      );

      expect(result.enabled).toBe(true);
    });
  });

  describe("Find Queries", () => {
    beforeEach(async () => {
      // Seed test data
      await CriticalCssModel.upsertCriticalCss(
        "store1.myshopify.com",
        "product",
        "https://store1.myshopify.com/products/test",
        "body{margin:0}"
      );

      await CriticalCssModel.upsertCriticalCss(
        "store1.myshopify.com",
        "collection",
        "https://store1.myshopify.com/collections/all",
        "body{padding:0}"
      );
    });

    it("should find by shop and template", async () => {
      const result = await CriticalCssModel.findByShopAndTemplate(
        "store1.myshopify.com",
        "product"
      );

      expect(result).toBeDefined();
      expect(result.shop).toBe("store1.myshopify.com");
      expect(result.template).toBe("product");
      expect(result.metadata.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO format
    });

    it("should return null if not found", async () => {
      const result = await CriticalCssModel.findByShopAndTemplate(
        "nonexistent.myshopify.com",
        "product"
      );

      expect(result).toBeNull();
    });

    it("should find stale templates older than N days", async () => {
      // Create old entry
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 40); // 40 days ago

      await CriticalCssModel.create({
        shop: "oldstore.myshopify.com",
        template: "product",
        url: "https://oldstore.myshopify.com/products/test",
        critical_css: "body{margin:0}",
        metadata: {
          generatedAt: oldDate,
          size: 100
        }
      });

      const staleTemplates = await CriticalCssModel.findStaleTemplates(30);

      expect(staleTemplates.length).toBeGreaterThan(0);
      expect(staleTemplates.some(t => t.shop === "oldstore.myshopify.com")).toBe(true);
    });

    it("should find problematic templates with error history", async () => {
      // Create template with errors
      await CriticalCssModel.upsertCriticalCss(
        "problem.myshopify.com",
        "product",
        "https://problem.myshopify.com/products/test",
        null,
        "Error 1"
      );

      await CriticalCssModel.upsertCriticalCss(
        "problem.myshopify.com",
        "product",
        "https://problem.myshopify.com/products/test",
        null,
        "Error 2"
      );

      const problematic = await CriticalCssModel.findProblematicTemplates(2);

      expect(problematic.length).toBeGreaterThan(0);
      expect(problematic[0].shop).toBe("problem.myshopify.com");
      expect(problematic[0].errorCount).toBeGreaterThanOrEqual(2);
    });
  });
});

// ============================================================================
// Controller Tests: CriticalCssController.js
// ============================================================================
describe("CriticalCssController - Endpoints", () => {
  
  describe("POST /api/critical-css/generate", () => {
    it("should reject invalid shop domain", async () => {
      const res = await request(app)
        .post("/api/critical-css/generate")
        .send({ 
          shop: "invalid.com", 
          template: "product", 
          url: "https://example.com" 
        });

      expect(res.body.ok).toBe(false);
      expect(res.body.error).toMatch(/Invalid shop domain/);
    });

    it("should reject invalid template name", async () => {
      const res = await request(app)
        .post("/api/critical-css/generate")
        .send({ 
          shop: "store.myshopify.com", 
          template: "invalid@template", 
          url: "https://example.com" 
        });

      expect(res.body.ok).toBe(false);
      expect(res.body.error).toMatch(/Invalid template/);
    });

    it("should generate and save critical css", async () => {
      const res = await request(app)
        .post("/api/critical-css/generate")
        .send({ 
          shop: "store.myshopify.com", 
          template: "product", 
          url: "https://store.myshopify.com/products/test" 
        });

      expect(res.body.ok).toBe(true);
      expect(res.body.css).toBeDefined();
      expect(res.body.metadata).toBeDefined();
      expect(res.body.metadata.size).toBeGreaterThan(0);
      expect(res.body.metadata.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("should return error on generation failure", async () => {
      // Use invalid URL to trigger error
      const res = await request(app)
        .post("/api/critical-css/generate")
        .send({ 
          shop: "store.myshopify.com", 
          template: "product", 
          url: "invalid-url" 
        });

      expect(res.body.ok).toBe(false);
      expect(res.body.error).toBeDefined();
    });
  });

  describe("GET /api/critical-css/get/:shop/:template", () => {
    beforeEach(async () => {
      await CriticalCssModel.upsertCriticalCss(
        "store.myshopify.com",
        "product",
        "https://store.myshopify.com/products/test",
        "body{margin:0;padding:0}"
      );
    });

    it("should return CSS string if enabled", async () => {
      const res = await request(app)
        .get("/api/critical-css/get/store.myshopify.com/product");

      expect(res.body.ok).toBe(true);
      expect(res.body.css).toBe("body{margin:0;padding:0}");
      expect(res.body.enabled).toBe(true);
    });

    it("should return disabled status if disabled", async () => {
      await CriticalCssModel.toggleEnabled("store.myshopify.com", "product", false);

      const res = await request(app)
        .get("/api/critical-css/get/store.myshopify.com/product");

      expect(res.body.ok).toBe(true);
      expect(res.body.enabled).toBe(false);
      expect(res.body.css).toBeUndefined();
    });

    it("should return 404 if not found", async () => {
      const res = await request(app)
        .get("/api/critical-css/get/nonexistent.myshopify.com/product");

      expect(res.body.ok).toBe(false);
      expect(res.body.error).toMatch(/not found/i);
    });
  });

  describe("POST /api/critical-css/disable", () => {
    beforeEach(async () => {
      await CriticalCssModel.upsertCriticalCss(
        "store.myshopify.com",
        "product",
        "https://store.myshopify.com/products/test",
        "body{margin:0}"
      );
    });

    it("should disable critical CSS", async () => {
      const res = await request(app)
        .post("/api/critical-css/disable")
        .send({ 
          shop: "store.myshopify.com", 
          template: "product" 
        });

      expect(res.body.ok).toBe(true);
      expect(res.body.enabled).toBe(false);

      // Verify in DB
      const doc = await CriticalCssModel.findByShopAndTemplate(
        "store.myshopify.com",
        "product"
      );
      expect(doc.enabled).toBe(false);
    });

    it("should return error if template not found", async () => {
      const res = await request(app)
        .post("/api/critical-css/disable")
        .send({ 
          shop: "nonexistent.myshopify.com", 
          template: "product" 
        });

      expect(res.body.ok).toBe(false);
      expect(res.body.error).toMatch(/not found/i);
    });
  });

  describe("POST /api/critical-css/regenerate", () => {
    beforeEach(async () => {
      await CriticalCssModel.upsertCriticalCss(
        "store.myshopify.com",
        "product",
        "https://store.myshopify.com/products/test",
        "body{margin:0}"
      );
    });

    it("should regenerate and update CSS", async () => {
      const res = await request(app)
        .post("/api/critical-css/regenerate")
        .send({ 
          shop: "store.myshopify.com", 
          template: "product",
          url: "https://store.myshopify.com/products/test"
        });

      expect(res.body.ok).toBe(true);
      expect(res.body.css).toBeDefined();
      expect(res.body.metadata.generatedAt).toBeDefined();
    });
  });

  describe("GET /api/critical-css/metadata/:shop/:template", () => {
    beforeEach(async () => {
      await CriticalCssModel.upsertCriticalCss(
        "store.myshopify.com",
        "product",
        "https://store.myshopify.com/products/test",
        "body{margin:0;padding:0}"
      );
    });

    it("should return only metadata without CSS body", async () => {
      const res = await request(app)
        .get("/api/critical-css/metadata/store.myshopify.com/product");

      expect(res.body.ok).toBe(true);
      expect(res.body.metadata).toBeDefined();
      expect(res.body.metadata.size).toBeGreaterThan(0);
      expect(res.body.metadata.generatedAt).toBeDefined();
      expect(res.body.css).toBeUndefined(); // Should NOT return CSS
    });
  });

  describe("GET /api/critical-css/screenshot (Dev Only)", () => {
    it("should return screenshot path or error", async () => {
      const res = await request(app)
        .get("/api/critical-css/screenshot")
        .query({ url: "https://example.com" });

      // In test environment, might be disabled or return error
      expect(res.body.ok).toBeDefined();
      
      if (res.body.ok) {
        expect(res.body.path).toBeDefined();
      } else {
        expect(res.body.error).toBeDefined();
      }
    });

    it("should reject missing URL parameter", async () => {
      const res = await request(app)
        .get("/api/critical-css/screenshot");

      expect(res.body.ok).toBe(false);
      expect(res.body.error).toMatch(/url.*required/i);
    });
  });
});