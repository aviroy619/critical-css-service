import ScreenshotService from "../services/ScreenshotService.js";
import { getPool, shutdownPool } from "../services/BrowserPool.js";
import logger from "../logs/logger.js";
import fs from "fs/promises";

// ============================================================================
// Mocks
// ============================================================================

// Mock BrowserPool
jest.mock("../services/BrowserPool.js", () => {
  const mockPool = {
    acquire: jest.fn(),
    release: jest.fn(),
    drain: jest.fn(),
    clear: jest.fn(),
  };

  return {
    getPool: jest.fn(() => mockPool),
    shutdownPool: jest.fn(),
  };
});

// Mock logger
jest.mock("../config/logger.js", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

// Mock fs/promises for file operations
jest.mock("fs/promises", () => ({
  mkdir: jest.fn().mockResolvedValue(undefined),
  writeFile: jest.fn().mockResolvedValue(undefined),
  access: jest.fn().mockResolvedValue(undefined),
}));

// ============================================================================
// Setup & Teardown
// ============================================================================

describe("ScreenshotService", () => {
  let mockPool;
  let fakeBrowser;
  let fakePage;

  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();

    // Setup fake page
    fakePage = {
      setViewport: jest.fn().mockResolvedValue(undefined),
      setUserAgent: jest.fn().mockResolvedValue(undefined),
      goto: jest.fn().mockResolvedValue(undefined),
      screenshot: jest.fn().mockResolvedValue(Buffer.from("fake-screenshot-data")),
      close: jest.fn().mockResolvedValue(undefined),
      evaluate: jest.fn().mockResolvedValue(undefined),
    };

    // Setup fake browser
    fakeBrowser = {
      newPage: jest.fn().mockResolvedValue(fakePage),
      close: jest.fn().mockResolvedValue(undefined),
    };

    // Setup mock pool
    mockPool = getPool();
    mockPool.acquire.mockResolvedValue(fakeBrowser);
    mockPool.release.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  // ==========================================================================
  // 1. Input Validation Tests
  // ==========================================================================

  describe("Input Validation", () => {
    it("should reject missing URL", async () => {
      const result = await ScreenshotService.captureScreenshot();

      expect(result.success).toBe(false);
      expect(result.buffer).toBeNull();
      expect(result.path).toBeNull();
      expect(result.error).toMatch(/Invalid or missing URL/i);
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Invalid or missing URL")
      );
    });

    it("should reject null URL", async () => {
      const result = await ScreenshotService.captureScreenshot(null);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Invalid or missing URL/i);
    });

    it("should reject empty string URL", async () => {
      const result = await ScreenshotService.captureScreenshot("");

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Invalid or missing URL/i);
    });

    it("should reject invalid URL format", async () => {
      const result = await ScreenshotService.captureScreenshot("not-a-url");

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Invalid or missing URL/i);
    });

    it("should reject URL without protocol", async () => {
      const result = await ScreenshotService.captureScreenshot("example.com");

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Invalid or missing URL/i);
    });

    it("should accept valid HTTP URL", async () => {
      const result = await ScreenshotService.captureScreenshot("http://example.com");

      expect(result.success).toBe(true);
      expect(mockPool.acquire).toHaveBeenCalled();
    });

    it("should accept valid HTTPS URL", async () => {
      const result = await ScreenshotService.captureScreenshot("https://example.com");

      expect(result.success).toBe(true);
      expect(mockPool.acquire).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // 2. Successful Screenshot (Buffer) Tests
  // ==========================================================================

  describe("Successful Screenshot - Buffer Mode", () => {
    it("should return buffer on successful screenshot", async () => {
      const testBuffer = Buffer.from("test-screenshot-data");
      fakePage.screenshot.mockResolvedValue(testBuffer);

      const result = await ScreenshotService.captureScreenshot("https://example.com");

      expect(result.success).toBe(true);
      expect(result.buffer).toBeInstanceOf(Buffer);
      expect(result.buffer).toEqual(testBuffer);
      expect(result.path).toBeNull();
      expect(result.error).toBeNull();
    });

    it("should call page methods in correct order", async () => {
      await ScreenshotService.captureScreenshot("https://example.com");

      expect(fakePage.setViewport).toHaveBeenCalledBefore(fakePage.goto);
      expect(fakePage.goto).toHaveBeenCalledBefore(fakePage.screenshot);
    });

    it("should set viewport with default dimensions", async () => {
      await ScreenshotService.captureScreenshot("https://example.com");

      expect(fakePage.setViewport).toHaveBeenCalledWith(
        expect.objectContaining({
          width: expect.any(Number),
          height: expect.any(Number),
        })
      );
    });

    it("should set custom viewport dimensions if provided", async () => {
      const options = { width: 1920, height: 1080 };
      await ScreenshotService.captureScreenshot("https://example.com", options);

      expect(fakePage.setViewport).toHaveBeenCalledWith(
        expect.objectContaining({
          width: 1920,
          height: 1080,
        })
      );
    });

    it("should set user agent", async () => {
      await ScreenshotService.captureScreenshot("https://example.com");

      expect(fakePage.setUserAgent).toHaveBeenCalledWith(
        expect.stringContaining("Mozilla")
      );
    });

    it("should navigate to correct URL", async () => {
      const testUrl = "https://store.myshopify.com/products/test";
      await ScreenshotService.captureScreenshot(testUrl);

      expect(fakePage.goto).toHaveBeenCalledWith(
        testUrl,
        expect.objectContaining({
          waitUntil: expect.any(String),
        })
      );
    });

    it("should pass screenshot options to page.screenshot", async () => {
      const options = { fullPage: true, type: "png" };
      await ScreenshotService.captureScreenshot("https://example.com", options);

      expect(fakePage.screenshot).toHaveBeenCalledWith(
        expect.objectContaining({
          fullPage: true,
          type: "png",
        })
      );
    });

    it("should log success message", async () => {
      await ScreenshotService.captureScreenshot("https://example.com");

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("Screenshot captured successfully")
      );
    });
  });

  // ==========================================================================
  // 3. Successful Screenshot (File Path) Tests
  // ==========================================================================

  describe("Successful Screenshot - File Path Mode", () => {
    it("should save screenshot to file path", async () => {
      const testPath = "/tmp/test-screenshot.png";
      const result = await ScreenshotService.captureScreenshot(
        "https://example.com",
        { path: testPath }
      );

      expect(result.success).toBe(true);
      expect(result.buffer).toBeNull();
      expect(result.path).toBe(testPath);
      expect(result.error).toBeNull();
    });

    it("should create directory if it doesn't exist", async () => {
      const testPath = "/tmp/screenshots/test.png";
      await ScreenshotService.captureScreenshot(
        "https://example.com",
        { path: testPath }
      );

      expect(fs.mkdir).toHaveBeenCalledWith(
        expect.stringContaining("/tmp/screenshots"),
        expect.objectContaining({ recursive: true })
      );
    });

    it("should pass path to page.screenshot", async () => {
      const testPath = "/tmp/test.png";
      await ScreenshotService.captureScreenshot(
        "https://example.com",
        { path: testPath }
      );

      expect(fakePage.screenshot).toHaveBeenCalledWith(
        expect.objectContaining({
          path: testPath,
        })
      );
    });

    it("should support relative paths", async () => {
      const testPath = "./screenshots/test.png";
      const result = await ScreenshotService.captureScreenshot(
        "https://example.com",
        { path: testPath }
      );

      expect(result.success).toBe(true);
      expect(result.path).toBe(testPath);
    });

    it("should handle paths with special characters", async () => {
      const testPath = "/tmp/screenshots/store-myshopify-com_product.png";
      const result = await ScreenshotService.captureScreenshot(
        "https://example.com",
        { path: testPath }
      );

      expect(result.success).toBe(true);
      expect(result.path).toBe(testPath);
    });
  });

  // ==========================================================================
  // 4. Navigation Error Tests
  // ==========================================================================

  describe("Navigation Errors", () => {
    it("should handle navigation timeout", async () => {
      fakePage.goto.mockRejectedValue(
        new Error("Navigation timeout of 30000 ms exceeded")
      );

      const result = await ScreenshotService.captureScreenshot("https://example.com");

      expect(result.success).toBe(false);
      expect(result.buffer).toBeNull();
      expect(result.path).toBeNull();
      expect(result.error).toMatch(/Navigation timeout/i);
    });

    it("should handle 404 errors", async () => {
      fakePage.goto.mockRejectedValue(
        new Error("net::ERR_ABORTED 404")
      );

      const result = await ScreenshotService.captureScreenshot(
        "https://example.com/nonexistent"
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/404/i);
    });

    it("should handle DNS resolution failures", async () => {
      fakePage.goto.mockRejectedValue(
        new Error("net::ERR_NAME_NOT_RESOLVED")
      );

      const result = await ScreenshotService.captureScreenshot(
        "https://nonexistent-domain-12345.com"
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/ERR_NAME_NOT_RESOLVED/i);
    });

    it("should handle connection refused errors", async () => {
      fakePage.goto.mockRejectedValue(
        new Error("net::ERR_CONNECTION_REFUSED")
      );

      const result = await ScreenshotService.captureScreenshot(
        "https://localhost:9999"
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/CONNECTION_REFUSED/i);
    });

    it("should handle SSL certificate errors", async () => {
      fakePage.goto.mockRejectedValue(
        new Error("net::ERR_CERT_AUTHORITY_INVALID")
      );

      const result = await ScreenshotService.captureScreenshot(
        "https://self-signed.badssl.com"
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/CERT_AUTHORITY_INVALID/i);
    });
  });

  // ==========================================================================
  // 5. BrowserPool Integration Tests
  // ==========================================================================

  describe("BrowserPool Integration", () => {
    it("should acquire browser from pool", async () => {
      await ScreenshotService.captureScreenshot("https://example.com");

      expect(mockPool.acquire).toHaveBeenCalledTimes(1);
    });

    it("should release browser back to pool on success", async () => {
      await ScreenshotService.captureScreenshot("https://example.com");

      expect(mockPool.release).toHaveBeenCalledTimes(1);
      expect(mockPool.release).toHaveBeenCalledWith(fakeBrowser);
    });

    it("should release browser back to pool on error", async () => {
      fakePage.goto.mockRejectedValue(new Error("Navigation failed"));

      await ScreenshotService.captureScreenshot("https://example.com");

      expect(mockPool.release).toHaveBeenCalledTimes(1);
      expect(mockPool.release).toHaveBeenCalledWith(fakeBrowser);
    });

    it("should handle browser pool acquire failure", async () => {
      mockPool.acquire.mockRejectedValue(
        new Error("Unable to acquire browser from pool")
      );

      const result = await ScreenshotService.captureScreenshot("https://example.com");

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Unable to acquire browser/i);
      expect(mockPool.release).not.toHaveBeenCalled();
    });

    it("should handle browser pool exhaustion", async () => {
      mockPool.acquire.mockRejectedValue(
        new Error("Pool is exhausted")
      );

      const result = await ScreenshotService.captureScreenshot("https://example.com");

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/exhausted|acquire/i);
    });

    it("should log warning if browser release fails", async () => {
      mockPool.release.mockRejectedValue(
        new Error("Failed to release browser")
      );

      await ScreenshotService.captureScreenshot("https://example.com");

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Failed to release browser")
      );
    });

    it("should close page before releasing browser", async () => {
      await ScreenshotService.captureScreenshot("https://example.com");

      expect(fakePage.close).toHaveBeenCalledBefore(mockPool.release);
    });

    it("should continue if page close fails", async () => {
      fakePage.close.mockRejectedValue(new Error("Page close failed"));

      const result = await ScreenshotService.captureScreenshot("https://example.com");

      expect(result.success).toBe(true);
      expect(mockPool.release).toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Failed to close page")
      );
    });
  });

  // ==========================================================================
  // 6. Screenshot Options Tests
  // ==========================================================================

  describe("Screenshot Options", () => {
    it("should support fullPage option", async () => {
      await ScreenshotService.captureScreenshot("https://example.com", {
        fullPage: true,
      });

      expect(fakePage.screenshot).toHaveBeenCalledWith(
        expect.objectContaining({ fullPage: true })
      );
    });

    it("should support type option (png/jpeg)", async () => {
      await ScreenshotService.captureScreenshot("https://example.com", {
        type: "jpeg",
      });

      expect(fakePage.screenshot).toHaveBeenCalledWith(
        expect.objectContaining({ type: "jpeg" })
      );
    });

    it("should support quality option for jpeg", async () => {
      await ScreenshotService.captureScreenshot("https://example.com", {
        type: "jpeg",
        quality: 80,
      });

      expect(fakePage.screenshot).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "jpeg",
          quality: 80,
        })
      );
    });

    it("should support clip option for specific region", async () => {
      const clip = { x: 0, y: 0, width: 800, height: 600 };
      await ScreenshotService.captureScreenshot("https://example.com", {
        clip,
      });

      expect(fakePage.screenshot).toHaveBeenCalledWith(
        expect.objectContaining({ clip })
      );
    });

    it("should support omitBackground option", async () => {
      await ScreenshotService.captureScreenshot("https://example.com", {
        omitBackground: true,
      });

      expect(fakePage.screenshot).toHaveBeenCalledWith(
        expect.objectContaining({ omitBackground: true })
      );
    });

    it("should support custom timeout", async () => {
      await ScreenshotService.captureScreenshot("https://example.com", {
        timeout: 60000,
      });

      expect(fakePage.goto).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ timeout: 60000 })
      );
    });
  });

  // ==========================================================================
  // 7. Return Structure Tests
  // ==========================================================================

  describe("Return Structure Consistency", () => {
    it("should always return { success, buffer, path, error } shape on success", async () => {
      const result = await ScreenshotService.captureScreenshot("https://example.com");

      expect(result).toHaveProperty("success");
      expect(result).toHaveProperty("buffer");
      expect(result).toHaveProperty("path");
      expect(result).toHaveProperty("error");
      expect(typeof result.success).toBe("boolean");
    });

    it("should always return { success, buffer, path, error } shape on failure", async () => {
      mockPool.acquire.mockRejectedValue(new Error("Test error"));

      const result = await ScreenshotService.captureScreenshot("https://example.com");

      expect(result).toHaveProperty("success");
      expect(result).toHaveProperty("buffer");
      expect(result).toHaveProperty("path");
      expect(result).toHaveProperty("error");
      expect(result.success).toBe(false);
      expect(result.buffer).toBeNull();
      expect(result.path).toBeNull();
      expect(typeof result.error).toBe("string");
    });

    it("should never throw unhandled errors", async () => {
      fakePage.screenshot.mockImplementation(() => {
        throw new Error("Synchronous error");
      });

      await expect(
        ScreenshotService.captureScreenshot("https://example.com")
      ).resolves.toMatchObject({
        success: false,
        buffer: null,
        path: null,
        error: expect.any(String),
      });
    });

    it("should never return undefined for any field", async () => {
      const result = await ScreenshotService.captureScreenshot("https://example.com");

      expect(result.success).not.toBeUndefined();
      expect(result.buffer !== undefined).toBe(true);
      expect(result.path !== undefined).toBe(true);
      expect(result.error !== undefined).toBe(true);
    });
  });

  // ==========================================================================
  // 8. Edge Cases
  // ==========================================================================

  describe("Edge Cases", () => {
    it("should handle URLs with query parameters", async () => {
      const url = "https://example.com/products?id=123&variant=456";
      const result = await ScreenshotService.captureScreenshot(url);

      expect(result.success).toBe(true);
      expect(fakePage.goto).toHaveBeenCalledWith(
        url,
        expect.any(Object)
      );
    });

    it("should handle URLs with fragments", async () => {
      const url = "https://example.com/page#section";
      const result = await ScreenshotService.captureScreenshot(url);

      expect(result.success).toBe(true);
    });

    it("should handle very long URLs", async () => {
      const longUrl = "https://example.com/" + "a".repeat(2000);
      const result = await ScreenshotService.captureScreenshot(longUrl);

      expect(result.success).toBe(true);
    });

    it("should handle URLs with Unicode characters", async () => {
      const url = "https://example.com/café-☕";
      const result = await ScreenshotService.captureScreenshot(url);

      expect(result.success).toBe(true);
    });

    it("should handle multiple concurrent screenshot requests", async () => {
      const urls = [
        "https://example1.com",
        "https://example2.com",
        "https://example3.com",
      ];

      const results = await Promise.all(
        urls.map(url => ScreenshotService.captureScreenshot(url))
      );

      results.forEach(result => {
        expect(result.success).toBe(true);
      });

      expect(mockPool.acquire).toHaveBeenCalledTimes(3);
      expect(mockPool.release).toHaveBeenCalledTimes(3);
    });

    it("should handle large screenshots", async () => {
      const largeBuffer = Buffer.alloc(10 * 1024 * 1024); // 10MB
      fakePage.screenshot.mockResolvedValue(largeBuffer);

      const result = await ScreenshotService.captureScreenshot("https://example.com");

      expect(result.success).toBe(true);
      expect(result.buffer.length).toBe(10 * 1024 * 1024);
    });

    it("should handle empty screenshot buffer", async () => {
      fakePage.screenshot.mockResolvedValue(Buffer.alloc(0));

      const result = await ScreenshotService.captureScreenshot("https://example.com");

      expect(result.success).toBe(true);
      expect(result.buffer.length).toBe(0);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Screenshot buffer is empty")
      );
    });
  });

  // ==========================================================================
  // 9. Logging Tests
  // ==========================================================================

  describe("Logging Behavior", () => {
    it("should log info on successful screenshot", async () => {
      await ScreenshotService.captureScreenshot("https://example.com");

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("Screenshot captured successfully")
      );
    });

    it("should log error on screenshot failure", async () => {
      fakePage.goto.mockRejectedValue(new Error("Test error"));

      await ScreenshotService.captureScreenshot("https://example.com");

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Screenshot capture failed")
      );
    });

    it("should include URL in error logs", async () => {
      fakePage.goto.mockRejectedValue(new Error("Test error"));

      const testUrl = "https://store.myshopify.com/products/test";
      await ScreenshotService.captureScreenshot(testUrl);

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining(testUrl)
      );
    });

    it("should log debug information about viewport", async () => {
      await ScreenshotService.captureScreenshot("https://example.com", {
        width: 1920,
        height: 1080,
      });

      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining("1920")
      );
    });
  });
});