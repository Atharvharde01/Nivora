import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ClientSession, Types } from "mongoose";
import { HoldingModel } from "../holdings/holding.model";
import {
  InstrumentQuoteError,
  InstrumentQuoteSnapshot,
} from "../instruments/instrument-quote.types";
import { LedgerEntryModel } from "../ledger/ledger.model";
import { PersistedHoldingRecord } from "../portfolio/portfolio.types";
import { PracticeAccountModel } from "../practice-accounts/account.model";
import { DEFAULT_INITIAL_BALANCE_PAISE } from "../practice-accounts/account.schema";
import {
  PersistedLedgerEntryRecord,
  PersistedPracticeAccountRecord,
} from "../practice-accounts/account.service.types";
import { TradeModel } from "../trades/trade.model";
import { OrderModel } from "./order.model";
import { OrderExecutionService } from "./order-execution.service";
import {
  CreateExecutionLedgerPersistenceInput,
  CreateOrderPersistenceInput,
  CreateTradePersistenceInput,
  OrderExecutionError,
  OrderExecutionRepositoryPort,
  PersistedOrderRecord,
  PersistedTradeRecord,
  PersistedUserExecutionRecord,
  UpdateHoldingOnSellInput,
  UpsertHoldingOnBuyInput,
} from "./order-execution.types";

interface StoreState {
  users: Map<string, PersistedUserExecutionRecord>;
  accounts: Map<string, PersistedPracticeAccountRecord>;
  holdings: Map<string, PersistedHoldingRecord>;
  orders: PersistedOrderRecord[];
  trades: PersistedTradeRecord[];
  ledgerEntries: PersistedLedgerEntryRecord[];
}

function cloneState(state: StoreState): StoreState {
  return {
    users: new Map(
      Array.from(state.users.entries()).map(([k, v]) => [k, { ...v }])
    ),
    accounts: new Map(
      Array.from(state.accounts.entries()).map(([k, v]) => [k, { ...v }])
    ),
    holdings: new Map(
      Array.from(state.holdings.entries()).map(([k, v]) => [k, { ...v }])
    ),
    orders: state.orders.map((o) => ({ ...o })),
    trades: state.trades.map((t) => ({
      ...t,
      quoteSnapshot: { ...t.quoteSnapshot },
    })),
    ledgerEntries: state.ledgerEntries.map((l) => ({ ...l })),
  };
}

