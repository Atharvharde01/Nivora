import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Types } from "mongoose";
import { FinancialCalculationError } from "../../shared/finance/financial.utils";
import { InstrumentQuoteService } from "../instruments/instrument-quote.service";
import {
  InstrumentQuoteError,
  PersistedInstrumentQuoteRecord,
} from "../instruments/instrument-quote.types";
import { PracticeAccountError } from "../practice-accounts/account.service.types";
import { PortfolioService } from "./portfolio.service";
import {
  PersistedHoldingRecord,
  PortfolioAccountLookupPort,
  PortfolioHoldingsRepositoryPort,
} from "./portfolio.types";

describe("Task 18B — Portfolio Service", () => {
  const userId = new Types.ObjectId("65f000000000000000000010");
  const otherUserId = new Types.ObjectId("65f000000000000000000020");
  const accountId = new Types.ObjectId("65f000000000000000000011");
  const instReliance = new Types.ObjectId("65f000000000000000000101");
  const instTcs = new Types.ObjectId("65f000000000000000000102");
  const instInfyExited = new Types.ObjectId("65f000000000000000000103");

  const evalNow = new Date("2026-11-10T10:10:00.000Z");
  const freshTime = new Date("2026-11-10T10:08:00.000Z"); // 2 mins old

  function makeAccountPort(
    cashBalancePaise = 85_000_000
  ): PortfolioAccountLookupPort {
    const summary = {
      accountId,
      userId,
      accountNumber: 1,
      status: "ACTIVE" as const,
      initialBalancePaise: 100_000_000,
      cashBalancePaise,
      version: 2,
      createdAt: freshTime,
      updatedAt: freshTime,
    };
    return {
      async getActiveAccountForUser(requestedUserId) {
        if (requestedUserId.toString() !== userId.toString()) {
          throw new PracticeAccountError(
            "ACCOUNT_OWNERSHIP_VIOLATION",
            "Unauthorized"
          );
        }
        return summary;
      },
      async getAccountByIdForUser(requestedAccountId, requestedUserId) {
        if (requestedUserId.toString() !== userId.toString()) {
          throw new PracticeAccountError(
            "ACCOUNT_OWNERSHIP_VIOLATION",
            "Unauthorized"
          );
        }
        if (requestedAccountId.toString() !== accountId.toString()) {
          throw new PracticeAccountError("ACCOUNT_NOT_FOUND", "Not found");
        }
        return summary;
      },
    };
  }

  function makeHoldingsRepo(
    holdings: PersistedHoldingRecord[]
  ): PortfolioHoldingsRepositoryPort {
    return {
      async findByPracticeAccount() {
        return holdings;
      },
    };
  }

  function makeQuoteService(
    quotesMap: Map<string, PersistedInstrumentQuoteRecord>
  ): InstrumentQuoteService {
    return new InstrumentQuoteService({
      nowProvider: () => evalNow,
      defaultMaxQuoteAgeMs: 15 * 60 * 1_000, // 15 minutes
      repository: {
        async findById(id: Types.ObjectId) {
          return quotesMap.get(id.toString()) ?? null;
        },
      },
    });
  }

  it("calculates portfolio summary and position valuations across profitable, loss-making, and zero-quantity holdings", async () => {
    // 1. RELIANCE: 10 shares, totalInvested = 2,400,000 paise, lastPrice = 250,000 paise
    //    -> marketValue = 2,500,000 (+100,000 unrealized P&L), realizedPnl = +20,000
    // 2. TCS: 3 shares, totalInvested = 1,000,000 paise (averageBuyPrice = 333,333),
    //    lastPrice = 320,000 paise -> marketValue = 960,000 (-40,000 unrealized P&L using authoritative totalInvestedPaise!), realizedPnl = -5,000
    // 3. INFY (exited zero-quantity holding): 0 shares, totalInvested = 0, averageBuyPrice = 0,
    //    realizedPnl = +35,000 (must NOT appear in active positions, but MUST contribute to portfolio realizedPnlPaise!)
    const holdings: PersistedHoldingRecord[] = [
      {
        _id: new Types.ObjectId(),
        userId,
        practiceAccountId: accountId,
        instrumentId: instInfyExited,
        symbol: "INFY",
        exchange: "NSE",
        quantity: 0,
        averageBuyPricePaise: 0,
        totalInvestedPaise: 0,
        realizedPnlPaise: 35_000,
        version: 4,
        createdAt: freshTime,
        updatedAt: freshTime,
      },
      {
        _id: new Types.ObjectId(),
        userId,
        practiceAccountId: accountId,
        instrumentId: instReliance,
        symbol: "RELIANCE",
        exchange: "NSE",
        quantity: 10,
        averageBuyPricePaise: 240_000,
        totalInvestedPaise: 2_400_000,
        realizedPnlPaise: 20_000,
        version: 2,
        createdAt: freshTime,
        updatedAt: freshTime,
      },
      {
        _id: new Types.ObjectId(),
        userId,
        practiceAccountId: accountId,
        instrumentId: instTcs,
        symbol: "TCS",
        exchange: "NSE",
        quantity: 3,
        averageBuyPricePaise: 333_333, // 3 * 333,333 = 999,999 !== 1,000,000
        totalInvestedPaise: 1_000_000,
        realizedPnlPaise: -5_000,
        version: 1,
        createdAt: freshTime,
        updatedAt: freshTime,
      },
    ];

    const quotes = new Map<string, PersistedInstrumentQuoteRecord>([
      [
        instReliance.toString(),
        {
          _id: instReliance,
          symbol: "RELIANCE",
          exchange: "NSE",
          isTradable: true,
          lastPricePaise: 250_000,
          bidPricePaise: 249_900,
          askPricePaise: 250_100,
          previousClosePaise: 245_000,
          priceUpdatedAt: freshTime,
        },
      ],
      [
        instTcs.toString(),
        {
          _id: instTcs,
          symbol: "TCS",
          exchange: "NSE",
          isTradable: true,
          lastPricePaise: 320_000,
          bidPricePaise: 319_800,
          askPricePaise: 320_200,
          previousClosePaise: 325_000,
          priceUpdatedAt: freshTime,
        },
      ],
    ]);

    const service = new PortfolioService({
      accountService: makeAccountPort(85_000_000),
      holdingsRepository: makeHoldingsRepo(holdings),
      quoteService: makeQuoteService(quotes),
    });

    const portfolio = await service.getPortfolioForUser(userId);

    // Zero-quantity holding (INFY) excluded from active positions
    assert.equal(portfolio.positions.length, 2);
    assert.equal(portfolio.summary.activePositionsCount, 2);

    const reliancePos = portfolio.positions[0];
    assert.equal(reliancePos.symbol, "RELIANCE");
    assert.equal(reliancePos.quantity, 10);
    assert.equal(reliancePos.totalInvestedPaise, 2_400_000);
    assert.equal(reliancePos.currentMarketValuePaise, 2_500_000);
    assert.equal(reliancePos.unrealizedPnlPaise, 100_000);
    assert.equal(reliancePos.quoteSource, "SIMULATED");
    assert.equal(reliancePos.isQuoteStale, false);

    const tcsPos = portfolio.positions[1];
    assert.equal(tcsPos.symbol, "TCS");
    assert.equal(tcsPos.quantity, 3);
    assert.equal(tcsPos.totalInvestedPaise, 1_000_000);
    assert.equal(tcsPos.currentMarketValuePaise, 960_000);
    // Uses authoritative totalInvestedPaise (1,000,000), NOT 3 * 333,333 (999,999):
    assert.equal(tcsPos.unrealizedPnlPaise, -40_000);

    // Portfolio summary checks
    assert.equal(portfolio.summary.cashBalancePaise, 85_000_000);
    assert.equal(portfolio.summary.totalInvestedPaise, 3_400_000);
    assert.equal(portfolio.summary.currentMarketValuePaise, 3_460_000);
    assert.equal(portfolio.summary.unrealizedPnlPaise, 60_000);
    // Realized P&L includes INFY (+35,000) + RELIANCE (+20,000) + TCS (-5,000) = +50,000
    assert.equal(portfolio.summary.realizedPnlPaise, 50_000);
    // Total P&L = 50,000 + 60,000 = 110,000
    assert.equal(portfolio.summary.totalPnlPaise, 110_000);
    assert.equal(portfolio.summary.hasStaleQuotes, false);
  });

  it("surfaces stale quotes transparently on positions and summary without failing portfolio retrieval", async () => {
    const staleTime = new Date("2026-11-10T09:00:00.000Z"); // 70 minutes old (> 15 min max age)
    const holdings: PersistedHoldingRecord[] = [
      {
        _id: new Types.ObjectId(),
        userId,
        practiceAccountId: accountId,
        instrumentId: instReliance,
        symbol: "RELIANCE",
        exchange: "NSE",
        quantity: 5,
        averageBuyPricePaise: 200_000,
        totalInvestedPaise: 1_000_000,
        realizedPnlPaise: 0,
        version: 1,
        createdAt: staleTime,
        updatedAt: staleTime,
      },
    ];

    const quotes = new Map<string, PersistedInstrumentQuoteRecord>([
      [
        instReliance.toString(),
        {
          _id: instReliance,
          symbol: "RELIANCE",
          exchange: "NSE",
          isTradable: true,
          lastPricePaise: 210_000,
          bidPricePaise: 209_900,
          askPricePaise: 210_100,
          previousClosePaise: 205_000,
          priceUpdatedAt: staleTime,
        },
      ],
    ]);

    const service = new PortfolioService({
      accountService: makeAccountPort(),
      holdingsRepository: makeHoldingsRepo(holdings),
      quoteService: makeQuoteService(quotes),
    });

    const portfolio = await service.getPortfolioForUser(userId);
    assert.equal(portfolio.positions[0].isQuoteStale, true);
    assert.equal(portfolio.positions[0].quoteAgeMs, 70 * 60 * 1_000);
    assert.equal(portfolio.summary.hasStaleQuotes, true);
  });

  it("propagates missing instrument quotes and ownership errors without fabricating zero prices", async () => {
    const holdings: PersistedHoldingRecord[] = [
      {
        _id: new Types.ObjectId(),
        userId,
        practiceAccountId: accountId,
        instrumentId: instReliance,
        symbol: "RELIANCE",
        exchange: "NSE",
        quantity: 5,
        averageBuyPricePaise: 200_000,
        totalInvestedPaise: 1_000_000,
        realizedPnlPaise: 0,
        version: 1,
        createdAt: freshTime,
        updatedAt: freshTime,
      },
    ];

    const emptyQuotes = new Map<string, PersistedInstrumentQuoteRecord>();
    const service = new PortfolioService({
      accountService: makeAccountPort(),
      holdingsRepository: makeHoldingsRepo(holdings),
      quoteService: makeQuoteService(emptyQuotes),
    });

    await assert.rejects(
      () => service.getPortfolioForUser(userId),
      (err: unknown) =>
        err instanceof InstrumentQuoteError &&
        err.code === "INSTRUMENT_NOT_FOUND"
    );

    await assert.rejects(
      () =>
        service.getPortfolioForUser(otherUserId, {
          practiceAccountId: accountId,
        }),
      (err: unknown) =>
        err instanceof PracticeAccountError &&
        err.code === "ACCOUNT_OWNERSHIP_VIOLATION"
    );
  });

  it("detects and rejects monetary overflow during portfolio market-value calculation", async () => {
    const holdings: PersistedHoldingRecord[] = [
      {
        _id: new Types.ObjectId(),
        userId,
        practiceAccountId: accountId,
        instrumentId: instReliance,
        symbol: "RELIANCE",
        exchange: "NSE",
        quantity: 10_000_000,
        averageBuyPricePaise: 100,
        totalInvestedPaise: 1_000_000_000,
        realizedPnlPaise: 0,
        version: 1,
        createdAt: freshTime,
        updatedAt: freshTime,
      },
    ];

    const quotes = new Map<string, PersistedInstrumentQuoteRecord>([
      [
        instReliance.toString(),
        {
          _id: instReliance,
          symbol: "RELIANCE",
          exchange: "NSE",
          isTradable: true,
          lastPricePaise: 1_000_000_000, // 10^7 * 10^9 = 10^16 > MAX_SAFE_INTEGER
          bidPricePaise: 1_000_000_000,
          askPricePaise: 1_000_000_000,
          previousClosePaise: 1_000_000_000,
          priceUpdatedAt: freshTime,
        },
      ],
    ]);

    const service = new PortfolioService({
      accountService: makeAccountPort(),
      holdingsRepository: makeHoldingsRepo(holdings),
      quoteService: makeQuoteService(quotes),
    });

    await assert.rejects(
      () => service.getPortfolioForUser(userId),
      (err: unknown) =>
        err instanceof FinancialCalculationError &&
        err.code === "ARITHMETIC_OVERFLOW"
    );
  });
});
