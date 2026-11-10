import { ClientSession, Types } from "mongoose";
import {
  assertNonNegativeSafeIntegerPaise,
  assertPositiveWholeShareQuantity,
  assertSignedSafeIntegerPaise,
  calculateAverageBuyPricePaise,
  safeAddPaise,
  safeAddSignedPaise,
  safeMultiplyQuantityAndPricePaise,
  safeSignedSubtractPaise,
} from "../../shared/finance/financial.utils";
import { HoldingModel } from "../holdings/holding.model";
import { InstrumentQuoteService } from "../instruments/instrument-quote.service";
import { PracticeAccountService } from "../practice-accounts/account.service";
import {
  GetPortfolioOptions,
  PersistedHoldingRecord,
  PortfolioAccountLookupPort,
  PortfolioHoldingsRepositoryPort,
  PortfolioPositionView,
  PortfolioSummaryView,
  PortfolioView,
} from "./portfolio.types";

/**
 * Default Mongoose-backed holdings repository for portfolio retrieval.
 * Uses a single sorted query per practice account so active positions (`quantity > 0`)
 * and zero-quantity realized-P&L records (`quantity === 0`) are retrieved without
 * redundant database round-trips.
 */
export class MongoosePortfolioHoldingsRepository
  implements PortfolioHoldingsRepositoryPort
{
  public async findByPracticeAccount(
    practiceAccountId: Types.ObjectId,
    userId: Types.ObjectId,
    options?: { session?: ClientSession }
  ): Promise<readonly PersistedHoldingRecord[]> {
    const query = HoldingModel.find({
      practiceAccountId,
      userId,
    })
      .sort({ symbol: 1 })
      .select(
        "_id userId practiceAccountId instrumentId symbol exchange quantity averageBuyPricePaise totalInvestedPaise realizedPnlPaise version createdAt updatedAt"
      );

    if (options?.session) {
      query.session(options.session);
    }

    const docs = await query.lean<PersistedHoldingRecord[]>().exec();
    return docs;
  }
}

export interface PortfolioServiceOptions {
  readonly accountService?: PortfolioAccountLookupPort;
  readonly holdingsRepository?: PortfolioHoldingsRepositoryPort;
  readonly quoteService?: InstrumentQuoteService;
}

/**
 * Portfolio Business Service.
 *
 * Responsibilities:
 * - Resolves and verifies ownership of the user's ACTIVE practice account.
 * - Retrieves all holdings for the practice account in one query.
 * - Excludes zero-quantity (`quantity === 0`) holdings from active `positions`,
 *   while including their `realizedPnlPaise` in portfolio-level `realizedPnlPaise`.
 * - Resolves simulated quotes via `InstrumentQuoteService` (`requireFresh: false`,
 *   `requireTradable: false`) so stale quotes are surfaced transparently with
 *   `isQuoteStale: true` without fabricating prices or mutating persisted instruments.
 * - Computes position and summary valuations using Task 16 integer-paise utilities
 *   with `totalInvestedPaise` as the authoritative remaining cost basis.
 */
export class PortfolioService {
  private readonly accountService: PortfolioAccountLookupPort;
  private readonly holdingsRepository: PortfolioHoldingsRepositoryPort;
  private readonly quoteService: InstrumentQuoteService;

  constructor(options: PortfolioServiceOptions = {}) {
    this.accountService =
      options.accountService ?? new PracticeAccountService();
    this.holdingsRepository =
      options.holdingsRepository ?? new MongoosePortfolioHoldingsRepository();
    this.quoteService = options.quoteService ?? new InstrumentQuoteService();
  }

