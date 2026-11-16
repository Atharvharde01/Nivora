import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import mongoose, { ClientSession, Types } from "mongoose";
import { HoldingModel } from "../../modules/holdings/holding.model";
import { InstrumentModel } from "../../modules/instruments/instrument.model";
import { InstrumentQuoteService } from "../../modules/instruments/instrument-quote.service";
import { LedgerEntryModel } from "../../modules/ledger/ledger.model";
import { OrderModel } from "../../modules/orders/order.model";
import {
  MongooseOrderExecutionRepository,
  OrderExecutionService,
} from "../../modules/orders/order-execution.service";
import { OrderExecutionError } from "../../modules/orders/order-execution.types";
import { PracticeAccountModel } from "../../modules/practice-accounts/account.model";
import { DEFAULT_INITIAL_BALANCE_PAISE } from "../../modules/practice-accounts/account.schema";
import {
  executeMongoTransaction,
  MongoosePracticeAccountRepository,
  PracticeAccountService,
} from "../../modules/practice-accounts/account.service";
import { PracticeAccountError } from "../../modules/practice-accounts/account.service.types";
import { TradeModel } from "../../modules/trades/trade.model";
import { UserModel } from "../../modules/users/user.model";
import { WatchlistItemModel } from "../../modules/watchlist/watchlist.model";
import {
  clearDatabase,
  createTestAccount,
  createTestHolding,
  createTestInstrument,
  createTestUser,
  setupIntegrationTestDb,
  teardownIntegrationTestDb,
  verifyTransactionCapability,
} from "./test-db-harness";

