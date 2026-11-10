import { ClientSession, Types } from "mongoose";
import { InstrumentQuoteSnapshot } from "../instruments/instrument-quote.types";
import { InstrumentExchange } from "../instruments/instrument.types";
import { PersistedLedgerEntryRecord } from "../practice-accounts/account.service.types";
import {
  PersistedPracticeAccountRecord,
  TransactionRunner,
} from "../practice-accounts/account.service.types";
import { PersistedHoldingRecord } from "../portfolio/portfolio.types";
import { ITrade, ITradeQuoteSnapshot } from "../trades/trade.types";
import { UserStatus } from "../users/user.types";
import {
  IOrder,
  OrderRejectionCode,
  OrderSide,
  OrderStatus,
  OrderType,
} from "./order.types";

export const ORDER_EXECUTION_ERROR_CODES = [
  "VALIDATION_ERROR",
  "CLIENT_PRICE_NOT_ALLOWED",
  "USER_NOT_FOUND",
  "USER_NOT_PERMITTED",
  "ACCOUNT_NOT_FOUND",
  "ACCOUNT_OWNERSHIP_VIOLATION",
  "ACCOUNT_INACTIVE",
  "INSTRUMENT_NOT_FOUND",
  "INVALID_QUOTE_DATA",
  "IDEMPOTENCY_KEY_CONFLICT",
  "CONCURRENCY_CONFLICT",
  "TRANSACTION_UNAVAILABLE",
  "EXECUTION_FAILED",
] as const;

export type OrderExecutionErrorCode =
  (typeof ORDER_EXECUTION_ERROR_CODES)[number];

export class OrderExecutionError extends Error {
  public readonly code: OrderExecutionErrorCode;

  constructor(code: OrderExecutionErrorCode, message: string) {
    super(message);
    this.name = "OrderExecutionError";
    this.code = code;
    Object.setPrototypeOf(this, OrderExecutionError.prototype);
  }
}

export interface ExecuteMarketOrderInput {
  readonly userId: Types.ObjectId | string;
  readonly practiceAccountId: Types.ObjectId | string;
  readonly instrumentId: Types.ObjectId | string;
  readonly side: OrderSide;
  readonly quantity: number;
  readonly idempotencyKey: string;
}

export interface ExecuteMarketOrderOptions {
  readonly now?: Date;
  readonly maxQuoteAgeMs?: number;
}

export interface PersistedUserExecutionRecord {
  readonly _id: Types.ObjectId;
  readonly status: UserStatus;
}

export interface PersistedOrderRecord extends IOrder {
  readonly _id: Types.ObjectId;
}

export interface PersistedTradeRecord extends ITrade {
  readonly _id: Types.ObjectId;
}

export interface ExecutedOrderExecutionResult {
  readonly status: "EXECUTED";
  readonly wasIdempotentReplay: boolean;
  readonly order: PersistedOrderRecord;
  readonly trade: PersistedTradeRecord;
  readonly ledgerEntry: PersistedLedgerEntryRecord;
  readonly side: OrderSide;
  readonly quantity: number;
  readonly executionPricePaise: number;
  readonly totalValuePaise: number;
  readonly costBasisSoldPaise: number;
  readonly realizedPnlPaise: number;
  readonly cashBalanceBeforePaise: number;
  readonly updatedCashBalancePaise: number;
  readonly updatedHolding: PersistedHoldingRecord;
  readonly quoteSnapshot: InstrumentQuoteSnapshot;
}

export interface RejectedOrderExecutionResult {
  readonly status: "REJECTED";
  readonly wasIdempotentReplay: boolean;
  readonly order: PersistedOrderRecord;
  readonly rejectionCode: OrderRejectionCode;
  readonly rejectionReason: string;
  readonly trade: null;
  readonly ledgerEntry: null;
  readonly side: OrderSide;
  readonly quantity: number;
  readonly executionPricePaise: null;
  readonly totalValuePaise: null;
  readonly costBasisSoldPaise: null;
  readonly realizedPnlPaise: null;
  readonly cashBalanceBeforePaise: number;
  readonly updatedCashBalancePaise: number;
  readonly updatedHolding: PersistedHoldingRecord | null;
  readonly quoteSnapshot: InstrumentQuoteSnapshot;
}

export type OrderExecutionResult =
  | ExecutedOrderExecutionResult
  | RejectedOrderExecutionResult;

export interface CreateOrderPersistenceInput {
  readonly userId: Types.ObjectId;
  readonly practiceAccountId: Types.ObjectId;
  readonly instrumentId: Types.ObjectId;
  readonly symbol: string;
  readonly exchange: InstrumentExchange;
  readonly side: OrderSide;
  readonly orderType: OrderType;
  readonly quantity: number;
  readonly status: OrderStatus;
  readonly idempotencyKey: string;
  readonly executedQuantity: number;
  readonly executionPricePaise?: number;
  readonly totalValuePaise?: number;
  readonly rejectionCode?: OrderRejectionCode;
  readonly rejectionReason?: string;
  readonly executedAt?: Date;
  readonly rejectedAt?: Date;
}