  public async getPortfolioForUser(
    userId: Types.ObjectId | string,
    options: GetPortfolioOptions = {}
  ): Promise<PortfolioView> {
    const activeAccount = options.practiceAccountId
      ? await this.accountService.getAccountByIdForUser(
          options.practiceAccountId,
          userId,
          {
            session: options.session,
            requireActive: true,
          }
        )
      : await this.accountService.getActiveAccountForUser(userId, {
          session: options.session,
        });

    const holdings = await this.holdingsRepository.findByPracticeAccount(
      activeAccount.accountId,
      activeAccount.userId,
      { session: options.session }
    );

    let totalInvestedPaise = 0;
    let currentMarketValuePaise = 0;
    let unrealizedPnlPaise = 0;
    let realizedPnlPaise = 0;
    let hasStaleQuotes = false;

    const activeHoldings: PersistedHoldingRecord[] = [];

    for (const holding of holdings) {
      assertSignedSafeIntegerPaise(
        holding.realizedPnlPaise,
        "holding.realizedPnlPaise"
      );
      realizedPnlPaise = safeAddSignedPaise(
        realizedPnlPaise,
        holding.realizedPnlPaise,
        "portfolio.realizedPnlPaise"
      );

      // Validate holding state consistency (both zero-quantity and positive-quantity)
      calculateAverageBuyPricePaise(
        holding.totalInvestedPaise,
        holding.quantity
      );

      if (holding.quantity > 0) {
        activeHoldings.push(holding);
      }
    }

    // Retrieve quotes for all active holdings concurrently
    const quoteSnapshots = await Promise.all(
      activeHoldings.map((holding) =>
        this.quoteService.getQuoteByInstrumentId(holding.instrumentId, {
          now: options.now,
          maxQuoteAgeMs: options.maxQuoteAgeMs,
          requireFresh: false,
          requireTradable: false,
          session: options.session,
        })
      )
    );

    const positions: PortfolioPositionView[] = [];

    for (let i = 0; i < activeHoldings.length; i++) {
      const holding = activeHoldings[i];
      const quote = quoteSnapshots[i];

      assertPositiveWholeShareQuantity(holding.quantity, "holding.quantity");
      assertNonNegativeSafeIntegerPaise(
        holding.totalInvestedPaise,
        "holding.totalInvestedPaise"
      );
      assertNonNegativeSafeIntegerPaise(
        holding.averageBuyPricePaise,
        "holding.averageBuyPricePaise"
      );

      // Market Value = Quantity * Last Price
      const positionMarketValuePaise = safeMultiplyQuantityAndPricePaise(
        holding.quantity,
        quote.lastPricePaise,
        "quote.lastPricePaise"
      );

      // Unrealized P&L = Market Value - Authoritative Remaining Cost Basis (totalInvestedPaise)
      const positionUnrealizedPnlPaise = safeSignedSubtractPaise(
        positionMarketValuePaise,
        holding.totalInvestedPaise,
        "position.unrealizedPnlPaise"
      );

      totalInvestedPaise = safeAddPaise(
        totalInvestedPaise,
        holding.totalInvestedPaise,
        "portfolio.totalInvestedPaise"
      );

      currentMarketValuePaise = safeAddPaise(
        currentMarketValuePaise,
        positionMarketValuePaise,
        "portfolio.currentMarketValuePaise"
      );

      unrealizedPnlPaise = safeAddSignedPaise(
        unrealizedPnlPaise,
        positionUnrealizedPnlPaise,
        "portfolio.unrealizedPnlPaise"
      );

      if (quote.isStale) {
        hasStaleQuotes = true;
      }

      positions.push(
        Object.freeze({
          instrumentId: new Types.ObjectId(holding.instrumentId.toString()),
          symbol: quote.symbol,
          exchange: quote.exchange,
          quantity: holding.quantity,
          averageBuyPricePaise: holding.averageBuyPricePaise,
          totalInvestedPaise: holding.totalInvestedPaise,
          realizedPnlPaise: holding.realizedPnlPaise,
          lastPricePaise: quote.lastPricePaise,
          bidPricePaise: quote.bidPricePaise,
          askPricePaise: quote.askPricePaise,
          currentMarketValuePaise: positionMarketValuePaise,
          unrealizedPnlPaise: positionUnrealizedPnlPaise,
          quoteTimestamp: new Date(quote.priceUpdatedAt.getTime()),
          quoteAgeMs: quote.quoteAgeMs,
          isQuoteStale: quote.isStale,
          quoteSource: quote.quoteSource,
          isTradable: quote.isTradable,
        })
      );
    }

    const totalPnlPaise = safeAddSignedPaise(
      realizedPnlPaise,
      unrealizedPnlPaise,
      "portfolio.totalPnlPaise"
    );

    const summary: PortfolioSummaryView = Object.freeze({
      practiceAccountId: activeAccount.accountId,
      accountNumber: activeAccount.accountNumber,
      cashBalancePaise: activeAccount.cashBalancePaise,
      totalInvestedPaise,
      currentMarketValuePaise,
      unrealizedPnlPaise,
      realizedPnlPaise,
      totalPnlPaise,
      activePositionsCount: positions.length,
      hasStaleQuotes,
    });

    return Object.freeze({
      summary,
      positions: Object.freeze(positions),
    });
  }
}