class InMemoryTransactionalOrderExecutionStore
  implements OrderExecutionRepositoryPort
{
  public committedState: StoreState = {
    users: new Map(),
    accounts: new Map(),
    holdings: new Map(),
    orders: [],
    trades: [],
    ledgerEntries: [],
  };

  private activeTxState: StoreState | null = null;
  public failOnMethod:
    | "createOrder"
    | "saveHoldingAfterBuy"
    | "updateHoldingAfterSell"
    | "createTrade"
    | "createLedgerEntry"
    | null = null;

  private get state(): StoreState {
    return this.activeTxState ?? this.committedState;
  }

  public runInTransaction = async <T>(
    work: (session: ClientSession) => Promise<T>
  ): Promise<T> => {
    this.activeTxState = cloneState(this.committedState);
    try {
      const result = await work({} as ClientSession);
      this.committedState = this.activeTxState;
      return result;
    } finally {
      this.activeTxState = null;
    }
  };

  public seedUser(user: PersistedUserExecutionRecord): void {
    this.committedState.users.set(user._id.toString(), { ...user });
  }

  public seedAccount(account: PersistedPracticeAccountRecord): void {
    const doc = new PracticeAccountModel(account);
    const err = doc.validateSync();
    assert.equal(err, undefined, `Invalid seeded PracticeAccount: ${err?.message}`);
    this.committedState.accounts.set(account._id.toString(), { ...account });
  }

  public seedInitialLedger(entry: PersistedLedgerEntryRecord): void {
    const doc = new LedgerEntryModel(entry);
    const err = doc.validateSync();
    assert.equal(err, undefined, `Invalid seeded LedgerEntry: ${err?.message}`);
    this.committedState.ledgerEntries.push({ ...entry });
  }

  public async findUserById(
    userId: Types.ObjectId
  ): Promise<PersistedUserExecutionRecord | null> {
    return this.state.users.get(userId.toString()) ?? null;
  }

  public async findPracticeAccountById(
    accountId: Types.ObjectId
  ): Promise<PersistedPracticeAccountRecord | null> {
    const acc = this.state.accounts.get(accountId.toString());
    return acc ? { ...acc } : null;
  }

  public async findOrderByAccountAndIdempotencyKey(
    practiceAccountId: Types.ObjectId,
    idempotencyKey: string
  ): Promise<PersistedOrderRecord | null> {
    const found = this.state.orders.find(
      (o) =>
        o.practiceAccountId.toString() === practiceAccountId.toString() &&
        o.idempotencyKey === idempotencyKey
    );
    return found ? { ...found } : null;
  }

  public async findTradeByOrderId(
    orderId: Types.ObjectId
  ): Promise<PersistedTradeRecord | null> {
    const found = this.state.trades.find(
      (t) => t.orderId.toString() === orderId.toString()
    );
    return found
      ? { ...found, quoteSnapshot: { ...found.quoteSnapshot } }
      : null;
  }

  public async findLedgerEntryByTradeId(
    tradeId: Types.ObjectId
  ): Promise<PersistedLedgerEntryRecord | null> {
    const found = this.state.ledgerEntries.find(
      (l) =>
        l.referenceType === "TRADE" &&
        l.referenceId.toString() === tradeId.toString()
    );
    return found ? { ...found } : null;
  }

  public async findHoldingByAccountAndInstrument(
    practiceAccountId: Types.ObjectId,
    userId: Types.ObjectId,
    instrumentId: Types.ObjectId
  ): Promise<PersistedHoldingRecord | null> {
    const key = `${practiceAccountId.toString()}:${instrumentId.toString()}`;
    const found = this.state.holdings.get(key);
    if (!found || found.userId.toString() !== userId.toString()) {
      return null;
    }
    return { ...found };
  }

  public async debitPracticeAccountBalance(params: {
    accountId: Types.ObjectId;
    userId: Types.ObjectId;
    expectedVersion: number;
    debitAmountPaise: number;
  }): Promise<PersistedPracticeAccountRecord | null> {
    const current = this.state.accounts.get(params.accountId.toString());
    if (
      !current ||
      current.userId.toString() !== params.userId.toString() ||
      current.status !== "ACTIVE" ||
      current.version !== params.expectedVersion ||
      current.cashBalancePaise < params.debitAmountPaise
    ) {
      return null;
    }

    const updated: PersistedPracticeAccountRecord = {
      ...current,
      cashBalancePaise: current.cashBalancePaise - params.debitAmountPaise,
      version: current.version + 1,
      updatedAt: new Date("2026-03-31T10:00:00.000Z"),
    };
    const doc = new PracticeAccountModel(updated);
    assert.equal(doc.validateSync(), undefined);
    this.state.accounts.set(updated._id.toString(), updated);
    return { ...updated };
  }

  public async creditPracticeAccountBalance(params: {
    accountId: Types.ObjectId;
    userId: Types.ObjectId;
    expectedVersion: number;
    creditAmountPaise: number;
  }): Promise<PersistedPracticeAccountRecord | null> {
    const current = this.state.accounts.get(params.accountId.toString());
    if (
      !current ||
      current.userId.toString() !== params.userId.toString() ||
      current.status !== "ACTIVE" ||
      current.version !== params.expectedVersion ||
      current.cashBalancePaise >
        Number.MAX_SAFE_INTEGER - params.creditAmountPaise
    ) {
      return null;
    }

    const updated: PersistedPracticeAccountRecord = {
      ...current,
      cashBalancePaise: current.cashBalancePaise + params.creditAmountPaise,
      version: current.version + 1,
      updatedAt: new Date("2026-03-31T10:00:00.000Z"),
    };
    const doc = new PracticeAccountModel(updated);
    assert.equal(doc.validateSync(), undefined);
    this.state.accounts.set(updated._id.toString(), updated);
    return { ...updated };
  }

  public async createOrder(
    input: CreateOrderPersistenceInput
  ): Promise<PersistedOrderRecord> {
    if (this.failOnMethod === "createOrder") {
      throw new Error("Simulated createOrder database failure");
    }
    const doc = new OrderModel(input);
    const err = doc.validateSync();
    assert.equal(err, undefined, `Order schema validation failed: ${err?.message}`);

    const now = new Date("2026-03-31T10:00:00.000Z");
    const record: PersistedOrderRecord = {
      ...(doc.toObject() as unknown as PersistedOrderRecord),
      _id: doc._id,
      createdAt: now,
      updatedAt: now,
    };
    this.state.orders.push(record);
    return { ...record };
  }

  public async createTrade(
    input: CreateTradePersistenceInput
  ): Promise<PersistedTradeRecord> {
    if (this.failOnMethod === "createTrade") {
      throw new Error("Simulated createTrade database failure");
    }
    const doc = new TradeModel(input);
    const err = doc.validateSync();
    assert.equal(err, undefined, `Trade schema validation failed: ${err?.message}`);

    const now = new Date("2026-03-31T10:00:00.000Z");
    const record: PersistedTradeRecord = {
      ...(doc.toObject() as unknown as PersistedTradeRecord),
      _id: doc._id,
      createdAt: now,
    };
    this.state.trades.push(record);
    return { ...record, quoteSnapshot: { ...record.quoteSnapshot } };
  }

  public async createLedgerEntry(
    input: CreateExecutionLedgerPersistenceInput
  ): Promise<PersistedLedgerEntryRecord> {
    if (this.failOnMethod === "createLedgerEntry") {
      throw new Error("Simulated createLedgerEntry database failure");
    }
    const doc = new LedgerEntryModel(input);
    const err = doc.validateSync();
    assert.equal(
      err,
      undefined,
      `LedgerEntry schema validation failed: ${err?.message}`
    );

    const record: PersistedLedgerEntryRecord = {
      ...(doc.toObject() as unknown as PersistedLedgerEntryRecord),
      _id: doc._id,
      createdAt: new Date("2026-03-31T10:00:00.000Z"),
    };
    this.state.ledgerEntries.push(record);
    return { ...record };
  }

  public async saveHoldingAfterBuy(
    input: UpsertHoldingOnBuyInput
  ): Promise<PersistedHoldingRecord | null> {
    if (this.failOnMethod === "saveHoldingAfterBuy") {
      throw new Error("Simulated saveHoldingAfterBuy database failure");
    }
    const key = `${input.practiceAccountId.toString()}:${input.instrumentId.toString()}`;
    const existing = this.state.holdings.get(key);

    if (input.existingHoldingId) {
      if (
        !existing ||
        existing._id.toString() !== input.existingHoldingId.toString() ||
        existing.version !== input.expectedVersion
      ) {
        return null;
      }
    }

    const now = new Date("2026-03-31T10:00:00.000Z");
    const record: PersistedHoldingRecord = {
      _id: existing?._id ?? new Types.ObjectId(),
      userId: input.userId,
      practiceAccountId: input.practiceAccountId,
      instrumentId: input.instrumentId,
      symbol: input.symbol,
      exchange: input.exchange,
      quantity: input.newQuantity,
      averageBuyPricePaise: input.newAverageBuyPricePaise,
      totalInvestedPaise: input.newTotalInvestedPaise,
      realizedPnlPaise: input.newRealizedPnlPaise,
      version: input.newVersion,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    const doc = new HoldingModel(record);
    const err = doc.validateSync();
    assert.equal(err, undefined, `Holding schema validation failed: ${err?.message}`);

    this.state.holdings.set(key, record);
    return { ...record };
  }

  public async updateHoldingAfterSell(
    input: UpdateHoldingOnSellInput
  ): Promise<PersistedHoldingRecord | null> {
    if (this.failOnMethod === "updateHoldingAfterSell") {
      throw new Error("Simulated updateHoldingAfterSell database failure");
    }
    const key = `${input.practiceAccountId.toString()}:${input.instrumentId.toString()}`;
    const existing = this.state.holdings.get(key);

    if (
      !existing ||
      existing._id.toString() !== input.holdingId.toString() ||
      existing.version !== input.expectedVersion ||
      existing.quantity < input.sellQuantity
    ) {
      return null;
    }

    const updated: PersistedHoldingRecord = {
      ...existing,
      symbol: input.symbol,
      quantity: input.newQuantity,
      averageBuyPricePaise: input.newAverageBuyPricePaise,
      totalInvestedPaise: input.newTotalInvestedPaise,
      realizedPnlPaise: input.newRealizedPnlPaise,
      version: input.newVersion,
      updatedAt: new Date("2026-03-31T10:00:00.000Z"),
    };

    const doc = new HoldingModel(updated);
    const err = doc.validateSync();
    assert.equal(err, undefined, `Holding schema validation failed: ${err?.message}`);

    this.state.holdings.set(key, updated);
    return { ...updated };
  }
}

function buildQuote(
  instrumentId: Types.ObjectId,
  overrides: Partial<InstrumentQuoteSnapshot> = {}
): InstrumentQuoteSnapshot {
  return {
    instrumentId,
    symbol: "RELIANCE",
    exchange: "NSE",
    isTradable: true,
    lastPricePaise: 250_000,
    bidPricePaise: 249_950,
    askPricePaise: 250_050,
    previousClosePaise: 248_000,
    priceUpdatedAt: new Date("2026-03-31T09:59:55.000Z"),
    quoteSource: "SIMULATED",
    quoteAgeMs: 5_000,
    isStale: false,
    ...overrides,
  };
}

function createTestHarness() {
  const store = new InMemoryTransactionalOrderExecutionStore();
  const userId = new Types.ObjectId();
  const accountId = new Types.ObjectId();
  const instrumentId = new Types.ObjectId();
  const fixedNow = new Date("2026-03-31T10:00:00.000Z");

  store.seedUser({ _id: userId, status: "ACTIVE" });
  store.seedAccount({
    _id: accountId,
    userId,
    accountNumber: 1,
    status: "ACTIVE",
    initialBalancePaise: DEFAULT_INITIAL_BALANCE_PAISE,
    cashBalancePaise: DEFAULT_INITIAL_BALANCE_PAISE,
    version: 1,
    createdAt: new Date("2026-03-31T09:00:00.000Z"),
    updatedAt: new Date("2026-03-31T09:00:00.000Z"),
  });
  store.seedInitialLedger({
    _id: new Types.ObjectId(),
    userId,
    practiceAccountId: accountId,
    entryType: "INITIAL_FUNDING",
    direction: "CREDIT",
    amountPaise: DEFAULT_INITIAL_BALANCE_PAISE,
    balanceBeforePaise: 0,
    balanceAfterPaise: DEFAULT_INITIAL_BALANCE_PAISE,
    referenceType: "PRACTICE_ACCOUNT",
    referenceId: accountId,
    idempotencyKey: `INITIAL_FUNDING:${accountId.toString()}`,
    description: "Initial virtual cash funding for practice account #1",
    createdAt: new Date("2026-03-31T09:00:00.000Z"),
  });

  const quotes = new Map<string, InstrumentQuoteSnapshot>();
  quotes.set(instrumentId.toString(), buildQuote(instrumentId));

  let quoteErrorToThrow: InstrumentQuoteError | null = null;

  const service = new OrderExecutionService({
    repository: store,
    runInTransaction: store.runInTransaction,
    nowProvider: () => fixedNow,
    quoteService: {
      async getQuoteByInstrumentId(id) {
        if (quoteErrorToThrow) {
          throw quoteErrorToThrow;
        }
        const q = quotes.get(id.toString());
        if (!q) {
          throw new InstrumentQuoteError(
            "INSTRUMENT_NOT_FOUND",
            `Instrument ${id.toString()} not found.`
          );
        }
        return q;
      },
    },
  });

  return {
    store,
    service,
    userId,
    accountId,
    instrumentId,
    fixedNow,
    quotes,
    setQuoteError(err: InstrumentQuoteError | null) {
      quoteErrorToThrow = err;
    },
  };
}

describe("Task 19 — OrderExecutionService", () => {
  describe("BUY Execution Cases", () => {
    it("executes BUY at askPricePaise, deducts cash, creates new holding, trade snapshot, and DEBIT ledger entry", async () => {
      const { store, service, userId, accountId, instrumentId } =
        createTestHarness();

      const result = await service.executeMarketOrder({
        userId,
        practiceAccountId: accountId,
        instrumentId,
        side: "BUY",
        quantity: 10,
        idempotencyKey: "buy-reliance-1",
      });

      assert.equal(result.status, "EXECUTED");
      if (result.status !== "EXECUTED") return;

      assert.equal(result.wasIdempotentReplay, false);
      assert.equal(result.side, "BUY");
      assert.equal(result.quantity, 10);
      assert.equal(result.executionPricePaise, 250_050); // askPricePaise
      assert.equal(result.totalValuePaise, 2_500_500);
      assert.equal(result.costBasisSoldPaise, 0);
      assert.equal(result.realizedPnlPaise, 0);
      assert.equal(result.cashBalanceBeforePaise, 100_000_000);
      assert.equal(result.updatedCashBalancePaise, 97_499_500);

      // Verify new holding
      assert.equal(result.updatedHolding.quantity, 10);
      assert.equal(result.updatedHolding.averageBuyPricePaise, 250_050);
      assert.equal(result.updatedHolding.totalInvestedPaise, 2_500_500);
      assert.equal(result.updatedHolding.realizedPnlPaise, 0);
      assert.equal(result.updatedHolding.version, 1);

      // Verify immutable BUY trade snapshot
      assert.equal(result.trade.orderId.toString(), result.order._id.toString());
      assert.equal(result.trade.side, "BUY");
      assert.equal(result.trade.executionPricePaise, 250_050);
      assert.equal(result.trade.totalValuePaise, 2_500_500);
      assert.equal(result.trade.costBasisSoldPaise, 0);
      assert.equal(result.trade.realizedPnlPaise, 0);
      assert.equal(result.trade.quoteSnapshot.lastPricePaise, 250_000);
      assert.equal(result.trade.quoteSnapshot.bidPricePaise, 249_950);
      assert.equal(result.trade.quoteSnapshot.askPricePaise, 250_050);

      // Verify immutable BUY ledger DEBIT entry
      assert.equal(result.ledgerEntry.entryType, "BUY_EXECUTION");
      assert.equal(result.ledgerEntry.direction, "DEBIT");
      assert.equal(result.ledgerEntry.amountPaise, 2_500_500);
      assert.equal(result.ledgerEntry.balanceBeforePaise, 100_000_000);
      assert.equal(result.ledgerEntry.balanceAfterPaise, 97_499_500);
      assert.equal(result.ledgerEntry.referenceType, "TRADE");
      assert.equal(
        result.ledgerEntry.referenceId.toString(),
        result.trade._id.toString()
      );

      // Verify store state
      const storedAccount = store.committedState.accounts.get(
        accountId.toString()
      );
      assert.equal(storedAccount?.cashBalancePaise, 97_499_500);
      assert.equal(storedAccount?.version, 2);
    });

    it("updates an existing holding with weighted average buy price on subsequent BUY", async () => {
      const { service, userId, accountId, instrumentId, quotes } =
        createTestHarness();

      // First BUY: 1 shares @ 100 paise
      quotes.set(
        instrumentId.toString(),
        buildQuote(instrumentId, {
          bidPricePaise: 95,
          lastPricePaise: 100,
          askPricePaise: 100,
        })
      );
      await service.executeMarketOrder({
        userId,
        practiceAccountId: accountId,
        instrumentId,
        side: "BUY",
        quantity: 1,
        idempotencyKey: "buy-step-1",
      });

      // Second BUY: 2 shares @ 101 paise -> totalInvested = 302, avg = round(302 / 3) = 101
      quotes.set(
        instrumentId.toString(),
        buildQuote(instrumentId, {
          bidPricePaise: 100,
          lastPricePaise: 101,
          askPricePaise: 101,
        })
      );
      const secondBuy = await service.executeMarketOrder({
        userId,
        practiceAccountId: accountId,
        instrumentId,
        side: "BUY",
        quantity: 2,
        idempotencyKey: "buy-step-2",
      });

      assert.equal(secondBuy.status, "EXECUTED");
      if (secondBuy.status !== "EXECUTED") return;

      assert.equal(secondBuy.updatedHolding.quantity, 3);
      assert.equal(secondBuy.updatedHolding.totalInvestedPaise, 302);
      assert.equal(secondBuy.updatedHolding.averageBuyPricePaise, 101);
      assert.equal(secondBuy.updatedHolding.version, 2);
      assert.equal(secondBuy.updatedCashBalancePaise, 100_000_000 - 302);
    });

    it("rejects BUY with INSUFFICIENT_FUNDS when totalValuePaise exceeds cashBalancePaise with zero financial mutations", async () => {
      const { store, service, userId, accountId, instrumentId } =
        createTestHarness();

      // 500 shares @ 250,050 paise = 125,025,000 paise > 100,000,000 paise
      const result = await service.executeMarketOrder({
        userId,
        practiceAccountId: accountId,
        instrumentId,
        side: "BUY",
        quantity: 500,
        idempotencyKey: "buy-insufficient-funds",
      });

      assert.equal(result.status, "REJECTED");
      if (result.status !== "REJECTED") return;

      assert.equal(result.rejectionCode, "INSUFFICIENT_FUNDS");
      assert.equal(result.trade, null);
      assert.equal(result.ledgerEntry, null);
      assert.equal(
        result.cashBalanceBeforePaise,
        DEFAULT_INITIAL_BALANCE_PAISE
      );
      assert.equal(
        result.updatedCashBalancePaise,
        DEFAULT_INITIAL_BALANCE_PAISE
      );
      assert.equal(result.updatedHolding, null);

      // Order persisted as REJECTED, no Trade, no extra LedgerEntry, balance unchanged
      assert.equal(store.committedState.orders.length, 1);
      assert.equal(store.committedState.orders[0]?.status, "REJECTED");
      assert.equal(
        store.committedState.orders[0]?.rejectionCode,
        "INSUFFICIENT_FUNDS"
      );
      assert.equal(store.committedState.trades.length, 0);
      assert.equal(store.committedState.ledgerEntries.length, 1); // only initial funding
      assert.equal(store.committedState.holdings.size, 0);
      assert.equal(
        store.committedState.accounts.get(accountId.toString())
          ?.cashBalancePaise,
        DEFAULT_INITIAL_BALANCE_PAISE
      );
    });

    it("rejects invalid BUY quantities (zero, negative, fractional, unsafe integer)", async () => {
      const { service, userId, accountId, instrumentId } = createTestHarness();

      for (const invalidQty of [0, -5, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
        await assert.rejects(
          () =>
            service.executeMarketOrder({
              userId,
              practiceAccountId: accountId,
              instrumentId,
              side: "BUY",
              quantity: invalidQty,
              idempotencyKey: `invalid-qty-${String(invalidQty)}`,
            }),
          (err: unknown) =>
            err instanceof OrderExecutionError &&
            err.code === "VALIDATION_ERROR"
        );
      }
    });
  });

  describe("SELL Execution Cases", () => {
    it("executes partial SELL at bidPricePaise, credits cash, reduces cost basis proportionally, records realized profit and CREDIT ledger entry", async () => {
      const { service, userId, accountId, instrumentId, quotes } =
        createTestHarness();

      // Buy 10 shares @ ask = 250,050 (totalInvested = 2,500,500)
      await service.executeMarketOrder({
        userId,
        practiceAccountId: accountId,
        instrumentId,
        side: "BUY",
        quantity: 10,
        idempotencyKey: "buy-before-partial-sell",
      });

      // Price rises: bid = 260,050, ask = 260,150
      quotes.set(
        instrumentId.toString(),
        buildQuote(instrumentId, {
          bidPricePaise: 260_050,
          lastPricePaise: 260_100,
          askPricePaise: 260_150,
        })
      );

      // Sell 4 shares @ bid = 260,050 (proceeds = 1,040,200, costBasisSold = 1,000,200, realizedPnl = +40,000)
      const sellResult = await service.executeMarketOrder({
        userId,
        practiceAccountId: accountId,
        instrumentId,
        side: "SELL",
        quantity: 4,
        idempotencyKey: "partial-sell-profit",
      });

      assert.equal(sellResult.status, "EXECUTED");
      if (sellResult.status !== "EXECUTED") return;

      assert.equal(sellResult.side, "SELL");
      assert.equal(sellResult.quantity, 4);
      assert.equal(sellResult.executionPricePaise, 260_050); // bidPricePaise
      assert.equal(sellResult.totalValuePaise, 1_040_200);
      assert.equal(sellResult.costBasisSoldPaise, 1_000_200);
      assert.equal(sellResult.realizedPnlPaise, 40_000);
      assert.equal(sellResult.cashBalanceBeforePaise, 97_499_500);
      assert.equal(sellResult.updatedCashBalancePaise, 98_539_700);

      // Remaining holding: 6 shares, totalInvested = 1,500,300, avg = 250,050, realizedPnl = +40,000
      assert.equal(sellResult.updatedHolding.quantity, 6);
      assert.equal(sellResult.updatedHolding.totalInvestedPaise, 1_500_300);
      assert.equal(sellResult.updatedHolding.averageBuyPricePaise, 250_050);
      assert.equal(sellResult.updatedHolding.realizedPnlPaise, 40_000);
      assert.equal(sellResult.updatedHolding.version, 2);

      // Verify SELL ledger CREDIT entry
      assert.equal(sellResult.ledgerEntry.entryType, "SELL_EXECUTION");
      assert.equal(sellResult.ledgerEntry.direction, "CREDIT");
      assert.equal(sellResult.ledgerEntry.amountPaise, 1_040_200);
      assert.equal(sellResult.ledgerEntry.balanceBeforePaise, 97_499_500);
      assert.equal(sellResult.ledgerEntry.balanceAfterPaise, 98_539_700);
      assert.equal(sellResult.ledgerEntry.referenceType, "TRADE");
      assert.equal(
        sellResult.ledgerEntry.referenceId.toString(),
        sellResult.trade._id.toString()
      );
    });

    it("executes full exit SELL, retains holding with quantity = 0 (never deletes), and supports realized loss and break-even exit", async () => {
      const { store, service, userId, accountId, instrumentId, quotes } =
        createTestHarness();

      // Buy 5 shares @ ask = 200,000 (totalInvested = 1,000,000)
      quotes.set(
        instrumentId.toString(),
        buildQuote(instrumentId, {
          bidPricePaise: 199_900,
          lastPricePaise: 200_000,
          askPricePaise: 200_000,
        })
      );
      const buyRes = await service.executeMarketOrder({
        userId,
        practiceAccountId: accountId,
        instrumentId,
        side: "BUY",
        quantity: 5,
        idempotencyKey: "buy-5",
      });
      assert.equal(buyRes.status, "EXECUTED");
      const originalHoldingId = buyRes.updatedHolding?._id.toString();

      // Sell 2 shares at break-even (bid = 200,000 -> proceeds = 400,000, costBasis = 400,000, realizedPnl = 0)
      quotes.set(
        instrumentId.toString(),
        buildQuote(instrumentId, {
          bidPricePaise: 200_000,
          lastPricePaise: 200_050,
          askPricePaise: 200_100,
        })
      );
      const breakEvenSell = await service.executeMarketOrder({
        userId,
        practiceAccountId: accountId,
        instrumentId,
        side: "SELL",
        quantity: 2,
        idempotencyKey: "sell-breakeven-2",
      });
      assert.equal(breakEvenSell.status, "EXECUTED");
      if (breakEvenSell.status !== "EXECUTED") return;
      assert.equal(breakEvenSell.realizedPnlPaise, 0);
      assert.equal(breakEvenSell.costBasisSoldPaise, 400_000);
      assert.equal(breakEvenSell.updatedHolding.quantity, 3);
      assert.equal(breakEvenSell.updatedHolding.totalInvestedPaise, 600_000);

      // Sell remaining 3 shares at a loss (bid = 190,000 -> proceeds = 570,000, costBasis = 600,000, realizedPnl = -30,000)
      quotes.set(
        instrumentId.toString(),
        buildQuote(instrumentId, {
          bidPricePaise: 190_000,
          lastPricePaise: 190_050,
          askPricePaise: 190_100,
        })
      );
      const fullExitSell = await service.executeMarketOrder({
        userId,
        practiceAccountId: accountId,
        instrumentId,
        side: "SELL",
        quantity: 3,
        idempotencyKey: "sell-full-exit-loss-3",
      });

      assert.equal(fullExitSell.status, "EXECUTED");
      if (fullExitSell.status !== "EXECUTED") return;

      assert.equal(fullExitSell.realizedPnlPaise, -30_000);
      assert.equal(fullExitSell.costBasisSoldPaise, 600_000);

      // Holding is retained with quantity = 0, averageBuyPricePaise = 0, totalInvestedPaise = 0, cumulative realizedPnlPaise = -30,000
      assert.equal(fullExitSell.updatedHolding._id.toString(), originalHoldingId);
      assert.equal(fullExitSell.updatedHolding.quantity, 0);
      assert.equal(fullExitSell.updatedHolding.averageBuyPricePaise, 0);
      assert.equal(fullExitSell.updatedHolding.totalInvestedPaise, 0);
      assert.equal(fullExitSell.updatedHolding.realizedPnlPaise, -30_000);
      assert.equal(fullExitSell.updatedHolding.version, 3);
      assert.equal(store.committedState.holdings.size, 1);

      // Re-buying re-opens the same retained holding document and preserves cumulative realizedPnlPaise
      const reopenBuy = await service.executeMarketOrder({
        userId,
        practiceAccountId: accountId,
        instrumentId,
        side: "BUY",
        quantity: 2,
        idempotencyKey: "reopen-buy-2",
      });
      assert.equal(reopenBuy.status, "EXECUTED");
      if (reopenBuy.status !== "EXECUTED") return;
      assert.equal(reopenBuy.updatedHolding._id.toString(), originalHoldingId);
      assert.equal(reopenBuy.updatedHolding.quantity, 2);
      assert.equal(reopenBuy.updatedHolding.realizedPnlPaise, -30_000);
      assert.equal(reopenBuy.updatedHolding.version, 4);
    });

    it("rejects SELL with INSUFFICIENT_QUANTITY when holding is missing or smaller than requested quantity", async () => {
      const { store, service, userId, accountId, instrumentId } =
        createTestHarness();

      const result = await service.executeMarketOrder({
        userId,
        practiceAccountId: accountId,
        instrumentId,
        side: "SELL",
        quantity: 1,
        idempotencyKey: "sell-without-holding",
      });

      assert.equal(result.status, "REJECTED");
      if (result.status !== "REJECTED") return;

      assert.equal(result.rejectionCode, "INSUFFICIENT_QUANTITY");
      assert.equal(result.trade, null);
      assert.equal(result.ledgerEntry, null);
      assert.equal(
        result.updatedCashBalancePaise,
        DEFAULT_INITIAL_BALANCE_PAISE
      );
      assert.equal(store.committedState.orders.length, 1);
      assert.equal(store.committedState.trades.length, 0);
      assert.equal(store.committedState.ledgerEntries.length, 1);
    });
  });

  describe("Integrity, Security, Idempotency & Transaction Rollback Cases", () => {
    it("rejects any client-supplied price field with CLIENT_PRICE_NOT_ALLOWED", async () => {
      const { service, userId, accountId, instrumentId } = createTestHarness();

      for (const forbiddenField of [
        "executionPricePaise",
        "pricePaise",
        "price",
        "askPricePaise",
        "bidPricePaise",
        "totalValuePaise",
      ]) {
        await assert.rejects(
          () =>
            service.executeMarketOrder({
              userId,
              practiceAccountId: accountId,
              instrumentId,
              side: "BUY",
              quantity: 1,
              idempotencyKey: `forbidden-${forbiddenField}`,
              [forbiddenField]: 100,
            } as unknown as Parameters<typeof service.executeMarketOrder>[0]),
          (err: unknown) =>
            err instanceof OrderExecutionError &&
            err.code === "CLIENT_PRICE_NOT_ALLOWED"
        );
      }
    });

    it("enforces user existence, user permission, account ownership, and active account status", async () => {
      const { store, service, userId, accountId, instrumentId } =
        createTestHarness();

      // Missing user
      await assert.rejects(
        () =>
          service.executeMarketOrder({
            userId: new Types.ObjectId(),
            practiceAccountId: accountId,
            instrumentId,
            side: "BUY",
            quantity: 1,
            idempotencyKey: "missing-user",
          }),
        (err: unknown) =>
          err instanceof OrderExecutionError && err.code === "USER_NOT_FOUND"
      );

      // Account ownership violation
      const otherUserId = new Types.ObjectId();
      store.seedUser({ _id: otherUserId, status: "ACTIVE" });
      await assert.rejects(
        () =>
          service.executeMarketOrder({
            userId: otherUserId,
            practiceAccountId: accountId,
            instrumentId,
            side: "BUY",
            quantity: 1,
            idempotencyKey: "wrong-owner",
          }),
        (err: unknown) =>
          err instanceof OrderExecutionError &&
          err.code === "ACCOUNT_OWNERSHIP_VIOLATION"
      );

      // Archived account
      const archivedAccountId = new Types.ObjectId();
      store.seedAccount({
        _id: archivedAccountId,
        userId,
        accountNumber: 2,
        status: "ARCHIVED",
        initialBalancePaise: DEFAULT_INITIAL_BALANCE_PAISE,
        cashBalancePaise: 50_000_000,
        archivedAt: new Date("2026-03-31T09:30:00.000Z"),
        version: 2,
        createdAt: new Date("2026-03-31T08:00:00.000Z"),
        updatedAt: new Date("2026-03-31T09:30:00.000Z"),
      });

      await assert.rejects(
        () =>
          service.executeMarketOrder({
            userId,
            practiceAccountId: archivedAccountId,
            instrumentId,
            side: "BUY",
            quantity: 1,
            idempotencyKey: "archived-account-order",
          }),
        (err: unknown) =>
          err instanceof OrderExecutionError && err.code === "ACCOUNT_INACTIVE"
      );
    });

    it("handles non-tradable instruments, stale quotes, missing instruments, and invalid quotes", async () => {
      const { service, userId, accountId, instrumentId, quotes, setQuoteError } =
        createTestHarness();

      // Non-tradable instrument -> persisted REJECTED order (INSTRUMENT_UNAVAILABLE)
      quotes.set(
        instrumentId.toString(),
        buildQuote(instrumentId, { isTradable: false })
      );
      const untradableRes = await service.executeMarketOrder({
        userId,
        practiceAccountId: accountId,
        instrumentId,
        side: "BUY",
        quantity: 1,
        idempotencyKey: "untradable-order",
      });
      assert.equal(untradableRes.status, "REJECTED");
      if (untradableRes.status === "REJECTED") {
        assert.equal(untradableRes.rejectionCode, "INSTRUMENT_UNAVAILABLE");
      }

      // Stale quote -> persisted REJECTED order (STALE_QUOTE)
      quotes.set(
        instrumentId.toString(),
        buildQuote(instrumentId, { isStale: true, quoteAgeMs: 120_000 })
      );
      const staleRes = await service.executeMarketOrder({
        userId,
        practiceAccountId: accountId,
        instrumentId,
        side: "BUY",
        quantity: 1,
        idempotencyKey: "stale-quote-order",
      });
      assert.equal(staleRes.status, "REJECTED");
      if (staleRes.status === "REJECTED") {
        assert.equal(staleRes.rejectionCode, "STALE_QUOTE");
      }

      // Missing instrument -> throws INSTRUMENT_NOT_FOUND
      await assert.rejects(
        () =>
          service.executeMarketOrder({
            userId,
            practiceAccountId: accountId,
            instrumentId: new Types.ObjectId(),
            side: "BUY",
            quantity: 1,
            idempotencyKey: "missing-instrument-order",
          }),
        (err: unknown) =>
          err instanceof OrderExecutionError &&
          err.code === "INSTRUMENT_NOT_FOUND"
      );

      // Invalid quote -> throws INVALID_QUOTE_DATA
      setQuoteError(
        new InstrumentQuoteError(
          "INVALID_QUOTE_DATA",
          "Inverted spread detected on instrument."
        )
      );
      await assert.rejects(
        () =>
          service.executeMarketOrder({
            userId,
            practiceAccountId: accountId,
            instrumentId,
            side: "BUY",
            quantity: 1,
            idempotencyKey: "invalid-quote-order",
          }),
        (err: unknown) =>
          err instanceof OrderExecutionError &&
          err.code === "INVALID_QUOTE_DATA"
      );
    });

    it("returns idempotent replay on duplicate idempotencyKey without double execution and rejects conflicting reuse", async () => {
      const { store, service, userId, accountId, instrumentId } =
        createTestHarness();

      const first = await service.executeMarketOrder({
        userId,
        practiceAccountId: accountId,
        instrumentId,
        side: "BUY",
        quantity: 5,
        idempotencyKey: "idem-buy-5",
      });
      assert.equal(first.status, "EXECUTED");
      assert.equal(first.wasIdempotentReplay, false);

      // Replay with identical intent
      const replay = await service.executeMarketOrder({
        userId,
        practiceAccountId: accountId,
        instrumentId,
        side: "BUY",
        quantity: 5,
        idempotencyKey: "idem-buy-5",
      });
      assert.equal(replay.status, "EXECUTED");
      assert.equal(replay.wasIdempotentReplay, true);
      if (first.status === "EXECUTED" && replay.status === "EXECUTED") {
        assert.equal(replay.order._id.toString(), first.order._id.toString());
        assert.equal(replay.trade._id.toString(), first.trade._id.toString());
        assert.equal(
          replay.ledgerEntry._id.toString(),
          first.ledgerEntry._id.toString()
        );
        assert.equal(
          replay.updatedCashBalancePaise,
          first.updatedCashBalancePaise
        );
      }

      // Only 1 Order, 1 Trade, and 2 LedgerEntries (initial funding + 1 trade) exist
      assert.equal(store.committedState.orders.length, 1);
      assert.equal(store.committedState.trades.length, 1);
      assert.equal(store.committedState.ledgerEntries.length, 2);

      // Reusing same idempotencyKey with different quantity throws IDEMPOTENCY_KEY_CONFLICT
      await assert.rejects(
        () =>
          service.executeMarketOrder({
            userId,
            practiceAccountId: accountId,
            instrumentId,
            side: "BUY",
            quantity: 10,
            idempotencyKey: "idem-buy-5",
          }),
        (err: unknown) =>
          err instanceof OrderExecutionError &&
          err.code === "IDEMPOTENCY_KEY_CONFLICT"
      );
    });

    it("rolls back all writes atomically on mid-transaction failure with zero partial mutations", async () => {
      const { store, service, userId, accountId, instrumentId } =
        createTestHarness();

      // Inject failure at the final step of the transaction (createLedgerEntry)
      store.failOnMethod = "createLedgerEntry";

      await assert.rejects(
        () =>
          service.executeMarketOrder({
            userId,
            practiceAccountId: accountId,
            instrumentId,
            side: "BUY",
            quantity: 10,
            idempotencyKey: "rollback-test-key",
          }),
        (err: unknown) =>
          err instanceof OrderExecutionError && err.code === "EXECUTION_FAILED"
      );

      // Verify complete rollback: no Order, no Trade, no Holding, no extra LedgerEntry, and cashBalancePaise untouched
      assert.equal(store.committedState.orders.length, 0);
      assert.equal(store.committedState.trades.length, 0);
      assert.equal(store.committedState.holdings.size, 0);
      assert.equal(store.committedState.ledgerEntries.length, 1);
      const accountAfterRollback = store.committedState.accounts.get(
        accountId.toString()
      );
      assert.equal(
        accountAfterRollback?.cashBalancePaise,
        DEFAULT_INITIAL_BALANCE_PAISE
      );
      assert.equal(accountAfterRollback?.version, 1);
    });

    it("maintains strict account balance and append-only ledger chain reconciliation across multiple trades", async () => {
      const { store, service, userId, accountId, instrumentId, quotes } =
        createTestHarness();

      // Trade 1: BUY 10 @ 250,050 (-2,500,500)
      await service.executeMarketOrder({
        userId,
        practiceAccountId: accountId,
        instrumentId,
        side: "BUY",
        quantity: 10,
        idempotencyKey: "chain-1",
      });

      // Trade 2: BUY 5 @ 252,000 (-1,260,000)
      quotes.set(
        instrumentId.toString(),
        buildQuote(instrumentId, {
          bidPricePaise: 251_900,
          lastPricePaise: 251_950,
          askPricePaise: 252_000,
        })
      );
      await service.executeMarketOrder({
        userId,
        practiceAccountId: accountId,
        instrumentId,
        side: "BUY",
        quantity: 5,
        idempotencyKey: "chain-2",
      });

      // Trade 3: SELL 6 @ 255,000 (+1,530,000)
      quotes.set(
        instrumentId.toString(),
        buildQuote(instrumentId, {
          bidPricePaise: 255_000,
          lastPricePaise: 255_050,
          askPricePaise: 255_100,
        })
      );
      await service.executeMarketOrder({
        userId,
        practiceAccountId: accountId,
        instrumentId,
        side: "SELL",
        quantity: 6,
        idempotencyKey: "chain-3",
      });

      // Verify ledger chain continuity from 0 -> final account balance
      const entries = store.committedState.ledgerEntries;
      assert.equal(entries.length, 4); // INITIAL_FUNDING + 3 trade entries

      let runningBalance = 0;
      for (const entry of entries) {
        assert.equal(entry.balanceBeforePaise, runningBalance);
        if (entry.direction === "CREDIT") {
          runningBalance += entry.amountPaise;
        } else {
          runningBalance -= entry.amountPaise;
        }
        assert.equal(entry.balanceAfterPaise, runningBalance);
      }

      const finalAccount = store.committedState.accounts.get(
        accountId.toString()
      );
      assert.equal(finalAccount?.cashBalancePaise, runningBalance);
      assert.equal(finalAccount?.cashBalancePaise, 97_769_500);
    });
  });
});
