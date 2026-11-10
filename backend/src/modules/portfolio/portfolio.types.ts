import { ClientSession, Types } from "mongoose";
import { QuoteSource } from "../instruments/instrument-quote.types";
import { InstrumentExchange } from "../instruments/instrument.types";
import { PracticeAccountSummary } from "../practice-accounts/account.service.types";

export interface PersistedHoldingRecord {
  readonly _id: Types.ObjectId;
  readonly userId: Types.ObjectId;
  readonly practiceAccountId: Types.ObjectId;
  readonly instrumentId: Types.ObjectId;
  readonly symbol: string;
  readonly exchange: InstrumentExchange;
  readonly quantity: number;
  readonly averageBuyPricePaise: number;
  readonly totalInvestedPaise: number;
  readonly realizedPnlPaise: number;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface PortfolioPositionView {
  readonly instrumentId: Types.ObjectId;
  readonly symbol: string;
  readonly exchange: InstrumentExchange;
  readonly quantity: number;
  readonly averageBuyPricePaise: number;
  readonly totalInvestedPaise: number;
  readonly realizedPnlPaise: number;
  readonly lastPricePaise: number;
  readonly bidPricePaise: number;
  readonly askPricePaise: number;
  readonly currentMarketValuePaise: number;
  readonly unrealizedPnlPaise: number;
  readonly quoteTimestamp: Date;
  readonly quoteAgeMs: number;
  readonly isQuoteStale: boolean;
  readonly quoteSource: QuoteSource;
  readonly isTradable: boolean;
}

export interface PortfolioSummaryView {
  readonly practiceAccountId: Types.ObjectId;
  readonly accountNumber: number;
  readonly cashBalancePaise: number;
  readonly totalInvestedPaise: number;
  readonly currentMarketValuePaise: number;
  readonly unrealizedPnlPaise: number;
  readonly realizedPnlPaise: number;
  readonly totalPnlPaise: number;
  readonly activePositionsCount: number;
  readonly hasStaleQuotes: boolean;
}

export interface PortfolioView {
  readonly summary: PortfolioSummaryView;
  readonly positions: readonly PortfolioPositionView[];
}

export interface PortfolioHoldingsRepositoryPort {
  findByPracticeAccount(
    practiceAccountId: Types.ObjectId,
    userId: Types.ObjectId,
    options?: { session?: ClientSession }
  ): Promise<readonly PersistedHoldingRecord[]>;
}

export interface PortfolioAccountLookupPort {
  getActiveAccountForUser(
    userId: Types.ObjectId | string,
    options?: { session?: ClientSession }
  ): Promise<PracticeAccountSummary>;

  getAccountByIdForUser(
    accountId: Types.ObjectId | string,
    userId: Types.ObjectId | string,
    options?: { session?: ClientSession; requireActive?: boolean }
  ): Promise<PracticeAccountSummary>;
}

export interface GetPortfolioOptions {
  readonly practiceAccountId?: Types.ObjectId | string;
  readonly now?: Date;
  readonly maxQuoteAgeMs?: number;
  readonly session?: ClientSession;
}
