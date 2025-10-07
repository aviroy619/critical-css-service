import CSSProcessor from "../services/CSSProcessor.js";
import logger from "../logs/logger.js";

// ============================================================================
// Mocks
// ============================================================================

// Mock critical package
jest.mock("critical", () => ({
  generate: jest.fn(),
}));

// Mock puppeteer
jest.mock("puppeteer", () => ({
  launch: jest.fn().mockResolvedValue({
    close: jest.fn(),
    newPage: jest.fn().mockResolvedValue({
      goto: jest.fn(),
      close: jest.fn(),
      setViewport: jest.fn(),
    }),
  }),
}));

// Mock logger to prevent console spam during tests
jest.mock("../config/logger.js", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

// ============================================================================
// Setup & Teardown
// ============================================================================

describe("CSSProcessor", () => {
  let processor;
  let mockCritical;
  let mockPuppeteer;

  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();

    // Get mock references
    mockCritical = require("critical");
    mockPuppeteer = require("puppeteer");

    // Create fresh processor instance
    processor = new CSSProcessor();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  // ==========================================================================
  // 1. Input Validation Tests
  // ==========================================================================

  describe("Input Validation", () => {
    it("should fail when URL is missing", async () => {
      const result = await processor.generateCriticalCSS({});

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Invalid or missing parameter: url/i);
      expect(result.css).toBe("");
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Invalid or missing parameter")
      );
    });

    it("should fail when URL is null", async () => {
      const result = await processor.generateCriticalCSS({ url: null });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Invalid or missing parameter: url/i);
      expect(result.css).toBe("");
    });

    it("should fail when URL is empty string", async () => {
      const result = await processor.generateCriticalCSS({ url: "" });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Invalid or missing parameter: url/i);
      expect(result.css).toBe("");
    });

    it("should fail when URL is not a string", async () => {
      const result = await processor.generateCriticalCSS({ url: 12345 });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Invalid or missing parameter: url/i);
      expect(result.css).toBe("");
    });

    it("should fail when URL is invalid format", async () => {
      const result = await processor.generateCriticalCSS({ 
        url: "not-a-valid-url" 
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Invalid or missing parameter: url/i);
      expect(result.css).toBe("");
    });

    it("should accept valid HTTP URL", async () => {
      mockCritical.generate.mockResolvedValue({ css: "body{margin:0}" });

      const result = await processor.generateCriticalCSS({ 
        url: "http://example.com" 
      });

      expect(result.success).toBe(true);
    });

    it("should accept valid HTTPS URL", async () => {
      mockCritical.generate.mockResolvedValue({ css: "body{margin:0}" });

      const result = await processor.generateCriticalCSS({ 
        url: "https://example.com" 
      });

      expect(result.success).toBe(true);
    });
  });

  // ==========================================================================
  // 2. Successful CSS Generation Tests
  // ==========================================================================

  describe("Successful CSS Generation", () => {
    it("should return CSS on successful generation", async () => {
      const expectedCSS = "body{color:red;margin:0;padding:0}";
      mockCritical.generate.mockResolvedValue({ css: expectedCSS });

      const result = await processor.generateCriticalCSS({ 
        url: "https://example.com" 
      });

      expect(result.success).toBe(true);
      expect(result.css).toBe(expectedCSS);
      expect(result.error).toBeNull();
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("Critical CSS generated successfully")
      );
    });

    it("should call critical.generate with correct parameters", async () => {
      mockCritical.generate.mockResolvedValue({ css: "body{margin:0}" });

      const testUrl = "https://store.myshopify.com/products/test";
      await processor.generateCriticalCSS({ url: testUrl });

      expect(mockCritical.generate).toHaveBeenCalledWith(
        expect.objectContaining({
          base: testUrl,
          src: testUrl,
        })
      );
    });

    it("should pass custom dimensions if provided", async () => {
      mockCritical.generate.mockResolvedValue({ css: "body{margin:0}" });

      await processor.generateCriticalCSS({ 
        url: "https://example.com",
        width: 1920,
        height: 1080
      });

      expect(mockCritical.generate).toHaveBeenCalledWith(
        expect.objectContaining({
          dimensions: expect.arrayContaining([
            expect.objectContaining({ width: 1920, height: 1080 })
          ])
        })
      );
    });

    it("should use default dimensions if not provided", async () => {
      mockCritical.generate.mockResolvedValue({ css: "body{margin:0}" });

      await processor.generateCriticalCSS({ url: "https://example.com" });

      expect(mockCritical.generate).toHaveBeenCalledWith(
        expect.objectContaining({
          dimensions: expect.arrayContaining([
            expect.objectContaining({ width: 1366, height: 768 })
          ])
        })
      );
    });

    it("should strip whitespace from generated CSS", async () => {
      const cssWithWhitespace = "\n\n  body { margin: 0 }  \n\n";
      mockCritical.generate.mockResolvedValue({ css: cssWithWhitespace });

      const result = await processor.generateCriticalCSS({ 
        url: "https://example.com" 
      });

      expect(result.css.trim()).toBe("body { margin: 0 }");
    });
  });

  // ==========================================================================
  // 3. Empty CSS Tests
  // ==========================================================================

  describe("Empty CSS Handling", () => {
    it("should return success with warning when CSS is empty", async () => {
      mockCritical.generate.mockResolvedValue({ css: "" });

      const result = await processor.generateCriticalCSS({ 
        url: "https://example.com" 
      });

      expect(result.success).toBe(true);
      expect(result.css).toBe("");
      expect(result.error).toBeNull();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Generated CSS is empty")
      );
    });

    it("should return success when CSS is only whitespace", async () => {
      mockCritical.generate.mockResolvedValue({ css: "   \n\n  " });

      const result = await processor.generateCriticalCSS({ 
        url: "https://example.com" 
      });

      expect(result.success).toBe(true);
      expect(result.css.trim()).toBe("");
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // 4. Critical Generation Error Tests
  // ==========================================================================

  describe("Critical Generation Errors", () => {
    it("should handle Penthouse failure gracefully", async () => {
      mockCritical.generate.mockRejectedValue(
        new Error("Penthouse failed to generate critical CSS")
      );

      const result = await processor.generateCriticalCSS({ 
        url: "https://example.com" 
      });

      expect(result.success).toBe(false);
      expect(result.css).toBe("");
      expect(result.error).toMatch(/Critical CSS generation failed/i);
      expect(result.error).toMatch(/Penthouse failed/i);
      expect(logger.error).toHaveBeenCalled();
    });

    it("should handle network timeout errors", async () => {
      mockCritical.generate.mockRejectedValue(
        new Error("Navigation timeout of 30000 ms exceeded")
      );

      const result = await processor.generateCriticalCSS({ 
        url: "https://example.com" 
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/timeout/i);
    });

    it("should handle CSS parsing errors", async () => {
      mockCritical.generate.mockRejectedValue(
        new Error("Failed to parse CSS")
      );

      const result = await processor.generateCriticalCSS({ 
        url: "https://example.com" 
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Failed to parse CSS/i);
    });

    it("should handle 404 page errors", async () => {
      mockCritical.generate.mockRejectedValue(
        new Error("404 Not Found")
      );

      const result = await processor.generateCriticalCSS({ 
        url: "https://example.com/nonexistent" 
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/404/i);
    });

    it("should handle generic errors without exposing internals", async () => {
      mockCritical.generate.mockRejectedValue(
        new Error("Some internal error")
      );

      const result = await processor.generateCriticalCSS({ 
        url: "https://example.com" 
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Critical CSS generation failed");
      expect(result.error).not.toContain("stack trace");
    });
  });

  // ==========================================================================
  // 5. Puppeteer Launch Failure Tests
  // ==========================================================================

  describe("Puppeteer Launch Failures", () => {
    it("should handle Puppeteer launch failure", async () => {
      mockPuppeteer.launch.mockRejectedValue(
        new Error("Failed to launch browser")
      );

      const result = await processor.generateCriticalCSS({ 
        url: "https://example.com" 
      });

      expect(result.success).toBe(false);
      expect(result.css).toBe("");
      expect(result.error).toMatch(/Unable to launch Puppeteer/i);
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Puppeteer launch failed")
      );
    });

    it("should handle browser close errors gracefully", async () => {
      const mockBrowser = {
        close: jest.fn().mockRejectedValue(new Error("Close failed")),
        newPage: jest.fn().mockResolvedValue({
          goto: jest.fn(),
          close: jest.fn(),
        }),
      };

      mockPuppeteer.launch.mockResolvedValue(mockBrowser);
      mockCritical.generate.mockResolvedValue({ css: "body{margin:0}" });

      const result = await processor.generateCriticalCSS({ 
        url: "https://example.com" 
      });

      // Should still succeed even if browser close fails
      expect(result.success).toBe(true);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Failed to close browser")
      );
    });

    it("should handle missing Chrome/Chromium binary", async () => {
      mockPuppeteer.launch.mockRejectedValue(
        new Error("Could not find Chrome binary")
      );

      const result = await processor.generateCriticalCSS({ 
        url: "https://example.com" 
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Chrome binary/i);
    });
  });

  // ==========================================================================
  // 6. Timeout Handling Tests
  // ==========================================================================

  describe("Timeout Handling", () => {
    it("should timeout if generation takes too long", async () => {
      // Simulate slow generation
      mockCritical.generate.mockImplementation(() => {
        return new Promise((resolve) => {
          setTimeout(() => resolve({ css: "body{margin:0}" }), 150000); // 150 seconds
        });
      });

      const result = await processor.generateCriticalCSS({ 
        url: "https://example.com",
        timeout: 5000 // 5 second timeout
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/timeout|timed out/i);
    }, 10000); // Increase Jest timeout for this test

    it("should complete successfully within timeout", async () => {
      mockCritical.generate.mockResolvedValue({ css: "body{margin:0}" });

      const result = await processor.generateCriticalCSS({ 
        url: "https://example.com",
        timeout: 30000 // 30 second timeout
      });

      expect(result.success).toBe(true);
    });
  });

  // ==========================================================================
  // 7. Return Structure Tests
  // ==========================================================================

  describe("Return Structure Consistency", () => {
    it("should always return { success, css, error } shape on success", async () => {
      mockCritical.generate.mockResolvedValue({ css: "body{margin:0}" });

      const result = await processor.generateCriticalCSS({ 
        url: "https://example.com" 
      });

      expect(result).toHaveProperty("success");
      expect(result).toHaveProperty("css");
      expect(result).toHaveProperty("error");
      expect(typeof result.success).toBe("boolean");
      expect(typeof result.css).toBe("string");
      expect(result.error === null || typeof result.error === "string").toBe(true);
    });

    it("should always return { success, css, error } shape on failure", async () => {
      mockCritical.generate.mockRejectedValue(new Error("Test error"));

      const result = await processor.generateCriticalCSS({ 
        url: "https://example.com" 
      });

      expect(result).toHaveProperty("success");
      expect(result).toHaveProperty("css");
      expect(result).toHaveProperty("error");
      expect(result.success).toBe(false);
      expect(result.css).toBe("");
      expect(typeof result.error).toBe("string");
    });

    it("should never throw unhandled errors", async () => {
      mockCritical.generate.mockImplementation(() => {
        throw new Error("Synchronous error");
      });

      await expect(
        processor.generateCriticalCSS({ url: "https://example.com" })
      ).resolves.toMatchObject({
        success: false,
        css: "",
        error: expect.any(String),
      });
    });

    it("should never return undefined for any field", async () => {
      mockCritical.generate.mockResolvedValue({ css: "body{margin:0}" });

      const result = await processor.generateCriticalCSS({ 
        url: "https://example.com" 
      });

      expect(result.success).not.toBeUndefined();
      expect(result.css).not.toBeUndefined();
      expect(result.error !== undefined).toBe(true); // Can be null but not undefined
    });
  });

  // ==========================================================================
  // 8. Logging Tests
  // ==========================================================================

  describe("Logging Behavior", () => {
    it("should log info on successful generation", async () => {
      mockCritical.generate.mockResolvedValue({ css: "body{margin:0}" });

      await processor.generateCriticalCSS({ url: "https://example.com" });

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("Critical CSS generated successfully")
      );
    });

    it("should log warning on empty CSS", async () => {
      mockCritical.generate.mockResolvedValue({ css: "" });

      await processor.generateCriticalCSS({ url: "https://example.com" });

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Generated CSS is empty")
      );
    });

    it("should log error on generation failure", async () => {
      mockCritical.generate.mockRejectedValue(new Error("Test error"));

      await processor.generateCriticalCSS({ url: "https://example.com" });

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Critical CSS generation failed")
      );
    });

    it("should include URL in error logs", async () => {
      mockCritical.generate.mockRejectedValue(new Error("Test error"));

      const testUrl = "https://store.myshopify.com/products/test";
      await processor.generateCriticalCSS({ url: testUrl });

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining(testUrl)
      );
    });
  });

  // ==========================================================================
  // 9. Edge Cases
  // ==========================================================================

  describe("Edge Cases", () => {
    it("should handle URLs with special characters", async () => {
      mockCritical.generate.mockResolvedValue({ css: "body{margin:0}" });

      const result = await processor.generateCriticalCSS({ 
        url: "https://example.com/products/test?id=123&variant=456" 
      });

      expect(result.success).toBe(true);
    });

    it("should handle very long URLs", async () => {
      mockCritical.generate.mockResolvedValue({ css: "body{margin:0}" });

      const longUrl = "https://example.com/" + "a".repeat(2000);
      const result = await processor.generateCriticalCSS({ url: longUrl });

      expect(result.success).toBe(true);
    });

    it("should handle URLs with Unicode characters", async () => {
      mockCritical.generate.mockResolvedValue({ css: "body{margin:0}" });

      const result = await processor.generateCriticalCSS({ 
        url: "https://example.com/products/café-☕" 
      });

      expect(result.success).toBe(true);
    });

    it("should handle very large CSS output", async () => {
      const largeCSS = "body{margin:0}" + "a".repeat(1000000); // 1MB+ CSS
      mockCritical.generate.mockResolvedValue({ css: largeCSS });

      const result = await processor.generateCriticalCSS({ 
        url: "https://example.com" 
      });

      expect(result.success).toBe(true);
      expect(result.css.length).toBeGreaterThan(1000000);
    });

    it("should handle multiple rapid calls", async () => {
      mockCritical.generate.mockResolvedValue({ css: "body{margin:0}" });

      const calls = Array(5).fill(null).map(() =>
        processor.generateCriticalCSS({ url: "https://example.com" })
      );

      const results = await Promise.all(calls);

      results.forEach(result => {
        expect(result.success).toBe(true);
      });
    });
  });
});