export interface CreateTradePersistenceInput {
  readonly orderId: Types.ObjectId;
  readonly userId: Types.ObjectId;
  readonly practiceAccountId: Types.ObjectId;
  readonly instrumentId: Types.ObjectId;
  readonly symbol: string;
  readonly exchange: InstrumentExchange;
  readonly side: OrderSide;
  readonly quantity: number;
  readonly executionPricePaise: number;
  readonly totalValuePaise: number;
  readonly costBasisSoldPaise: number;
  readonly realizedPnlPaise: number;
  readonly quoteSnapshot: ITradeQuoteSnapshot;
  readonly idempotencyKey: string;
  readonly executedAt: Date;
}

export interface CreateExecutionLedgerPersistenceInput {
  readonly userId: Types.ObjectId;
  readonly practiceAccountId: Types.ObjectId;
  readonly entryType: "BUY_EXECUTION" | "SELL_EXECUTION";
  readonly direction: "DEBIT" | "CREDIT";
  readonly amountPaise: number;
  readonly balanceBeforePaise: number;
  readonly balanceAfterPaise: number;
  readonly referenceType: "TRADE";
  readonly referenceId: Types.ObjectId;
  readonly idempotencyKey: string;
  readonly description: string;
}

export interface UpsertHoldingOnBuyInput {
  readonly existingHoldingId?: Types.ObjectId;
  readonly expectedVersion?: number;
  readonly userId: Types.ObjectId;
  readonly practiceAccountId: Types.ObjectId;
  readonly instrumentId: Types.ObjectId;
  readonly symbol: string;
  readonly exchange: InstrumentExchange;
  readonly newQuantity: number;
  readonly newAverageBuyPricePaise: number;
  readonly newTotalInvestedPaise: number;
  readonly newRealizedPnlPaise: number;
  readonly newVersion: number;
}

export interface UpdateHoldingOnSellInput {
  readonly holdingId: Types.ObjectId;
  readonly expectedVersion: number;
  readonly userId: Types.ObjectId;
  readonly practiceAccountId: Types.ObjectId;
  readonly instrumentId: Types.ObjectId;
  readonly symbol: string;
  readonly sellQuantity: number;
  readonly newQuantity: number;
  readonly newAverageBuyPricePaise: number;
  readonly newTotalInvestedPaise: number;
  readonly newRealizedPnlPaise: number;
  readonly newVersion: number;
}

export interface OrderExecutionRepositoryPort {
  findUserById(
    userId: Types.ObjectId,
    options?: { session?: ClientSession }
  ): Promise<PersistedUserExecutionRecord | null>;

  findPracticeAccountById(
    accountId: Types.ObjectId,
    options?: { session?: ClientSession }
  ): Promise<PersistedPracticeAccountRecord | null>;

  findOrderByAccountAndIdempotencyKey(
    practiceAccountId: Types.ObjectId,
    idempotencyKey: string,
    options?: { session?: ClientSession }
  ): Promise<PersistedOrderRecord | null>;

  findTradeByOrderId(
    orderId: Types.ObjectId,
    options?: { session?: ClientSession }
  ): Promise<PersistedTradeRecord | null>;

  findLedgerEntryByTradeId(
    tradeId: Types.ObjectId,
    options?: { session?: ClientSession }
  ): Promise<PersistedLedgerEntryRecord | null>;

  findHoldingByAccountAndInstrument(
    practiceAccountId: Types.ObjectId,
    userId: Types.ObjectId,
    instrumentId: Types.ObjectId,
    options?: { session?: ClientSession }
  ): Promise<PersistedHoldingRecord | null>;

  debitPracticeAccountBalance(
    params: {
      accountId: Types.ObjectId;
      userId: Types.ObjectId;
      expectedVersion: number;
      debitAmountPaise: number;
    },
    options?: { session?: ClientSession }
  ): Promise<PersistedPracticeAccountRecord | null>;

  creditPracticeAccountBalance(
    params: {
      accountId: Types.ObjectId;
      userId: Types.ObjectId;
      expectedVersion: number;
      creditAmountPaise: number;
    },
    options?: { session?: ClientSession }
  ): Promise<PersistedPracticeAccountRecord | null>;

  createOrder(
    input: CreateOrderPersistenceInput,
    options?: { session?: ClientSession }
  ): Promise<PersistedOrderRecord>;

  createTrade(
    input: CreateTradePersistenceInput,
    options?: { session?: ClientSession }
  ): Promise<PersistedTradeRecord>;

  createLedgerEntry(
    input: CreateExecutionLedgerPersistenceInput,
    options?: { session?: ClientSession }
  ): Promise<PersistedLedgerEntryRecord>;

  saveHoldingAfterBuy(
    input: UpsertHoldingOnBuyInput,
    options?: { session?: ClientSession }
  ): Promise<PersistedHoldingRecord | null>;

  updateHoldingAfterSell(
    input: UpdateHoldingOnSellInput,
    options?: { session?: ClientSession }
  ): Promise<PersistedHoldingRecord | null>;
}

export interface OrderExecutionServiceOptions {
  readonly repository?: OrderExecutionRepositoryPort;
  readonly quoteService?: {
    getQuoteByInstrumentId(
      instrumentId: Types.ObjectId | string,
      options?: {
        session?: ClientSession;
        now?: Date;
        maxQuoteAgeMs?: number;
        requireTradable?: boolean;
        requireFresh?: boolean;
      }
    ): Promise<InstrumentQuoteSnapshot>;
  };
  readonly runInTransaction?: TransactionRunner;
  readonly nowProvider?: () => Date;
}