describe("Task 20 — Real MongoDB Replica-Set Integration Testing", () => {
  before(async () => {
    await setupIntegrationTestDb();
  });

  after(async () => {
    await teardownIntegrationTestDb();
  });

  beforeEach(async () => {
    await clearDatabase();
  });

  describe("Part C — Replica-Set & Transaction Verification", () => {
    it("confirms the connected database is a replica set and actively supports ACID transactions", async () => {
      await verifyTransactionCapability();
      assert.equal(mongoose.connection.readyState, 1);
    });
  });

  describe("Part D — Real MongoDB Account Reset Integration", () => {
    it("resets account atomically, archives old account, creates new active account with 100,000,000 paise, and preserves watchlist items", async () => {
      const user = await createTestUser();
      const instrument = await createTestInstrument();

      // Create an active practice account with a reduced balance
      const initialAccount = await createTestAccount(user._id, {
        accountNumber: 1,
        cashBalancePaise: 45_000_000,
        version: 3,
      });

      // User creates a watchlist item
      const watchlistItem = new WatchlistItemModel({
        userId: user._id,
        instrumentId: instrument._id,
        symbolSnapshot: instrument.symbol,
        sortOrder: 0,
      });
      await watchlistItem.save();

      const accountService = new PracticeAccountService();
      const resetResult = await accountService.resetPracticeAccount(user._id);

      // 1. Verify reset result
      assert.equal(resetResult.activeAccount.accountNumber, 2);
      assert.equal(resetResult.activeAccount.status, "ACTIVE");
      assert.equal(
        resetResult.activeAccount.cashBalancePaise,
        DEFAULT_INITIAL_BALANCE_PAISE
      );
      assert.equal(
        resetResult.activeAccount.initialBalancePaise,
        DEFAULT_INITIAL_BALANCE_PAISE
      );
      assert.equal(resetResult.activeAccount.version, 0);
      assert.equal(resetResult.archivedAccount?.accountNumber, 1);
      assert.equal(resetResult.archivedAccount?.status, "ARCHIVED");

      // 2. Verify in real database: old account is ARCHIVED
      const oldAccountInDb = await PracticeAccountModel.findById(
        initialAccount._id
      ).lean();
      assert.ok(oldAccountInDb);
      assert.equal(oldAccountInDb.status, "ARCHIVED");
      assert.ok(oldAccountInDb.archivedAt instanceof Date);
      assert.equal(oldAccountInDb.cashBalancePaise, 45_000_000);

      // 3. Verify in real database: new account is ACTIVE
      const newAccountInDb = await PracticeAccountModel.findById(
        resetResult.activeAccount.accountId
      ).lean();
      assert.ok(newAccountInDb);
      assert.equal(newAccountInDb.status, "ACTIVE");
      assert.equal(newAccountInDb.accountNumber, 2);
      assert.equal(newAccountInDb.cashBalancePaise, 100_000_000);

      // 4. Verify initial funding ledger entry is created in real database
      const ledgerEntry = await LedgerEntryModel.findOne({
        practiceAccountId: resetResult.activeAccount.accountId,
        entryType: "INITIAL_FUNDING",
      }).lean();
      assert.ok(ledgerEntry);
      assert.equal(ledgerEntry.amountPaise, 100_000_000);
      assert.equal(ledgerEntry.direction, "CREDIT");
      assert.equal(ledgerEntry.balanceBeforePaise, 0);
      assert.equal(ledgerEntry.balanceAfterPaise, 100_000_000);
      assert.equal(ledgerEntry.referenceType, "PRACTICE_ACCOUNT");
      assert.equal(
        ledgerEntry.referenceId.toString(),
        resetResult.activeAccount.accountId.toString()
      );

      // 5. Verify exactly one ACTIVE account exists for user
      const activeAccounts = await PracticeAccountModel.find({
        userId: user._id,
        status: "ACTIVE",
      }).lean();
      assert.equal(activeAccounts.length, 1);
      assert.equal(
        activeAccounts[0]._id.toString(),
        resetResult.activeAccount.accountId.toString()
      );

      // 6. Verify watchlist item was preserved untouched
      const watchlistInDb = await WatchlistItemModel.find({
        userId: user._id,
      }).lean();
      assert.equal(watchlistInDb.length, 1);
      assert.equal(
        watchlistInDb[0]._id.toString(),
        watchlistItem._id.toString()
      );
    });

    it("rolls back the reset transaction on failure and preserves the existing active account without partial archiving", async () => {
      const user = await createTestUser();
      const existingAccount = await createTestAccount(user._id, {
        accountNumber: 1,
        cashBalancePaise: 75_000_000,
        version: 1,
      });

      // Create a service with a repository that throws during initial ledger entry creation
      const realRepo = new MongoosePracticeAccountRepository();
      const failingRepo = {
        findActiveByUserId: realRepo.findActiveByUserId.bind(realRepo),
        findById: realRepo.findById.bind(realRepo),
        findHighestAccountNumberForUser:
          realRepo.findHighestAccountNumberForUser.bind(realRepo),
        archiveActiveAccount: realRepo.archiveActiveAccount.bind(realRepo),
        createActiveAccount: realRepo.createActiveAccount.bind(realRepo),
        createInitialFundingLedgerEntry: async () => {
          throw new Error("Simulated mid-transaction failure during ledger creation");
        },
      };

      const service = new PracticeAccountService({ repository: failingRepo });

      await assert.rejects(
        () => service.resetPracticeAccount(user._id),
        (err: unknown) =>
          err instanceof PracticeAccountError &&
          err.code === "ACCOUNT_RESET_FAILED"
      );

      // Verify real database: existing account is STILL ACTIVE with original balance
      const accountInDb = await PracticeAccountModel.findById(
        existingAccount._id
      ).lean();
      assert.ok(accountInDb);
      assert.equal(accountInDb.status, "ACTIVE");
      assert.equal(accountInDb.archivedAt, undefined);
      assert.equal(accountInDb.cashBalancePaise, 75_000_000);
      assert.equal(accountInDb.version, 1);

      // No new account was created
      const allAccounts = await PracticeAccountModel.find({
        userId: user._id,
      }).lean();
      assert.equal(allAccounts.length, 1);
    });
  });

  describe("Part E — Real MongoDB BUY Order Execution Integration", () => {
    it("executes BUY at ask price, atomically updates account balance, creates holding, trade, and DEBIT ledger entry", async () => {
      const user = await createTestUser();
      const instrument = await createTestInstrument({
        symbol: "TCS",
        lastPricePaise: 350_000,
        bidPricePaise: 349_900,
        askPricePaise: 350_100,
        previousClosePaise: 348_000,
      });
      const account = await createTestAccount(user._id);

      const service = new OrderExecutionService();
      const result = await service.executeMarketOrder({
        userId: user._id,
        practiceAccountId: account._id,
        instrumentId: instrument._id,
        side: "BUY",
        quantity: 10,
        idempotencyKey: "real-db-buy-1",
      });

      assert.equal(result.status, "EXECUTED");
      if (result.status !== "EXECUTED") return;

      assert.equal(result.executionPricePaise, 350_100); // executed at askPricePaise
      assert.equal(result.totalValuePaise, 3_501_000); // 10 * 350,100
      assert.equal(result.cashBalanceBeforePaise, 100_000_000);
      assert.equal(result.updatedCashBalancePaise, 96_499_000);

      // 1. Verify in real MongoDB: Account balance updated
      const updatedAccountInDb = await PracticeAccountModel.findById(
        account._id
      ).lean();
      assert.ok(updatedAccountInDb);
      assert.equal(updatedAccountInDb.cashBalancePaise, 96_499_000);
      assert.equal(updatedAccountInDb.version, 2);

      // 2. Verify in real MongoDB: Holding created
      const holdingInDb = await HoldingModel.findOne({
        practiceAccountId: account._id,
        instrumentId: instrument._id,
      }).lean();
      assert.ok(holdingInDb);
      assert.equal(holdingInDb.quantity, 10);
      assert.equal(holdingInDb.averageBuyPricePaise, 350_100);
      assert.equal(holdingInDb.totalInvestedPaise, 3_501_000);
      assert.equal(holdingInDb.realizedPnlPaise, 0);

      // 3. Verify in real MongoDB: Order persisted as EXECUTED
      const orderInDb = await OrderModel.findById(result.order._id).lean();
      assert.ok(orderInDb);
      assert.equal(orderInDb.status, "EXECUTED");
      assert.equal(orderInDb.executedQuantity, 10);
      assert.equal(orderInDb.executionPricePaise, 350_100);
      assert.equal(orderInDb.totalValuePaise, 3_501_000);

      // 4. Verify in real MongoDB: Trade persisted with quote snapshot
      const tradeInDb = await TradeModel.findById(result.trade._id).lean();
      assert.ok(tradeInDb);
      assert.equal(tradeInDb.orderId.toString(), orderInDb._id.toString());
      assert.equal(tradeInDb.side, "BUY");
      assert.equal(tradeInDb.executionPricePaise, 350_100);
      assert.equal(tradeInDb.costBasisSoldPaise, 0);
      assert.equal(tradeInDb.realizedPnlPaise, 0);
      assert.equal(tradeInDb.quoteSnapshot.askPricePaise, 350_100);
      assert.equal(tradeInDb.quoteSnapshot.bidPricePaise, 349_900);

      // 5. Verify in real MongoDB: LedgerEntry persisted with DEBIT
      const ledgerInDb = await LedgerEntryModel.findById(
        result.ledgerEntry._id
      ).lean();
      assert.ok(ledgerInDb);
      assert.equal(ledgerInDb.entryType, "BUY_EXECUTION");
      assert.equal(ledgerInDb.direction, "DEBIT");
      assert.equal(ledgerInDb.amountPaise, 3_501_000);
      assert.equal(ledgerInDb.balanceBeforePaise, 100_000_000);
      assert.equal(ledgerInDb.balanceAfterPaise, 96_499_000);
      assert.equal(ledgerInDb.referenceType, "TRADE");
      assert.equal(ledgerInDb.referenceId.toString(), tradeInDb._id.toString());
    });

    it("updates existing holding with weighted average buy price on subsequent BUY", async () => {
      const user = await createTestUser();
      const instrument = await createTestInstrument({
        symbol: "INFY",
        lastPricePaise: 100_000,
        bidPricePaise: 99_950,
        askPricePaise: 100_000,
      });
      const account = await createTestAccount(user._id);

      const service = new OrderExecutionService();

      // First BUY: 5 shares @ 100,000 paise -> totalInvested = 500,000
      await service.executeMarketOrder({
        userId: user._id,
        practiceAccountId: account._id,
        instrumentId: instrument._id,
        side: "BUY",
        quantity: 5,
        idempotencyKey: "infy-buy-step-1",
      });

      // Price moves up
      await InstrumentModel.findByIdAndUpdate(instrument._id, {
        lastPricePaise: 110_000,
        bidPricePaise: 109_950,
        askPricePaise: 110_000,
        priceUpdatedAt: new Date(),
      });

      // Second BUY: 5 shares @ 110,000 paise -> totalInvested = 500,000 + 550,000 = 1,050,000; avg = 105,000
      const secondResult = await service.executeMarketOrder({
        userId: user._id,
        practiceAccountId: account._id,
        instrumentId: instrument._id,
        side: "BUY",
        quantity: 5,
        idempotencyKey: "infy-buy-step-2",
      });

      assert.equal(secondResult.status, "EXECUTED");
      if (secondResult.status !== "EXECUTED") return;

      assert.equal(secondResult.updatedHolding.quantity, 10);
      assert.equal(secondResult.updatedHolding.totalInvestedPaise, 1_050_000);
      assert.equal(secondResult.updatedHolding.averageBuyPricePaise, 105_000);

      // Verify in real MongoDB
      const holdingInDb = await HoldingModel.findOne({
        practiceAccountId: account._id,
        instrumentId: instrument._id,
      }).lean();
      assert.ok(holdingInDb);
      assert.equal(holdingInDb.quantity, 10);
      assert.equal(holdingInDb.averageBuyPricePaise, 105_000);
      assert.equal(holdingInDb.totalInvestedPaise, 1_050_000);
      assert.equal(holdingInDb.version, 2);
    });

    it("rejects BUY with INSUFFICIENT_FUNDS when balance is smaller than order value and persists REJECTED order with zero financial mutations", async () => {
      const user = await createTestUser();
      const instrument = await createTestInstrument({
        askPricePaise: 250_050,
      });
      // Account with only 100,000 paise balance
      const account = await createTestAccount(user._id, {
        initialBalancePaise: 100_000,
        cashBalancePaise: 100_000,
      });

      const service = new OrderExecutionService();
      // 1 share @ 250,050 paise > 100,000 paise
      const result = await service.executeMarketOrder({
        userId: user._id,
        practiceAccountId: account._id,
        instrumentId: instrument._id,
        side: "BUY",
        quantity: 1,
        idempotencyKey: "reject-insufficient-funds",
      });

      assert.equal(result.status, "REJECTED");
      if (result.status !== "REJECTED") return;

      assert.equal(result.rejectionCode, "INSUFFICIENT_FUNDS");
      assert.equal(result.trade, null);
      assert.equal(result.ledgerEntry, null);

      // 1. In DB: Order persisted as REJECTED
      const orderInDb = await OrderModel.findById(result.order._id).lean();
      assert.ok(orderInDb);
      assert.equal(orderInDb.status, "REJECTED");
      assert.equal(orderInDb.rejectionCode, "INSUFFICIENT_FUNDS");

      // 2. In DB: No Trade created
      const tradeCount = await TradeModel.countDocuments({
        orderId: result.order._id,
      });
      assert.equal(tradeCount, 0);

      // 3. In DB: Account balance untouched
      const accountInDb = await PracticeAccountModel.findById(
        account._id
      ).lean();
      assert.equal(accountInDb?.cashBalancePaise, 100_000);

      // 4. In DB: No holding created
      const holdingInDb = await HoldingModel.findOne({
        practiceAccountId: account._id,
        instrumentId: instrument._id,
      }).lean();
      assert.equal(holdingInDb, null);

      // 5. In DB: Only 1 initial funding ledger entry exists
      const ledgerCount = await LedgerEntryModel.countDocuments({
        practiceAccountId: account._id,
      });
      assert.equal(ledgerCount, 1);
    });
  });

  describe("Part F — Real MongoDB SELL Order Execution Integration", () => {
    it("executes partial SELL at bid price, credits account balance, calculates realized profit, and persists records", async () => {
      const user = await createTestUser();
      const instrument = await createTestInstrument({
        symbol: "HDFCBANK",
        bidPricePaise: 160_000,
        lastPricePaise: 160_050,
        askPricePaise: 160_100,
      });
      const account = await createTestAccount(user._id);

      // Seed holding: 10 shares bought @ 150,000 paise (totalInvested = 1,500,000 paise)
      const initialHolding = await createTestHolding(
        user._id,
        account._id,
        instrument._id,
        {
          symbol: "HDFCBANK",
          quantity: 10,
          averageBuyPricePaise: 150_000,
          totalInvestedPaise: 1_500_000,
          realizedPnlPaise: 0,
        }
      );

      const service = new OrderExecutionService();
      // Sell 4 shares @ bid 160,000 paise
      // proceeds = 4 * 160,000 = 640,000 paise
      // costBasisSold = 4 * 150,000 = 600,000 paise
      // realizedPnl = 640,000 - 600,000 = +40,000 paise
      const sellResult = await service.executeMarketOrder({
        userId: user._id,
        practiceAccountId: account._id,
        instrumentId: instrument._id,
        side: "SELL",
        quantity: 4,
        idempotencyKey: "hdfc-partial-sell-1",
      });

      assert.equal(sellResult.status, "EXECUTED");
      if (sellResult.status !== "EXECUTED") return;

      assert.equal(sellResult.executionPricePaise, 160_000);
      assert.equal(sellResult.totalValuePaise, 640_000);
      assert.equal(sellResult.costBasisSoldPaise, 600_000);
      assert.equal(sellResult.realizedPnlPaise, 40_000);
      assert.equal(sellResult.cashBalanceBeforePaise, 100_000_000);
      assert.equal(sellResult.updatedCashBalancePaise, 100_640_000);

      // 1. Verify in real MongoDB: Account balance credited
      const updatedAccount = await PracticeAccountModel.findById(
        account._id
      ).lean();
      assert.equal(updatedAccount?.cashBalancePaise, 100_640_000);

      // 2. Verify in real MongoDB: Holding quantity & cost basis reduced
      const updatedHolding = await HoldingModel.findById(
        initialHolding._id
      ).lean();
      assert.ok(updatedHolding);
      assert.equal(updatedHolding.quantity, 6);
      assert.equal(updatedHolding.totalInvestedPaise, 900_000);
      assert.equal(updatedHolding.averageBuyPricePaise, 150_000);
      assert.equal(updatedHolding.realizedPnlPaise, 40_000);

      // 3. Verify in real MongoDB: Trade persisted with realized P&L
      const trade = await TradeModel.findById(sellResult.trade._id).lean();
      assert.ok(trade);
      assert.equal(trade.side, "SELL");
      assert.equal(trade.executionPricePaise, 160_000);
      assert.equal(trade.costBasisSoldPaise, 600_000);
      assert.equal(trade.realizedPnlPaise, 40_000);

      // 4. Verify in real MongoDB: LedgerEntry persisted with CREDIT
      const ledgerEntry = await LedgerEntryModel.findById(
        sellResult.ledgerEntry._id
      ).lean();
      assert.ok(ledgerEntry);
      assert.equal(ledgerEntry.entryType, "SELL_EXECUTION");
      assert.equal(ledgerEntry.direction, "CREDIT");
      assert.equal(ledgerEntry.amountPaise, 640_000);
      assert.equal(ledgerEntry.balanceBeforePaise, 100_000_000);
      assert.equal(ledgerEntry.balanceAfterPaise, 100_640_000);
    });

    it("retains zero-quantity holding on full exit (never deletes document) and preserves cumulative realized P&L", async () => {
      const user = await createTestUser();
      const instrument = await createTestInstrument({
        symbol: "SBIN",
        bidPricePaise: 500_000,
        askPricePaise: 500_100,
      });
      const account = await createTestAccount(user._id);

      // 2 shares @ 500,000 paise (totalInvested = 1,000,000 paise)
      const initialHolding = await createTestHolding(
        user._id,
        account._id,
        instrument._id,
        {
          symbol: "SBIN",
          quantity: 2,
          averageBuyPricePaise: 500_000,
          totalInvestedPaise: 1_000_000,
          realizedPnlPaise: 15_000, // existing prior realized P&L
        }
      );

      const service = new OrderExecutionService();
      // Sell all 2 shares @ 500,000 paise (break-even trade: realizedPnl = 0)
      const fullSellResult = await service.executeMarketOrder({
        userId: user._id,
        practiceAccountId: account._id,
        instrumentId: instrument._id,
        side: "SELL",
        quantity: 2,
        idempotencyKey: "sbin-full-exit-sell",
      });

      assert.equal(fullSellResult.status, "EXECUTED");
      if (fullSellResult.status !== "EXECUTED") return;

      assert.equal(fullSellResult.costBasisSoldPaise, 1_000_000);
      assert.equal(fullSellResult.realizedPnlPaise, 0);

      // Verify in real MongoDB: Holding is retained, NOT deleted
      const holdingInDb = await HoldingModel.findById(
        initialHolding._id
      ).lean();
      assert.ok(holdingInDb, "Holding document must be retained upon full exit");
      assert.equal(holdingInDb.quantity, 0);
      assert.equal(holdingInDb.averageBuyPricePaise, 0);
      assert.equal(holdingInDb.totalInvestedPaise, 0);
      assert.equal(holdingInDb.realizedPnlPaise, 15_000);
    });

    it("rejects SELL with INSUFFICIENT_QUANTITY when holding quantity is less than requested quantity", async () => {
      const user = await createTestUser();
      const instrument = await createTestInstrument();
      const account = await createTestAccount(user._id);

      // Holding with only 3 shares
      await createTestHolding(user._id, account._id, instrument._id, {
        quantity: 3,
      });

      const service = new OrderExecutionService();
      // Attempt to sell 5 shares
      const result = await service.executeMarketOrder({
        userId: user._id,
        practiceAccountId: account._id,
        instrumentId: instrument._id,
        side: "SELL",
        quantity: 5,
        idempotencyKey: "reject-insufficient-quantity",
      });

      assert.equal(result.status, "REJECTED");
      if (result.status !== "REJECTED") return;

      assert.equal(result.rejectionCode, "INSUFFICIENT_QUANTITY");
      assert.equal(result.trade, null);
      assert.equal(result.ledgerEntry, null);

      // Verify DB state: holding still has 3 shares, account balance untouched
      const holdingInDb = await HoldingModel.findOne({
        practiceAccountId: account._id,
        instrumentId: instrument._id,
      }).lean();
      assert.equal(holdingInDb?.quantity, 3);

      const accountInDb = await PracticeAccountModel.findById(
        account._id
      ).lean();
      assert.equal(accountInDb?.cashBalancePaise, 100_000_000);
    });
  });

  describe("Part G — Real MongoDB Transaction Rollback Verification", () => {
    it("rolls back all writes atomically across Order, Account, Holding, Trade, and Ledger if an error occurs mid-transaction", async () => {
      const user = await createTestUser();
      const instrument = await createTestInstrument({
        askPricePaise: 200_000,
        bidPricePaise: 199_950,
      });
      const account = await createTestAccount(user._id);

      // Create an execution repository that fails at the final step (createLedgerEntry)
      const realRepo = new MongooseOrderExecutionRepository();
      const failingRepo = {
        findUserById: realRepo.findUserById.bind(realRepo),
        findPracticeAccountById:
          realRepo.findPracticeAccountById.bind(realRepo),
        findOrderByAccountAndIdempotencyKey:
          realRepo.findOrderByAccountAndIdempotencyKey.bind(realRepo),
        findTradeByOrderId: realRepo.findTradeByOrderId.bind(realRepo),
        findLedgerEntryByTradeId:
          realRepo.findLedgerEntryByTradeId.bind(realRepo),
        findHoldingByAccountAndInstrument:
          realRepo.findHoldingByAccountAndInstrument.bind(realRepo),
        debitPracticeAccountBalance:
          realRepo.debitPracticeAccountBalance.bind(realRepo),
        creditPracticeAccountBalance:
          realRepo.creditPracticeAccountBalance.bind(realRepo),
        createOrder: realRepo.createOrder.bind(realRepo),
        createTrade: realRepo.createTrade.bind(realRepo),
        saveHoldingAfterBuy: realRepo.saveHoldingAfterBuy.bind(realRepo),
        updateHoldingAfterSell:
          realRepo.updateHoldingAfterSell.bind(realRepo),
        createLedgerEntry: async () => {
          throw new Error("Simulated mid-transaction failure during ledger creation");
        },
      };

      const service = new OrderExecutionService({ repository: failingRepo });

      await assert.rejects(
        () =>
          service.executeMarketOrder({
            userId: user._id,
            practiceAccountId: account._id,
            instrumentId: instrument._id,
            side: "BUY",
            quantity: 5,
            idempotencyKey: "atomic-rollback-key",
          }),
        (err: unknown) =>
          err instanceof OrderExecutionError && err.code === "EXECUTION_FAILED"
      );

      // Verify REAL MongoDB state: ZERO writes persisted
      // 1. Order was rolled back
      const ordersInDb = await OrderModel.find({
        practiceAccountId: account._id,
        idempotencyKey: "atomic-rollback-key",
      }).lean();
      assert.equal(ordersInDb.length, 0);

      // 2. Trade was rolled back
      const tradesInDb = await TradeModel.find({
        practiceAccountId: account._id,
      }).lean();
      assert.equal(tradesInDb.length, 0);

      // 3. Holding was rolled back
      const holdingsInDb = await HoldingModel.find({
        practiceAccountId: account._id,
        instrumentId: instrument._id,
      }).lean();
      assert.equal(holdingsInDb.length, 0);

      // 4. Account balance was rolled back
      const accountInDb = await PracticeAccountModel.findById(
        account._id
      ).lean();
      assert.equal(accountInDb?.cashBalancePaise, 100_000_000);
      assert.equal(accountInDb?.version, 1);

      // 5. Ledger entries untouched (only 1 initial funding entry)
      const ledgerEntriesInDb = await LedgerEntryModel.find({
        practiceAccountId: account._id,
      }).lean();
      assert.equal(ledgerEntriesInDb.length, 1);
      assert.equal(ledgerEntriesInDb[0].entryType, "INITIAL_FUNDING");
    });
  });

  describe("Part H — Financial Reconciliation Across Lifecycle", () => {
    it("maintains strict mathematical reconciliation between cash balance, executed trades, and immutable ledger history across multiple trades", async () => {
      const user = await createTestUser();
      const instA = await createTestInstrument({
        symbol: "STOCKA",
        bidPricePaise: 100_000,
        lastPricePaise: 100_050,
        askPricePaise: 100_100,
      });
      const instB = await createTestInstrument({
        symbol: "STOCKB",
        bidPricePaise: 200_000,
        lastPricePaise: 200_050,
        askPricePaise: 200_100,
      });
      const account = await createTestAccount(user._id);

      const service = new OrderExecutionService();

      // Step 1: BUY 10 STOCKA @ 100,100 paise = 1,001,000 paise
      const buyA1 = await service.executeMarketOrder({
        userId: user._id,
        practiceAccountId: account._id,
        instrumentId: instA._id,
        side: "BUY",
        quantity: 10,
        idempotencyKey: "lifecycle-1",
      });
      assert.equal(buyA1.status, "EXECUTED");

      // Step 2: BUY 5 STOCKB @ 200,100 paise = 1,000,500 paise
      const buyB1 = await service.executeMarketOrder({
        userId: user._id,
        practiceAccountId: account._id,
        instrumentId: instB._id,
        side: "BUY",
        quantity: 5,
        idempotencyKey: "lifecycle-2",
      });
      assert.equal(buyB1.status, "EXECUTED");

      // Step 3: SELL 4 STOCKA @ 105,000 paise = 420,000 paise (gain: 420,000 - 400,400 = 19,600 paise)
      await InstrumentModel.findByIdAndUpdate(instA._id, {
        bidPricePaise: 105_000,
        lastPricePaise: 105_050,
        askPricePaise: 105_100,
        priceUpdatedAt: new Date(),
      });
      const sellA1 = await service.executeMarketOrder({
        userId: user._id,
        practiceAccountId: account._id,
        instrumentId: instA._id,
        side: "SELL",
        quantity: 4,
        idempotencyKey: "lifecycle-3",
      });
      assert.equal(sellA1.status, "EXECUTED");

      // Step 4: SELL remaining 6 STOCKA @ 110,000 paise = 660,000 paise (full exit)
      await InstrumentModel.findByIdAndUpdate(instA._id, {
        bidPricePaise: 110_000,
        lastPricePaise: 110_050,
        askPricePaise: 110_100,
        priceUpdatedAt: new Date(),
      });
      const sellA2 = await service.executeMarketOrder({
        userId: user._id,
        practiceAccountId: account._id,
        instrumentId: instA._id,
        side: "SELL",
        quantity: 6,
        idempotencyKey: "lifecycle-4",
      });
      assert.equal(sellA2.status, "EXECUTED");

      // Verify DB State & Reconciliation
      // Expected cash balance: 100,000,000 - 1,001,000 - 1,000,500 + 420,000 + 660,000 = 99,078,500 paise
      const finalAccountInDb = await PracticeAccountModel.findById(
        account._id
      ).lean();
      assert.ok(finalAccountInDb);
      assert.equal(finalAccountInDb.cashBalancePaise, 99_078_500);

      // Ledger reconciliation:
      const ledgerEntries = await LedgerEntryModel.find({
        practiceAccountId: account._id,
      })
        .sort({ createdAt: 1, _id: 1 })
        .lean();

      assert.equal(ledgerEntries.length, 5); // 1 Initial + 4 trades

      let runningBalance = 0;
      for (const entry of ledgerEntries) {
        assert.equal(entry.balanceBeforePaise, runningBalance);
        if (entry.direction === "CREDIT") {
          runningBalance += entry.amountPaise;
        } else {
          runningBalance -= entry.amountPaise;
        }
        assert.equal(entry.balanceAfterPaise, runningBalance);
      }

      assert.equal(runningBalance, finalAccountInDb.cashBalancePaise);

      // 1:1 relationship checks
      const orders = await OrderModel.find({
        practiceAccountId: account._id,
      }).lean();
      const trades = await TradeModel.find({
        practiceAccountId: account._id,
      }).lean();

      assert.equal(orders.length, 4);
      assert.equal(trades.length, 4);

      for (const order of orders) {
        const matchingTrade = trades.find(
          (t) => t.orderId.toString() === order._id.toString()
        );
        assert.ok(matchingTrade, `Every order must have a matching trade`);
        assert.equal(order.totalValuePaise, matchingTrade.totalValuePaise);
        assert.equal(order.executedQuantity, matchingTrade.quantity);

        const matchingLedger = ledgerEntries.find(
          (l) =>
            l.referenceType === "TRADE" &&
            l.referenceId.toString() === matchingTrade._id.toString()
        );
        assert.ok(
          matchingLedger,
          `Every trade must have a matching ledger entry`
        );
        assert.equal(matchingTrade.totalValuePaise, matchingLedger.amountPaise);
      }
    });
  });
});
