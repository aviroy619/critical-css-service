/**
 * browserPool.test.js
 * 
 * Unit tests for BrowserPool service
 * - Validates acquire/release/reuse lifecycle
 * - Tests concurrency and max pool size enforcement
 * - Verifies idle browser cleanup
 * - Confirms graceful shutdown with grace period
 */

import { getPool, shutdownPool } from "../services/BrowserPool.js";
import puppeteer from "puppeteer";

// Mock Puppeteer to avoid launching real browsers
jest.mock("puppeteer", () => ({
  launch: jest.fn().mockImplementation(() => {
    const mockBrowser = {
      isConnected: jest.fn(() => true),
      close: jest.fn().mockResolvedValue(),
      _mockId: Math.random().toString(36).substring(7), // Unique ID for tracking
    };
    return Promise.resolve(mockBrowser);
  }),
}));

describe("BrowserPool", () => {
  let pool;

  beforeEach(() => {
    // Reset environment variables
    process.env.BROWSERPOOL_GRACE_PERIOD = "200";
    process.env.PUPPETEER_HEADLESS = "true";
    
    // Initialize pool with test-friendly settings
    pool = getPool({ 
      minPoolSize: 1, 
      maxPoolSize: 2, 
      idleTimeout: 100 
    });
    
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await shutdownPool();
    jest.clearAllMocks();
  });

  describe("Basic Acquire & Release", () => {
    it("should acquire a browser successfully", async () => {
      const browser = await pool.acquire();
      
      expect(browser).toBeDefined();
      expect(browser.isConnected()).toBe(true);
      expect(puppeteer.launch).toHaveBeenCalledTimes(1);
    });

    it("should release browser back to available pool", async () => {
      const browser = await pool.acquire();
      expect(pool.availableBrowsers.length).toBe(0);
      
      await pool.release(browser);
      
      expect(pool.availableBrowsers.length).toBe(1);
      expect(pool.availableBrowsers[0]).toBe(browser);
    });

    it("should track busy browsers correctly", async () => {
      const browser = await pool.acquire();
      
      expect(pool.busyBrowsers.has(browser)).toBe(true);
      expect(pool.availableBrowsers.length).toBe(0);
      
      await pool.release(browser);
      
      expect(pool.busyBrowsers.has(browser)).toBe(false);
      expect(pool.availableBrowsers.length).toBe(1);
    });
  });

  describe("Browser Reuse", () => {
    it("should reuse browser after release", async () => {
      const browser1 = await pool.acquire();
      await pool.release(browser1);

      const browser2 = await pool.acquire();
      
      expect(browser1).toBe(browser2);
      expect(puppeteer.launch).toHaveBeenCalledTimes(1); // Only launched once
    });

    it("should reuse multiple browsers in rotation", async () => {
      const b1 = await pool.acquire();
      const b2 = await pool.acquire();
      
      await pool.release(b1);
      await pool.release(b2);
      
      const b3 = await pool.acquire();
      const b4 = await pool.acquire();
      
      expect([b1, b2]).toContain(b3);
      expect([b1, b2]).toContain(b4);
      expect(b3).not.toBe(b4);
    });
  });

  describe("Disconnected Browser Handling", () => {
    it("should destroy and retry when browser is disconnected", async () => {
      const disconnectedBrowser = {
        isConnected: jest.fn(() => false),
        close: jest.fn().mockResolvedValue(),
        _mockId: "disconnected",
      };
      
      pool.availableBrowsers.push(disconnectedBrowser);
      
      const browser = await pool.acquire();
      
      expect(disconnectedBrowser.close).toHaveBeenCalled();
      expect(browser.isConnected()).toBe(true);
      expect(browser).not.toBe(disconnectedBrowser);
    });

    it("should handle multiple disconnected browsers", async () => {
      const disconnected1 = {
        isConnected: jest.fn(() => false),
        close: jest.fn().mockResolvedValue(),
      };
      const disconnected2 = {
        isConnected: jest.fn(() => false),
        close: jest.fn().mockResolvedValue(),
      };
      
      pool.availableBrowsers.push(disconnected1, disconnected2);
      
      const browser = await pool.acquire();
      
      expect(disconnected1.close).toHaveBeenCalled();
      expect(disconnected2.close).toHaveBeenCalled();
      expect(browser.isConnected()).toBe(true);
    });
  });

  describe("Max Pool Size Enforcement", () => {
    it("should respect max pool size limit", async () => {
      const b1 = await pool.acquire();
      const b2 = await pool.acquire();

      // Third acquire should wait
      const acquirePromise = pool.acquire();
      
      // Verify it's waiting
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(pool.waitingQueue.length).toBe(1);
      
      // Release one browser
      pool.release(b1);

      // Now third acquire should complete
      const b3 = await acquirePromise;
      expect(b3).toBe(b1);
    });

    it("should queue multiple waiting requests", async () => {
      const b1 = await pool.acquire();
      const b2 = await pool.acquire();

      const p1 = pool.acquire();
      const p2 = pool.acquire();
      const p3 = pool.acquire();
      
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(pool.waitingQueue.length).toBe(3);
      
      pool.release(b1);
      await p1;
      expect(pool.waitingQueue.length).toBe(2);
      
      pool.release(b2);
      await Promise.all([p2, p3]);
      expect(pool.waitingQueue.length).toBe(0);
    });

    it("should handle concurrent acquire/release correctly", async () => {
      const operations = Array.from({ length: 10 }, async () => {
        const browser = await pool.acquire();
        await new Promise(resolve => setTimeout(resolve, 10));
        await pool.release(browser);
      });

      await expect(Promise.all(operations)).resolves.not.toThrow();
      expect(pool.availableBrowsers.length).toBeLessThanOrEqual(2);
    });
  });

  describe("Idle Cleanup", () => {
    it("should cleanup idle browsers after timeout", async () => {
      const browser = await pool.acquire();
      await pool.release(browser);

      expect(pool.availableBrowsers.length).toBe(1);

      // Wait for idle timeout (100ms + buffer)
      await new Promise(resolve => setTimeout(resolve, 150));

      expect(pool.availableBrowsers.length).toBe(0);
      expect(browser.close).toHaveBeenCalled();
    });

    it("should not cleanup browsers below min pool size", async () => {
      const poolWithMin = getPool({ 
        minPoolSize: 1, 
        maxPoolSize: 3, 
        idleTimeout: 100 
      });

      const b1 = await poolWithMin.acquire();
      const b2 = await poolWithMin.acquire();
      
      await poolWithMin.release(b1);
      await poolWithMin.release(b2);

      expect(poolWithMin.availableBrowsers.length).toBe(2);

      await new Promise(resolve => setTimeout(resolve, 150));

      // Should keep minPoolSize browsers
      expect(poolWithMin.availableBrowsers.length).toBe(1);
    });

    it("should reset idle timer when browser is reused", async () => {
      const browser = await pool.acquire();
      await pool.release(browser);

      // Wait half the idle timeout
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Reuse browser
      const reused = await pool.acquire();
      expect(reused).toBe(browser);
      
      await pool.release(reused);

      // Wait another half timeout (total would exceed if timer wasn't reset)
      await new Promise(resolve => setTimeout(resolve, 60));
      
      expect(pool.availableBrowsers.length).toBe(1);
    });
  });

  describe("Shutdown", () => {
    it("should shutdown gracefully with no active browsers", async () => {
      const browser = await pool.acquire();
      await pool.release(browser);

      await expect(shutdownPool()).resolves.not.toThrow();
      
      expect(browser.close).toHaveBeenCalled();
      expect(pool.availableBrowsers.length).toBe(0);
    });

    it("should wait for busy browsers during shutdown", async () => {
      const browser = await pool.acquire();
      
      const shutdownPromise = shutdownPool();
      
      // Browser is still busy
      expect(pool.busyBrowsers.has(browser)).toBe(true);
      
      // Release after small delay
      setTimeout(() => pool.release(browser), 50);
      
      await expect(shutdownPromise).resolves.not.toThrow();
      expect(browser.close).toHaveBeenCalled();
    });

    it("should respect grace period during shutdown", async () => {
      process.env.BROWSERPOOL_GRACE_PERIOD = "500";
      const browser = await pool.acquire();
      
      const startTime = Date.now();
      const shutdownPromise = shutdownPool();
      
      // Don't release the browser
      await shutdownPromise;
      const elapsed = Date.now() - startTime;
      
      expect(elapsed).toBeGreaterThanOrEqual(500);
      expect(browser.close).toHaveBeenCalled();
    });

    it("should reject waiting queue on shutdown", async () => {
      const b1 = await pool.acquire();
      const b2 = await pool.acquire();

      const waitingPromise = pool.acquire();
      
      await new Promise(resolve => setTimeout(resolve, 50));
      
      const shutdownPromise = shutdownPool();

      await expect(waitingPromise).rejects.toThrow();
      await expect(shutdownPromise).resolves.not.toThrow();
    });

    it("should clear all timers on shutdown", async () => {
      const browser = await pool.acquire();
      await pool.release(browser);
      
      // Verify idle timer is set
      expect(pool.idleTimers.has(browser)).toBe(true);
      
      await shutdownPool();
      
      expect(pool.idleTimers.size).toBe(0);
    });
  });

  describe("Environment Variable Overrides", () => {
    it("should respect PUPPETEER_HEADLESS setting", async () => {
      process.env.PUPPETEER_HEADLESS = "false";
      
      await pool.acquire();
      
      expect(puppeteer.launch).toHaveBeenCalledWith(
        expect.objectContaining({
          headless: false,
        })
      );
    });

    it("should use default grace period when not set", async () => {
      delete process.env.BROWSERPOOL_GRACE_PERIOD;
      
      const browser = await pool.acquire();
      const shutdownPromise = shutdownPool();
      
      await expect(shutdownPromise).resolves.not.toThrow();
    });

    it("should handle invalid grace period gracefully", async () => {
      process.env.BROWSERPOOL_GRACE_PERIOD = "invalid";
      
      const browser = await pool.acquire();
      
      await expect(shutdownPool()).resolves.not.toThrow();
    });
  });

  describe("Error Handling", () => {
    it("should handle browser launch failures", async () => {
      puppeteer.launch.mockRejectedValueOnce(new Error("Launch failed"));
      
      await expect(pool.acquire()).rejects.toThrow("Launch failed");
    });

    it("should handle browser close failures during cleanup", async () => {
      const browser = await pool.acquire();
      browser.close.mockRejectedValueOnce(new Error("Close failed"));
      
      await pool.release(browser);
      
      // Should not throw, just log error
      await new Promise(resolve => setTimeout(resolve, 150));
      
      expect(pool.availableBrowsers.length).toBe(0);
    });

    it("should handle release of unknown browser gracefully", async () => {
      const unknownBrowser = {
        isConnected: () => true,
        close: jest.fn(),
      };
      
      await expect(pool.release(unknownBrowser)).resolves.not.toThrow();
      
      expect(pool.availableBrowsers.length).toBe(0);
    });
  });
});