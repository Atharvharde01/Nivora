import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import mongoose, { Types } from "mongoose";
import { HoldingModel } from "../../modules/holdings/holding.model";
import { InstrumentModel } from "../../modules/instruments/instrument.model";
import { LedgerEntryModel } from "../../modules/ledger/ledger.model";
import { OrderModel } from "../../modules/orders/order.model";
import { OrderExecutionService } from "../../modules/orders/order-execution.service";
import { OrderExecutionError } from "../../modules/orders/order-execution.types";
import { PracticeAccountModel } from "../../modules/practice-accounts/account.model";
import { TradeModel } from "../../modules/trades/trade.model";
import {
  clearDatabase,
  createTestAccount,
  createTestHolding,
  createTestInstrument,
  createTestUser,
  setupIntegrationTestDb,
  teardownIntegrationTestDb,
} from "./test-db-harness";

describe("Task 21 — Real MongoDB Idempotency & Concurrency Hardening", () => {
  before(async () => {
    await setupIntegrationTestDb();
  });

  after(async () => {
    await teardownIntegrationTestDb();
  });

  beforeEach(async () => {
    await clearDatabase();
  });

  describe("Section A & B — Idempotency Integrity & Concurrent Duplicate Resolution", () => {
    it("handles sequential duplicate requests with same intent as idempotent replay without duplicate records", async () => {
      const user = await createTestUser();
      const instrument = await createTestInstrument();
      const account = await createTestAccount(user._id);

      const service = new OrderExecutionService();
      const first = await service.executeMarketOrder({
        userId: user._id,
        practiceAccountId: account._id,
        instrumentId: instrument._id,
        side: "BUY",
        quantity: 5,
        idempotencyKey: "seq-same-key-1",
      });
      assert.equal(first.status, "EXECUTED");
      assert.equal(first.wasIdempotentReplay, false);

      const replay = await service.executeMarketOrder({
        userId: user._id,
        practiceAccountId: account._id,
        instrumentId: instrument._id,
        side: "BUY",
        quantity: 5,
        idempotencyKey: "seq-same-key-1",
      });
      assert.equal(replay.status, "EXECUTED");
      assert.equal(replay.wasIdempotentReplay, true);
      assert.equal(replay.order._id.toString(), first.order._id.toString());
      if (first.status === "EXECUTED" && replay.status === "EXECUTED") {
        assert.equal(replay.trade._id.toString(), first.trade._id.toString());
        assert.equal(
          replay.ledgerEntry._id.toString(),
          first.ledgerEntry._id.toString()
        );
      }

      // Assert only 1 order, 1 trade, and 2 ledger entries exist (initial funding + 1 trade)
      const orderCount = await OrderModel.countDocuments({
        practiceAccountId: account._id,
      });
      const tradeCount = await TradeModel.countDocuments({
        practiceAccountId: account._id,
      });
      const ledgerCount = await LedgerEntryModel.countDocuments({
        practiceAccountId: account._id,
      });
      assert.equal(orderCount, 1);
      assert.equal(tradeCount, 1);
      assert.equal(ledgerCount, 2);
    });

    it("rejects sequential duplicate requests with different intent with IDEMPOTENCY_KEY_CONFLICT", async () => {
      const user = await createTestUser();
      const instrument = await createTestInstrument();
      const account = await createTestAccount(user._id);

      const service = new OrderExecutionService();
      await service.executeMarketOrder({
        userId: user._id,
        practiceAccountId: account._id,
        instrumentId: instrument._id,
        side: "BUY",
        quantity: 5,
        idempotencyKey: "diff-intent-key-1",
      });

      // Same key, but quantity is 10 instead of 5
      await assert.rejects(
        () =>
          service.executeMarketOrder({
            userId: user._id,
            practiceAccountId: account._id,
            instrumentId: instrument._id,
            side: "BUY",
            quantity: 10,
            idempotencyKey: "diff-intent-key-1",
          }),
        (err: unknown) =>
          err instanceof OrderExecutionError &&
          err.code === "IDEMPOTENCY_KEY_CONFLICT"
      );

      // Verify no second order or trade was created
      const orderCount = await OrderModel.countDocuments({
        practiceAccountId: account._id,
      });
      assert.equal(orderCount, 1);
    });

    it("resolves simultaneous duplicate requests with identical intent to a single execution via unique index protection", async () => {
      const user = await createTestUser();
      const instrument = await createTestInstrument({
        bidPricePaise: 149_950,
        lastPricePaise: 150_000,
        askPricePaise: 150_000,
      });
      const account = await createTestAccount(user._id);

      const service = new OrderExecutionService();

      // Launch two identical requests concurrently
      const [res1, res2] = await Promise.all([
        service.executeMarketOrder({
          userId: user._id,
          practiceAccountId: account._id,
          instrumentId: instrument._id,
          side: "BUY",
          quantity: 4,
          idempotencyKey: "concurrent-dup-key",
        }),
        service.executeMarketOrder({
          userId: user._id,
          practiceAccountId: account._id,
          instrumentId: instrument._id,
          side: "BUY",
          quantity: 4,
          idempotencyKey: "concurrent-dup-key",
        }),
      ]);

      assert.equal(res1.status, "EXECUTED");
      assert.equal(res2.status, "EXECUTED");
      assert.equal(res1.order._id.toString(), res2.order._id.toString());

      // Exactly one must be the primary execution and one must be marked replay (or both resolve to identical committed order)
      const replays = [res1.wasIdempotentReplay, res2.wasIdempotentReplay].filter(
        Boolean
      );
      assert.equal(replays.length, 1);

      // Verify real MongoDB: exactly 1 order, 1 trade, and 1 buy ledger entry
      const orders = await OrderModel.find({
        practiceAccountId: account._id,
      }).lean();
      const trades = await TradeModel.find({
        practiceAccountId: account._id,
      }).lean();
      assert.equal(orders.length, 1);
      assert.equal(trades.length, 1);

      // Cash balance debited only once: 100,000,000 - 600,000 = 99,400,000
      const accountInDb = await PracticeAccountModel.findById(
        account._id
      ).lean();
      assert.equal(accountInDb?.cashBalancePaise, 99_400_000);
    });

    it("handles simultaneous duplicate requests with different intents by granting one and rejecting the other with IDEMPOTENCY_KEY_CONFLICT", async () => {
      const user = await createTestUser();
      const instrument = await createTestInstrument();
      const account = await createTestAccount(user._id);

      const service = new OrderExecutionService();

      // Launch two requests with the same idempotency key but different quantities concurrently
      const results = await Promise.allSettled([
        service.executeMarketOrder({
          userId: user._id,
          practiceAccountId: account._id,
          instrumentId: instrument._id,
          side: "BUY",
          quantity: 2,
          idempotencyKey: "concurrent-diff-intent",
        }),
        service.executeMarketOrder({
          userId: user._id,
          practiceAccountId: account._id,
          instrumentId: instrument._id,
          side: "BUY",
          quantity: 5,
          idempotencyKey: "concurrent-diff-intent",
        }),
      ]);

      const fulfilled = results.filter(
        (r): r is PromiseFulfilledResult<any> => r.status === "fulfilled"
      );
      const rejected = results.filter(
        (r): r is PromiseRejectedResult => r.status === "rejected"
      );

      // Exactly one succeeded and one was rejected due to idempotency conflict
      assert.equal(fulfilled.length, 1);
      assert.equal(rejected.length, 1);
      assert.ok(
        rejected[0].reason instanceof OrderExecutionError &&
          (rejected[0].reason.code === "IDEMPOTENCY_KEY_CONFLICT" ||
            rejected[0].reason.code === "CONCURRENCY_CONFLICT")
      );

      // Verify in DB: only 1 order and 1 trade
      const ordersInDb = await OrderModel.find({
        practiceAccountId: account._id,
      }).lean();
      assert.equal(ordersInDb.length, 1);
    });

    it("returns previously rejected order on replay and never re-executes even if conditions changed", async () => {
      const user = await createTestUser();
      const instrument = await createTestInstrument({
        bidPricePaise: 199_950,
        lastPricePaise: 200_000,
        askPricePaise: 200_000,
      });
      // Account with only 100,000 paise
      const account = await createTestAccount(user._id, {
        initialBalancePaise: 100_000,
        cashBalancePaise: 100_000,
      });

      const service = new OrderExecutionService();
      // First attempt: rejected due to INSUFFICIENT_FUNDS
      const first = await service.executeMarketOrder({
        userId: user._id,
        practiceAccountId: account._id,
        instrumentId: instrument._id,
        side: "BUY",
        quantity: 1,
        idempotencyKey: "replay-rejected-order",
      });
      assert.equal(first.status, "REJECTED");
      if (first.status !== "REJECTED") return;
      assert.equal(first.rejectionCode, "INSUFFICIENT_FUNDS");

      // Balance is now increased outside the order
      await PracticeAccountModel.findByIdAndUpdate(account._id, {
        cashBalancePaise: 50_000_000,
      });

      // Replay with identical key: MUST NOT execute now
      const replay = await service.executeMarketOrder({
        userId: user._id,
        practiceAccountId: account._id,
        instrumentId: instrument._id,
        side: "BUY",
        quantity: 1,
        idempotencyKey: "replay-rejected-order",
      });

      assert.equal(replay.status, "REJECTED");
      assert.equal(replay.wasIdempotentReplay, true);
      if (replay.status === "REJECTED") {
        assert.equal(replay.rejectionCode, "INSUFFICIENT_FUNDS");
      }

      // No trade was created
      const tradeCount = await TradeModel.countDocuments({
        practiceAccountId: account._id,
      });
      assert.equal(tradeCount, 0);
    });
  });

  describe("Section C — BUY Concurrency & Overspending Protection", () => {
    it("executes two simultaneous BUY requests when combined balance is sufficient", async () => {
      const user = await createTestUser();
      const instA = await createTestInstrument({
        symbol: "CONCBUYA",
        bidPricePaise: 99_950,
        lastPricePaise: 100_000,
        askPricePaise: 100_000,
      });
      const instB = await createTestInstrument({
        symbol: "CONCBUYB",
        bidPricePaise: 199_950,
        lastPricePaise: 200_000,
        askPricePaise: 200_000,
      });
      const account = await createTestAccount(user._id);

      const service = new OrderExecutionService();

      // BUY A: 2 shares @ 100,000 paise = 200,000 paise
      // BUY B: 3 shares @ 200,000 paise = 600,000 paise
      // Total = 800,000 paise <= 100,000,000 paise
      const [resA, resB] = await Promise.all([
        service.executeMarketOrder({
          userId: user._id,
          practiceAccountId: account._id,
          instrumentId: instA._id,
          side: "BUY",
          quantity: 2,
          idempotencyKey: "concurrent-buy-a",
        }),
        service.executeMarketOrder({
          userId: user._id,
          practiceAccountId: account._id,
          instrumentId: instB._id,
          side: "BUY",
          quantity: 3,
          idempotencyKey: "concurrent-buy-b",
        }),
      ]);

      assert.equal(resA.status, "EXECUTED");
      assert.equal(resB.status, "EXECUTED");

      // Verify account in real MongoDB
      const updatedAccount = await PracticeAccountModel.findById(
        account._id
      ).lean();
      assert.ok(updatedAccount);
      assert.equal(updatedAccount.cashBalancePaise, 100_000_000 - 800_000);

      // Verify holdings for both instruments
      const holdingA = await HoldingModel.findOne({
        practiceAccountId: account._id,
        instrumentId: instA._id,
      }).lean();
      const holdingB = await HoldingModel.findOne({
        practiceAccountId: account._id,
        instrumentId: instB._id,
      }).lean();
      assert.equal(holdingA?.quantity, 2);
      assert.equal(holdingB?.quantity, 3);
    });

    it("prevents double-spending when two simultaneous BUY requests compete for limited cash balance", async () => {
      const user = await createTestUser();
      const instrument = await createTestInstrument({
        bidPricePaise: 99_950,
        lastPricePaise: 100_000,
        askPricePaise: 100_000,
      });

      // Account with only 1,000,000 paise (₹10,000)
      const account = await createTestAccount(user._id, {
        initialBalancePaise: 1_000_000,
        cashBalancePaise: 1_000_000,
      });

      const service = new OrderExecutionService();

      // Order A: 7 shares @ 100,000 paise = 700,000 paise
      // Order B: 6 shares @ 100,000 paise = 600,000 paise
      // Combined = 1,300,000 paise > 1,000,000 paise available
      const [resA, resB] = await Promise.all([
        service.executeMarketOrder({
          userId: user._id,
          practiceAccountId: account._id,
          instrumentId: instrument._id,
          side: "BUY",
          quantity: 7,
          idempotencyKey: "compete-buy-a",
        }),
        service.executeMarketOrder({
          userId: user._id,
          practiceAccountId: account._id,
          instrumentId: instrument._id,
          side: "BUY",
          quantity: 6,
          idempotencyKey: "compete-buy-b",
        }),
      ]);

      const executedOrders = [resA, resB].filter(
        (r) => r.status === "EXECUTED"
      );
      const rejectedOrders = [resA, resB].filter(
        (r) => r.status === "REJECTED"
      );

      // CRITICAL INVARIANT: Exactly one order executes and one is rejected
      assert.equal(
        executedOrders.length,
        1,
        "Only one competing BUY order may execute"
      );
      assert.equal(
        rejectedOrders.length,
        1,
        "The second competing BUY order must be rejected"
      );

      const winning = executedOrders[0];
      const losing = rejectedOrders[0];

      if (losing.status === "REJECTED") {
        assert.equal(losing.rejectionCode, "INSUFFICIENT_FUNDS");
      }

      // CRITICAL FINANCIAL INVARIANT: Cash balance is NEVER negative
      const accountInDb = await PracticeAccountModel.findById(
        account._id
      ).lean();
      assert.ok(accountInDb);
      assert.ok(
        accountInDb.cashBalancePaise >= 0,
        "Cash balance must never become negative"
      );
      assert.equal(
        accountInDb.cashBalancePaise,
        1_000_000 - winning.totalValuePaise!
      );

      // Verify trades in DB: exactly 1 trade
      const tradesInDb = await TradeModel.find({
        practiceAccountId: account._id,
      }).lean();
      assert.equal(tradesInDb.length, 1);
      assert.equal(tradesInDb[0].quantity, winning.quantity);
    });
  });

  describe("Section D — SELL Concurrency & Overselling Protection", () => {
    it("prevents overselling when two simultaneous SELL requests exceed available holding quantity", async () => {
      const user = await createTestUser();
      const instrument = await createTestInstrument({
        bidPricePaise: 200_000,
      });
      const account = await createTestAccount(user._id);

      // User holds 10 shares
      await createTestHolding(user._id, account._id, instrument._id, {
        quantity: 10,
        averageBuyPricePaise: 180_000,
        totalInvestedPaise: 1_800_000,
      });

      const service = new OrderExecutionService();

      // SELL A: 7 shares
      // SELL B: 6 shares
      // Combined = 13 shares > 10 shares available
      const [resA, resB] = await Promise.all([
        service.executeMarketOrder({
          userId: user._id,
          practiceAccountId: account._id,
          instrumentId: instrument._id,
          side: "SELL",
          quantity: 7,
          idempotencyKey: "compete-sell-a",
        }),
        service.executeMarketOrder({
          userId: user._id,
          practiceAccountId: account._id,
          instrumentId: instrument._id,
          side: "SELL",
          quantity: 6,
          idempotencyKey: "compete-sell-b",
        }),
      ]);

      const executedSells = [resA, resB].filter(
        (r) => r.status === "EXECUTED"
      );
      const rejectedSells = [resA, resB].filter(
        (r) => r.status === "REJECTED"
      );

      // CRITICAL INVARIANT: Exactly one SELL succeeds and one is rejected
      assert.equal(
        executedSells.length,
        1,
        "Only one competing SELL order may execute"
      );
      assert.equal(
        rejectedSells.length,
        1,
        "The second competing SELL order must be rejected"
      );

      const winning = executedSells[0];
      const losing = rejectedSells[0];

      if (losing.status === "REJECTED") {
        assert.equal(losing.rejectionCode, "INSUFFICIENT_QUANTITY");
      }

      // CRITICAL INVARIANT: Holding quantity is NEVER negative and never oversold
      const holdingInDb = await HoldingModel.findOne({
        practiceAccountId: account._id,
        instrumentId: instrument._id,
      }).lean();
      assert.ok(holdingInDb);
      assert.ok(
        holdingInDb.quantity >= 0,
        "Holding quantity must never become negative"
      );
      assert.equal(holdingInDb.quantity, 10 - winning.quantity);

      // Account balance credited ONLY for the winning execution
      const accountInDb = await PracticeAccountModel.findById(
        account._id
      ).lean();
      assert.equal(
        accountInDb?.cashBalancePaise,
        100_000_000 + winning.totalValuePaise!
      );
    });

    it("executes two simultaneous SELL requests when holding quantity is sufficient for both", async () => {
      const user = await createTestUser();
      const instrument = await createTestInstrument({
        bidPricePaise: 100_000,
      });
      const account = await createTestAccount(user._id);

      // User holds 15 shares
      await createTestHolding(user._id, account._id, instrument._id, {
        quantity: 15,
        averageBuyPricePaise: 90_000,
        totalInvestedPaise: 1_350_000,
      });

      const service = new OrderExecutionService();

      // SELL A: 5 shares (proceeds = 500,000)
      // SELL B: 6 shares (proceeds = 600,000)
      // Total = 11 shares <= 15 shares
      const [resA, resB] = await Promise.all([
        service.executeMarketOrder({
          userId: user._id,
          practiceAccountId: account._id,
          instrumentId: instrument._id,
          side: "SELL",
          quantity: 5,
          idempotencyKey: "concurrent-sell-a",
        }),
        service.executeMarketOrder({
          userId: user._id,
          practiceAccountId: account._id,
          instrumentId: instrument._id,
          side: "SELL",
          quantity: 6,
          idempotencyKey: "concurrent-sell-b",
        }),
      ]);

      assert.equal(resA.status, "EXECUTED");
      assert.equal(resB.status, "EXECUTED");

      // Verify in DB: remaining quantity = 15 - 11 = 4 shares
      const holdingInDb = await HoldingModel.findOne({
        practiceAccountId: account._id,
        instrumentId: instrument._id,
      }).lean();
      assert.ok(holdingInDb);
      assert.equal(holdingInDb.quantity, 4);

      // Cash balance credited for both: 100,000,000 + 1,100,000 = 101,100,000
      const accountInDb = await PracticeAccountModel.findById(
        account._id
      ).lean();
      assert.equal(accountInDb?.cashBalancePaise, 101_100_000);
    });
  });
});
