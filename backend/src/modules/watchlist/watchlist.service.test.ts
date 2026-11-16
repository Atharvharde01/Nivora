import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Types } from "mongoose";
import { WatchlistService } from "./watchlist.service";
import { WatchlistError } from "./watchlist.types";

describe("Task 25 — Watchlist Service (Unit)", () => {
  const service = new WatchlistService({
    runInTransaction: async (cb) => cb(null as any),
  });

  describe("A. Validation & Input Sanitization", () => {
    it("rejects invalid userId with INVALID_USER_ID", async () => {
      await assert.rejects(
        () => service.getUserWatchlist("not-a-valid-id"),
        (err: unknown) => {
          assert.ok(err instanceof WatchlistError);
          assert.equal(err.code, "INVALID_USER_ID");
          assert.equal(err.statusCode, 400);
          return true;
        }
      );
    });

    it("rejects invalid instrumentId in addWatchlistItem with INVALID_INSTRUMENT_ID", async () => {
      const validUserId = new Types.ObjectId().toString();
      await assert.rejects(
        () => service.addWatchlistItem(validUserId, "bad-inst-id"),
        (err: unknown) => {
          assert.ok(err instanceof WatchlistError);
          assert.equal(err.code, "INVALID_INSTRUMENT_ID");
          assert.equal(err.statusCode, 400);
          return true;
        }
      );
    });

    it("rejects invalid instrumentId in removeWatchlistItem with INVALID_INSTRUMENT_ID", async () => {
      const validUserId = new Types.ObjectId().toString();
      await assert.rejects(
        () => service.removeWatchlistItem(validUserId, "invalid-object-id"),
        (err: unknown) => {
          assert.ok(err instanceof WatchlistError);
          assert.equal(err.code, "INVALID_INSTRUMENT_ID");
          assert.equal(err.statusCode, 400);
          return true;
        }
      );
    });

    it("rejects non-array reorder payload with INVALID_REORDER_PAYLOAD", async () => {
      const validUserId = new Types.ObjectId().toString();
      await assert.rejects(
        () => service.reorderWatchlist(validUserId, "not-an-array"),
        (err: unknown) => {
          assert.ok(err instanceof WatchlistError);
          assert.equal(err.code, "INVALID_REORDER_PAYLOAD");
          assert.equal(err.statusCode, 400);
          return true;
        }
      );
    });

    it("rejects empty reorder array with INVALID_REORDER_PAYLOAD", async () => {
      const validUserId = new Types.ObjectId().toString();
      await assert.rejects(
        () => service.reorderWatchlist(validUserId, []),
        (err: unknown) => {
          assert.ok(err instanceof WatchlistError);
          assert.equal(err.code, "INVALID_REORDER_PAYLOAD");
          assert.equal(err.statusCode, 400);
          return true;
        }
      );
    });

    it("rejects reorder array containing duplicate IDs", async () => {
      const validUserId = new Types.ObjectId().toString();
      const duplicateId = new Types.ObjectId().toString();
      await assert.rejects(
        () => service.reorderWatchlist(validUserId, [duplicateId, duplicateId]),
        (err: unknown) => {
          assert.ok(err instanceof WatchlistError);
          assert.equal(err.code, "INVALID_REORDER_PAYLOAD");
          assert.match(err.message, /duplicate/i);
          return true;
        }
      );
    });
  });
});
