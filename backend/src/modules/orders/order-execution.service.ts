import { ClientSession, Types } from "mongoose";
import {
  calculateHoldingAfterBuy,
  calculateHoldingAfterSell,
  FinancialCalculationError,
  isPositiveWholeShareQuantity,
  safeAddPaise,
  safeDebitBalancePaise,
  willMultiplyOverflow,
} from "../../shared/finance/financial.utils";
import { HoldingModel } from "../holdings/holding.model";
import { InstrumentQuoteService } from "../instruments/instrument-quote.service";
import {
  InstrumentQuoteError,
  InstrumentQuoteSnapshot,
} from "../instruments/instrument-quote.types";
import { LedgerEntryModel } from "../ledger/ledger.model";
import { PersistedHoldingRecord } from "../portfolio/portfolio.types";
import { PracticeAccountModel } from "../practice-accounts/account.model";
import { executeMongoTransaction } from "../practice-accounts/account.service";
import {
  PersistedLedgerEntryRecord,
  PersistedPracticeAccountRecord,
  PracticeAccountError,
  TransactionRunner,
} from "../practice-accounts/account.service.types";
import { TradeModel } from "../trades/trade.model";
import { UserModel } from "../users/user.model";
import { OrderModel } from "./order.model";
import { ORDER_IDEMPOTENCY_KEY_MAX_LENGTH } from "./order.schema";
import { OrderRejectionCode, OrderSide } from "./order.types";
import {
  CreateExecutionLedgerPersistenceInput,
  CreateOrderPersistenceInput,
  CreateTradePersistenceInput,
  ExecuteMarketOrderInput,
  ExecuteMarketOrderOptions,
  OrderExecutionError,
  OrderExecutionRepositoryPort,
  OrderExecutionResult,
  OrderExecutionServiceOptions,
  PersistedOrderRecord,
  PersistedTradeRecord,
  PersistedUserExecutionRecord,
  UpdateHoldingOnSellInput,
  UpsertHoldingOnBuyInput,
} from "./order-execution.types";

const FORBIDDEN_CLIENT_PRICE_FIELDS = [
  "executionPricePaise",
  "pricePaise",
  "price",
  "askPricePaise",
  "bidPricePaise",
  "totalValuePaise",
] as const;

function resolveObjectId(
  rawId: Types.ObjectId | string,
  fieldName: string
): Types.ObjectId {
  if (rawId instanceof Types.ObjectId) {
    return rawId;
  }
  if (
    typeof rawId === "string" &&
    Types.ObjectId.isValid(rawId) &&
    new Types.ObjectId(rawId).toString() === rawId.trim()
  ) {
    return new Types.ObjectId(rawId.trim());
  }
  throw new OrderExecutionError(
    "VALIDATION_ERROR",
    `${fieldName} must be a valid MongoDB ObjectId.`
  );
}

function validateOrderExecutionInput(input: ExecuteMarketOrderInput): {
  userId: Types.ObjectId;
  practiceAccountId: Types.ObjectId;
  instrumentId: Types.ObjectId;
  side: OrderSide;
  quantity: number;
  idempotencyKey: string;
} {
  if (typeof input !== "object" || input === null) {
    throw new OrderExecutionError(
      "VALIDATION_ERROR",
      "Order execution input must be a non-null object."
    );
  }

  const rawRecord = input as unknown as Record<string, unknown>;
  for (const forbiddenField of FORBIDDEN_CLIENT_PRICE_FIELDS) {
    if (rawRecord[forbiddenField] !== undefined) {
      throw new OrderExecutionError(
        "CLIENT_PRICE_NOT_ALLOWED",
        `Client-supplied field '${forbiddenField}' is not permitted; execution prices are server-authoritative.`
      );
    }
  }

  const userId = resolveObjectId(input.userId, "userId");
  const practiceAccountId = resolveObjectId(
    input.practiceAccountId,
    "practiceAccountId"
  );
  const instrumentId = resolveObjectId(input.instrumentId, "instrumentId");

  if (input.side !== "BUY" && input.side !== "SELL") {
    throw new OrderExecutionError(
      "VALIDATION_ERROR",
      "Order side must be either 'BUY' or 'SELL'."
    );
  }

  if (!isPositiveWholeShareQuantity(input.quantity)) {
    throw new OrderExecutionError(
      "VALIDATION_ERROR",
      "Order quantity must be a positive whole-number safe integer."
    );
  }

  const idempotencyKey =
    typeof input.idempotencyKey === "string" ? input.idempotencyKey.trim() : "";
  if (
    idempotencyKey.length < 1 ||
    idempotencyKey.length > ORDER_IDEMPOTENCY_KEY_MAX_LENGTH
  ) {
    throw new OrderExecutionError(
      "VALIDATION_ERROR",
      `idempotencyKey must be a non-empty string between 1 and ${ORDER_IDEMPOTENCY_KEY_MAX_LENGTH} characters.`
    );
  }

  return {
    userId,
    practiceAccountId,
    instrumentId,
    side: input.side,
    quantity: input.quantity,
    idempotencyKey,
  };
}

function isDuplicateKeyError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) {
    return false;
  }
  const record = err as Record<string, unknown>;
  return record.code === 11000 || record.codeName === "DuplicateKey";
}

function isWriteConflictError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) {
    return false;
  }
  const record = err as Record<string, unknown>;
  return record.code === 112 || record.codeName === "WriteConflict";
}

/**
 * Default Mongoose-backed repository for transactional order execution.
 */
export class MongooseOrderExecutionRepository
  implements OrderExecutionRepositoryPort
{
  public async findUserById(
    userId: Types.ObjectId,
    options?: { session?: ClientSession }
  ): Promise<PersistedUserExecutionRecord | null> {
    const query = UserModel.findById(userId).select("_id status");
    if (options?.session) {
      query.session(options.session);
    }
    const doc = await query.lean<PersistedUserExecutionRecord>().exec();
    return doc ?? null;
  }

  public async findPracticeAccountById(
    accountId: Types.ObjectId,
    options?: { session?: ClientSession }
  ): Promise<PersistedPracticeAccountRecord | null> {
    const query = PracticeAccountModel.findById(accountId);
    if (options?.session) {
      query.session(options.session);
    }
    const doc = await query.lean<PersistedPracticeAccountRecord>().exec();
    return doc ?? null;
  }

  public async findOrderByAccountAndIdempotencyKey(
    practiceAccountId: Types.ObjectId,
    idempotencyKey: string,
    options?: { session?: ClientSession }
  ): Promise<PersistedOrderRecord | null> {
    const query = OrderModel.findOne({
      practiceAccountId,
      idempotencyKey,
    });
    if (options?.session) {
      query.session(options.session);
    }
    const doc = await query.lean<PersistedOrderRecord>().exec();
    return doc ?? null;
  }

  public async findTradeByOrderId(
    orderId: Types.ObjectId,
    options?: { session?: ClientSession }
  ): Promise<PersistedTradeRecord | null> {
    const query = TradeModel.findOne({ orderId });
    if (options?.session) {
      query.session(options.session);
    }
    const doc = await query.lean<PersistedTradeRecord>().exec();
    return doc ?? null;
  }

  public async findLedgerEntryByTradeId(
    tradeId: Types.ObjectId,
    options?: { session?: ClientSession }
  ): Promise<PersistedLedgerEntryRecord | null> {
    const query = LedgerEntryModel.findOne({
      referenceType: "TRADE",
      referenceId: tradeId,
    });
    if (options?.session) {
      query.session(options.session);
    }
    const doc = await query.lean<PersistedLedgerEntryRecord>().exec();
    return doc ?? null;
  }

  public async findHoldingByAccountAndInstrument(
    practiceAccountId: Types.ObjectId,
    userId: Types.ObjectId,
    instrumentId: Types.ObjectId,
    options?: { session?: ClientSession }
  ): Promise<PersistedHoldingRecord | null> {
    const query = HoldingModel.findOne({
      practiceAccountId,
      userId,
      instrumentId,
    });
    if (options?.session) {
      query.session(options.session);
    }
    const doc = await query.lean<PersistedHoldingRecord>().exec();
    return doc ?? null;
  }

  public async debitPracticeAccountBalance(
    params: {
      accountId: Types.ObjectId;
      userId: Types.ObjectId;
      expectedVersion: number;
      debitAmountPaise: number;
    },
    options?: { session?: ClientSession }
  ): Promise<PersistedPracticeAccountRecord | null> {
    const query = PracticeAccountModel.findOneAndUpdate(
      {
        _id: params.accountId,
        userId: params.userId,
        status: "ACTIVE",
        version: params.expectedVersion,
        cashBalancePaise: { $gte: params.debitAmountPaise },
      },
      {
        $inc: {
          cashBalancePaise: -params.debitAmountPaise,
          version: 1,
        },
      },
      {
        new: true,
        runValidators: true,
        session: options?.session,
      }
    );
    const doc = await query.lean<PersistedPracticeAccountRecord>().exec();
    return doc ?? null;
  }

  public async creditPracticeAccountBalance(
    params: {
      accountId: Types.ObjectId;
      userId: Types.ObjectId;
      expectedVersion: number;
      creditAmountPaise: number;
    },
    options?: { session?: ClientSession }
  ): Promise<PersistedPracticeAccountRecord | null> {
    const query = PracticeAccountModel.findOneAndUpdate(
      {
        _id: params.accountId,
        userId: params.userId,
        status: "ACTIVE",
        version: params.expectedVersion,
        cashBalancePaise: {
          $lte: Number.MAX_SAFE_INTEGER - params.creditAmountPaise,
        },
      },
      {
        $inc: {
          cashBalancePaise: params.creditAmountPaise,
          version: 1,
        },
      },
      {
        new: true,
        runValidators: true,
        session: options?.session,
      }
    );
    const doc = await query.lean<PersistedPracticeAccountRecord>().exec();
    return doc ?? null;
  }

  public async createOrder(
    input: CreateOrderPersistenceInput,
    options?: { session?: ClientSession }
  ): Promise<PersistedOrderRecord> {
    const doc = new OrderModel(input);
    const saved = await doc.save({ session: options?.session });
    return saved.toObject() as unknown as PersistedOrderRecord;
  }

  public async createTrade(
    input: CreateTradePersistenceInput,
    options?: { session?: ClientSession }
  ): Promise<PersistedTradeRecord> {
    const doc = new TradeModel(input);
    const saved = await doc.save({ session: options?.session });
    return saved.toObject() as unknown as PersistedTradeRecord;
  }

  public async createLedgerEntry(
    input: CreateExecutionLedgerPersistenceInput,
    options?: { session?: ClientSession }
  ): Promise<PersistedLedgerEntryRecord> {
    const doc = new LedgerEntryModel(input);
    const saved = await doc.save({ session: options?.session });
    return saved.toObject() as unknown as PersistedLedgerEntryRecord;
  }

  public async saveHoldingAfterBuy(
    input: UpsertHoldingOnBuyInput,
    options?: { session?: ClientSession }
  ): Promise<PersistedHoldingRecord | null> {
    if (!input.existingHoldingId) {
      const doc = new HoldingModel({
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
      });
      const saved = await doc.save({ session: options?.session });
      return saved.toObject() as unknown as PersistedHoldingRecord;
    }

    const query = HoldingModel.findOneAndUpdate(
      {
        _id: input.existingHoldingId,
        userId: input.userId,
        practiceAccountId: input.practiceAccountId,
        instrumentId: input.instrumentId,
        version: input.expectedVersion,
      },
      {
        $set: {
          symbol: input.symbol,
          quantity: input.newQuantity,
          averageBuyPricePaise: input.newAverageBuyPricePaise,
          totalInvestedPaise: input.newTotalInvestedPaise,
          realizedPnlPaise: input.newRealizedPnlPaise,
          version: input.newVersion,
        },
      },
      {
        new: true,
        runValidators: true,
        session: options?.session,
      }
    );
    const doc = await query.lean<PersistedHoldingRecord>().exec();
    return doc ?? null;
  }

  public async updateHoldingAfterSell(
    input: UpdateHoldingOnSellInput,
    options?: { session?: ClientSession }
  ): Promise<PersistedHoldingRecord | null> {
    const query = HoldingModel.findOneAndUpdate(
      {
        _id: input.holdingId,
        userId: input.userId,
        practiceAccountId: input.practiceAccountId,
        instrumentId: input.instrumentId,
        version: input.expectedVersion,
        quantity: { $gte: input.sellQuantity },
      },
      {
        $set: {
          symbol: input.symbol,
          quantity: input.newQuantity,
          averageBuyPricePaise: input.newAverageBuyPricePaise,
          totalInvestedPaise: input.newTotalInvestedPaise,
          realizedPnlPaise: input.newRealizedPnlPaise,
          version: input.newVersion,
        },
      },
      {
        new: true,
        runValidators: true,
        session: options?.session,
      }
    );
    const doc = await query.lean<PersistedHoldingRecord>().exec();
    return doc ?? null;
  }
}

/**
 * Simulated Market-Order Execution Service (`BUY` and `SELL`).
 *
 * Financial, Concurrency & Transaction Guarantees:
 * 1. Atomic Transaction Boundary: All writes belonging to an execution (`Order`,
 *    `PracticeAccount`, `Holding`, `Trade`, and `LedgerEntry`) execute within a single
 *    MongoDB transaction. Standalone MongoDB deployments without transaction support
 *    fail safely with `TRANSACTION_UNAVAILABLE` and never fall back to non-transactional writes.
 * 2. Authoritative Server-Side Pricing & Zero Fees (MVP):
 *    - `BUY` executes at `quote.askPricePaise`; `SELL` executes at `quote.bidPricePaise`.
 *    - No brokerage, taxes, or additional fees are deducted in MVP:
 *      `totalValuePaise === quantity * executionPricePaise`.
 *    - Any client-supplied price field is rejected with `CLIENT_PRICE_NOT_ALLOWED`.
 * 3. Business Rejection Behaviour:
 *    - When User, active PracticeAccount ownership, and Instrument quote integrity are
 *      verified, business-rule rejections (`INSTRUMENT_UNAVAILABLE`, `STALE_QUOTE`,
 *      `OVERFLOW_LIMIT_EXCEEDED`, `INSUFFICIENT_FUNDS`, `INSUFFICIENT_QUANTITY`) persist
 *      a terminal `REJECTED` `Order` record for auditability while performing zero
 *      financial mutations (`Trade`, `LedgerEntry`, `PracticeAccount`, and `Holding`
 *      remain untouched).
 *    - Input validation errors, ownership violations, archived accounts, missing
 *      entities, and database/transaction failures throw `OrderExecutionError` and roll
 *      back without persisting a misleading business rejection.
 */
export class OrderExecutionService {
  private readonly repository: OrderExecutionRepositoryPort;
  private readonly quoteService: NonNullable<
    OrderExecutionServiceOptions["quoteService"]
  >;
  private readonly runInTransaction: TransactionRunner;
  private readonly nowProvider: () => Date;

  constructor(options: OrderExecutionServiceOptions = {}) {
    this.repository =
      options.repository ?? new MongooseOrderExecutionRepository();
    this.quoteService = options.quoteService ?? new InstrumentQuoteService();
    this.runInTransaction =
      options.runInTransaction ?? executeMongoTransaction;
    this.nowProvider = options.nowProvider ?? (() => new Date());
  }

  public async executeMarketOrder(
    rawInput: ExecuteMarketOrderInput,
    options: ExecuteMarketOrderOptions = {}
  ): Promise<OrderExecutionResult> {
    const validated = validateOrderExecutionInput(rawInput);
    const now = options.now ?? this.nowProvider();

    try {
      return await this.runInTransaction(async (session) => {
        // 1. Verify User exists and is permitted to trade
        const user = await this.repository.findUserById(validated.userId, {
          session,
        });
        if (!user) {
          throw new OrderExecutionError(
            "USER_NOT_FOUND",
            `User ${validated.userId.toString()} was not found.`
          );
        }
        if (user.status !== "ACTIVE") {
          throw new OrderExecutionError(
            "USER_NOT_PERMITTED",
            `User ${validated.userId.toString()} is not permitted to trade (status: ${user.status}).`
          );
        }

        // 2. Verify Practice Account exists, belongs to User, and is ACTIVE
        const account = await this.repository.findPracticeAccountById(
          validated.practiceAccountId,
          { session }
        );
        if (!account) {
          throw new OrderExecutionError(
            "ACCOUNT_NOT_FOUND",
            `Practice account ${validated.practiceAccountId.toString()} was not found.`
          );
        }
        if (account.userId.toString() !== validated.userId.toString()) {
          throw new OrderExecutionError(
            "ACCOUNT_OWNERSHIP_VIOLATION",
            "User is not authorized to trade on another user's practice account."
          );
        }
        if (account.status !== "ACTIVE") {
          throw new OrderExecutionError(
            "ACCOUNT_INACTIVE",
            `Practice account ${validated.practiceAccountId.toString()} is archived and cannot execute orders.`
          );
        }

        // 3. Check idempotency inside transaction
        const existingOrder =
          await this.repository.findOrderByAccountAndIdempotencyKey(
            validated.practiceAccountId,
            validated.idempotencyKey,
            { session }
          );

        if (existingOrder) {
          return await this.resolveIdempotentReplay(
            existingOrder,
            validated,
            account,
            options,
            now,
            session
          );
        }

        // 4. Retrieve authoritative simulated quote inside the transaction
        const quote = await this.loadQuoteInsideTransaction(
          validated.instrumentId,
          now,
          options.maxQuoteAgeMs,
          session
        );

        const existingHolding =
          await this.repository.findHoldingByAccountAndInstrument(
            validated.practiceAccountId,
            validated.userId,
            validated.instrumentId,
            { session }
          );

        // 5. Business checks on Instrument tradability and quote freshness
        if (!quote.isTradable) {
          return await this.persistRejectedOrderResult({
            validated,
            quote,
            account,
            existingHolding,
            rejectionCode: "INSTRUMENT_UNAVAILABLE",
            rejectionReason: `Instrument ${quote.symbol} (${quote.exchange}) is not tradable.`,
            now,
            session,
          });
        }

        if (quote.isStale) {
          return await this.persistRejectedOrderResult({
            validated,
            quote,
            account,
            existingHolding,
            rejectionCode: "STALE_QUOTE",
            rejectionReason: `Simulated quote for ${quote.symbol} (${quote.exchange}) is stale.`,
            now,
            session,
          });
        }

        const executionPricePaise =
          validated.side === "BUY" ? quote.askPricePaise : quote.bidPricePaise;

        if (willMultiplyOverflow(validated.quantity, executionPricePaise)) {
          return await this.persistRejectedOrderResult({
            validated,
            quote,
            account,
            existingHolding,
            rejectionCode: "OVERFLOW_LIMIT_EXCEEDED",
            rejectionReason:
              "Order value exceeds maximum safe integer paise limit.",
            now,
            session,
          });
        }

        if (validated.side === "BUY") {
          return await this.executeBuyWithinTransaction({
            validated,
            quote,
            account,
            existingHolding,
            executionPricePaise,
            now,
            session,
          });
        }

        return await this.executeSellWithinTransaction({
          validated,
          quote,
          account,
          existingHolding,
          executionPricePaise,
          now,
          session,
        });
      });
    } catch (err: unknown) {
      if (err instanceof OrderExecutionError) {
        throw err;
      }
      if (
        err instanceof PracticeAccountError &&
        err.code === "TRANSACTION_UNAVAILABLE"
      ) {
        throw new OrderExecutionError(
          "TRANSACTION_UNAVAILABLE",
          err.message
        );
      }
      if (isDuplicateKeyError(err)) {
        const committedOrder =
          await this.repository.findOrderByAccountAndIdempotencyKey(
            validated.practiceAccountId,
            validated.idempotencyKey
          );
        const currentAccount = await this.repository.findPracticeAccountById(
          validated.practiceAccountId
        );
        if (committedOrder && currentAccount) {
          return await this.resolveIdempotentReplay(
            committedOrder,
            validated,
            currentAccount,
            options,
            now,
            undefined
          );
        }
        throw new OrderExecutionError(
          "CONCURRENCY_CONFLICT",
          "Duplicate order execution conflict detected."
        );
      }
      if (isWriteConflictError(err)) {
        throw new OrderExecutionError(
          "CONCURRENCY_CONFLICT",
          "Transient transaction write conflict detected."
        );
      }
      if (err instanceof FinancialCalculationError) {
        throw new OrderExecutionError("VALIDATION_ERROR", err.message);
      }
      throw new OrderExecutionError(
        "EXECUTION_FAILED",
        "Order execution failed due to an unexpected internal error."
      );
    }
  }

  private async loadQuoteInsideTransaction(
    instrumentId: Types.ObjectId,
    now: Date,
    maxQuoteAgeMs: number | undefined,
    session: ClientSession | undefined
  ): Promise<InstrumentQuoteSnapshot> {
    try {
      return await this.quoteService.getQuoteByInstrumentId(instrumentId, {
        session,
        now,
        maxQuoteAgeMs,
        requireTradable: false,
        requireFresh: false,
      });
    } catch (err: unknown) {
      if (err instanceof InstrumentQuoteError) {
        if (err.code === "INSTRUMENT_NOT_FOUND") {
          throw new OrderExecutionError("INSTRUMENT_NOT_FOUND", err.message);
        }
        throw new OrderExecutionError("INVALID_QUOTE_DATA", err.message);
      }
      throw err;
    }
  }

  private async persistRejectedOrderResult(params: {
    validated: {
      userId: Types.ObjectId;
      practiceAccountId: Types.ObjectId;
      instrumentId: Types.ObjectId;
      side: OrderSide;
      quantity: number;
      idempotencyKey: string;
    };
    quote: InstrumentQuoteSnapshot;
    account: PersistedPracticeAccountRecord;
    existingHolding: PersistedHoldingRecord | null;
    rejectionCode: OrderRejectionCode;
    rejectionReason: string;
    now: Date;
    session: ClientSession | undefined;
  }): Promise<OrderExecutionResult> {
    const rejectedOrder = await this.repository.createOrder(
      {
        userId: params.validated.userId,
        practiceAccountId: params.validated.practiceAccountId,
        instrumentId: params.validated.instrumentId,
        symbol: params.quote.symbol,
        exchange: params.quote.exchange,
        side: params.validated.side,
        orderType: "MARKET",
        quantity: params.validated.quantity,
        status: "REJECTED",
        idempotencyKey: params.validated.idempotencyKey,
        executedQuantity: 0,
        rejectionCode: params.rejectionCode,
        rejectionReason: params.rejectionReason,
        rejectedAt: params.now,
      },
      { session: params.session }
    );

    return Object.freeze({
      status: "REJECTED",
      wasIdempotentReplay: false,
      order: rejectedOrder,
      rejectionCode: params.rejectionCode,
      rejectionReason: params.rejectionReason,
      trade: null,
      ledgerEntry: null,
      side: params.validated.side,
      quantity: params.validated.quantity,
      executionPricePaise: null,
      totalValuePaise: null,
      costBasisSoldPaise: null,
      realizedPnlPaise: null,
      cashBalanceBeforePaise: params.account.cashBalancePaise,
      updatedCashBalancePaise: params.account.cashBalancePaise,
      updatedHolding: params.existingHolding,
      quoteSnapshot: params.quote,
    });
  }

  private async executeBuyWithinTransaction(params: {
    validated: {
      userId: Types.ObjectId;
      practiceAccountId: Types.ObjectId;
      instrumentId: Types.ObjectId;
      side: OrderSide;
      quantity: number;
      idempotencyKey: string;
    };
    quote: InstrumentQuoteSnapshot;
    account: PersistedPracticeAccountRecord;
    existingHolding: PersistedHoldingRecord | null;
    executionPricePaise: number;
    now: Date;
    session: ClientSession | undefined;
  }): Promise<OrderExecutionResult> {
    const {
      validated,
      quote,
      account,
      existingHolding,
      executionPricePaise,
      now,
      session,
    } = params;

    let buyCalc;
    try {
      buyCalc = calculateHoldingAfterBuy({
        currentQuantity: existingHolding?.quantity ?? 0,
        currentTotalInvestedPaise: existingHolding?.totalInvestedPaise ?? 0,
        currentRealizedPnlPaise: existingHolding?.realizedPnlPaise ?? 0,
        currentVersion: existingHolding?.version ?? 0,
        buyQuantity: validated.quantity,
        askPricePaise: executionPricePaise,
      });
    } catch (err: unknown) {
      if (
        err instanceof FinancialCalculationError &&
        err.code === "ARITHMETIC_OVERFLOW"
      ) {
        return await this.persistRejectedOrderResult({
          validated,
          quote,
          account,
          existingHolding,
          rejectionCode: "OVERFLOW_LIMIT_EXCEEDED",
          rejectionReason: err.message,
          now,
          session,
        });
      }
      throw err;
    }

    if (account.cashBalancePaise < buyCalc.totalValuePaise) {
      return await this.persistRejectedOrderResult({
        validated,
        quote,
        account,
        existingHolding,
        rejectionCode: "INSUFFICIENT_FUNDS",
        rejectionReason: `Insufficient virtual cash balance: required ${buyCalc.totalValuePaise} paise, available ${account.cashBalancePaise} paise.`,
        now,
        session,
      });
    }

    const balanceBeforePaise = account.cashBalancePaise;
    const expectedBalanceAfterPaise = safeDebitBalancePaise(
      balanceBeforePaise,
      buyCalc.totalValuePaise
    );

    const updatedAccount = await this.repository.debitPracticeAccountBalance(
      {
        accountId: account._id,
        userId: validated.userId,
        expectedVersion: account.version,
        debitAmountPaise: buyCalc.totalValuePaise,
      },
      { session }
    );

    if (
      !updatedAccount ||
      updatedAccount.cashBalancePaise !== expectedBalanceAfterPaise
    ) {
      throw new OrderExecutionError(
        "CONCURRENCY_CONFLICT",
        "Concurrent balance modification detected during BUY execution."
      );
    }

    const createdOrder = await this.repository.createOrder(
      {
        userId: validated.userId,
        practiceAccountId: validated.practiceAccountId,
        instrumentId: validated.instrumentId,
        symbol: quote.symbol,
        exchange: quote.exchange,
        side: "BUY",
        orderType: "MARKET",
        quantity: validated.quantity,
        status: "EXECUTED",
        idempotencyKey: validated.idempotencyKey,
        executedQuantity: validated.quantity,
        executionPricePaise,
        totalValuePaise: buyCalc.totalValuePaise,
        executedAt: now,
      },
      { session }
    );

    const updatedHolding = await this.repository.saveHoldingAfterBuy(
      {
        existingHoldingId: existingHolding?._id,
        expectedVersion: existingHolding?.version,
        userId: validated.userId,
        practiceAccountId: validated.practiceAccountId,
        instrumentId: validated.instrumentId,
        symbol: quote.symbol,
        exchange: quote.exchange,
        newQuantity: buyCalc.newQuantity,
        newAverageBuyPricePaise: buyCalc.newAverageBuyPricePaise,
        newTotalInvestedPaise: buyCalc.newTotalInvestedPaise,
        newRealizedPnlPaise: buyCalc.newRealizedPnlPaise,
        newVersion: buyCalc.newVersion,
      },
      { session }
    );

    if (!updatedHolding) {
      throw new OrderExecutionError(
        "CONCURRENCY_CONFLICT",
        "Concurrent holding modification detected during BUY execution."
      );
    }

    const createdTrade = await this.repository.createTrade(
      {
        orderId: createdOrder._id,
        userId: validated.userId,
        practiceAccountId: validated.practiceAccountId,
        instrumentId: validated.instrumentId,
        symbol: quote.symbol,
        exchange: quote.exchange,
        side: "BUY",
        quantity: validated.quantity,
        executionPricePaise,
        totalValuePaise: buyCalc.totalValuePaise,
        costBasisSoldPaise: 0,
        realizedPnlPaise: 0,
        quoteSnapshot: {
          lastPricePaise: quote.lastPricePaise,
          bidPricePaise: quote.bidPricePaise,
          askPricePaise: quote.askPricePaise,
          priceUpdatedAt: quote.priceUpdatedAt,
        },
        idempotencyKey: validated.idempotencyKey,
        executedAt: now,
      },
      { session }
    );

    const createdLedger = await this.repository.createLedgerEntry(
      {
        userId: validated.userId,
        practiceAccountId: validated.practiceAccountId,
        entryType: "BUY_EXECUTION",
        direction: "DEBIT",
        amountPaise: buyCalc.totalValuePaise,
        balanceBeforePaise,
        balanceAfterPaise: updatedAccount.cashBalancePaise,
        referenceType: "TRADE",
        referenceId: createdTrade._id,
        idempotencyKey: validated.idempotencyKey,
        description: `BUY ${validated.quantity} ${quote.symbol} (${quote.exchange}) @ ${executionPricePaise} paise`,
      },
      { session }
    );

    return Object.freeze({
      status: "EXECUTED",
      wasIdempotentReplay: false,
      order: createdOrder,
      trade: createdTrade,
      ledgerEntry: createdLedger,
      side: "BUY",
      quantity: validated.quantity,
      executionPricePaise,
      totalValuePaise: buyCalc.totalValuePaise,
      costBasisSoldPaise: 0,
      realizedPnlPaise: 0,
      cashBalanceBeforePaise: balanceBeforePaise,
      updatedCashBalancePaise: updatedAccount.cashBalancePaise,
      updatedHolding,
      quoteSnapshot: quote,
    });
  }

  private async executeSellWithinTransaction(params: {
    validated: {
      userId: Types.ObjectId;
      practiceAccountId: Types.ObjectId;
      instrumentId: Types.ObjectId;
      side: OrderSide;
      quantity: number;
      idempotencyKey: string;
    };
    quote: InstrumentQuoteSnapshot;
    account: PersistedPracticeAccountRecord;
    existingHolding: PersistedHoldingRecord | null;
    executionPricePaise: number;
    now: Date;
    session: ClientSession | undefined;
  }): Promise<OrderExecutionResult> {
    const {
      validated,
      quote,
      account,
      existingHolding,
      executionPricePaise,
      now,
      session,
    } = params;

    if (!existingHolding || existingHolding.quantity < validated.quantity) {
      const availableQty = existingHolding?.quantity ?? 0;
      return await this.persistRejectedOrderResult({
        validated,
        quote,
        account,
        existingHolding,
        rejectionCode: "INSUFFICIENT_QUANTITY",
        rejectionReason: `Insufficient holding quantity: requested ${validated.quantity} shares, available ${availableQty} shares.`,
        now,
        session,
      });
    }

    let sellCalc;
    let expectedBalanceAfterPaise: number;
    try {
      sellCalc = calculateHoldingAfterSell({
        currentQuantity: existingHolding.quantity,
        currentTotalInvestedPaise: existingHolding.totalInvestedPaise,
        currentRealizedPnlPaise: existingHolding.realizedPnlPaise,
        currentVersion: existingHolding.version,
        sellQuantity: validated.quantity,
        bidPricePaise: executionPricePaise,
      });
      expectedBalanceAfterPaise = safeAddPaise(
        account.cashBalancePaise,
        sellCalc.totalValuePaise,
        "cashBalanceAfterPaise"
      );
    } catch (err: unknown) {
      if (
        err instanceof FinancialCalculationError &&
        err.code === "ARITHMETIC_OVERFLOW"
      ) {
        return await this.persistRejectedOrderResult({
          validated,
          quote,
          account,
          existingHolding,
          rejectionCode: "OVERFLOW_LIMIT_EXCEEDED",
          rejectionReason: err.message,
          now,
          session,
        });
      }
      throw err;
    }

    const balanceBeforePaise = account.cashBalancePaise;

    const updatedHolding = await this.repository.updateHoldingAfterSell(
      {
        holdingId: existingHolding._id,
        expectedVersion: existingHolding.version,
        userId: validated.userId,
        practiceAccountId: validated.practiceAccountId,
        instrumentId: validated.instrumentId,
        symbol: quote.symbol,
        sellQuantity: validated.quantity,
        newQuantity: sellCalc.newQuantity,
        newAverageBuyPricePaise: sellCalc.newAverageBuyPricePaise,
        newTotalInvestedPaise: sellCalc.newTotalInvestedPaise,
        newRealizedPnlPaise: sellCalc.newRealizedPnlPaise,
        newVersion: sellCalc.newVersion,
      },
      { session }
    );

    if (!updatedHolding) {
      throw new OrderExecutionError(
        "CONCURRENCY_CONFLICT",
        "Concurrent holding modification detected during SELL execution."
      );
    }

    const updatedAccount = await this.repository.creditPracticeAccountBalance(
      {
        accountId: account._id,
        userId: validated.userId,
        expectedVersion: account.version,
        creditAmountPaise: sellCalc.totalValuePaise,
      },
      { session }
    );

    if (
      !updatedAccount ||
      updatedAccount.cashBalancePaise !== expectedBalanceAfterPaise
    ) {
      throw new OrderExecutionError(
        "CONCURRENCY_CONFLICT",
        "Concurrent balance modification detected during SELL execution."
      );
    }

    const createdOrder = await this.repository.createOrder(
      {
        userId: validated.userId,
        practiceAccountId: validated.practiceAccountId,
        instrumentId: validated.instrumentId,
        symbol: quote.symbol,
        exchange: quote.exchange,
        side: "SELL",
        orderType: "MARKET",
        quantity: validated.quantity,
        status: "EXECUTED",
        idempotencyKey: validated.idempotencyKey,
        executedQuantity: validated.quantity,
        executionPricePaise,
        totalValuePaise: sellCalc.totalValuePaise,
        executedAt: now,
      },
      { session }
    );

    const createdTrade = await this.repository.createTrade(
      {
        orderId: createdOrder._id,
        userId: validated.userId,
        practiceAccountId: validated.practiceAccountId,
        instrumentId: validated.instrumentId,
        symbol: quote.symbol,
        exchange: quote.exchange,
        side: "SELL",
        quantity: validated.quantity,
        executionPricePaise,
        totalValuePaise: sellCalc.totalValuePaise,
        costBasisSoldPaise: sellCalc.costBasisSoldPaise,
        realizedPnlPaise: sellCalc.tradeRealizedPnlPaise,
        quoteSnapshot: {
          lastPricePaise: quote.lastPricePaise,
          bidPricePaise: quote.bidPricePaise,
          askPricePaise: quote.askPricePaise,
          priceUpdatedAt: quote.priceUpdatedAt,
        },
        idempotencyKey: validated.idempotencyKey,
        executedAt: now,
      },
      { session }
    );

    const createdLedger = await this.repository.createLedgerEntry(
      {
        userId: validated.userId,
        practiceAccountId: validated.practiceAccountId,
        entryType: "SELL_EXECUTION",
        direction: "CREDIT",
        amountPaise: sellCalc.totalValuePaise,
        balanceBeforePaise,
        balanceAfterPaise: updatedAccount.cashBalancePaise,
        referenceType: "TRADE",
        referenceId: createdTrade._id,
        idempotencyKey: validated.idempotencyKey,
        description: `SELL ${validated.quantity} ${quote.symbol} (${quote.exchange}) @ ${executionPricePaise} paise`,
      },
      { session }
    );

    return Object.freeze({
      status: "EXECUTED",
      wasIdempotentReplay: false,
      order: createdOrder,
      trade: createdTrade,
      ledgerEntry: createdLedger,
      side: "SELL",
      quantity: validated.quantity,
      executionPricePaise,
      totalValuePaise: sellCalc.totalValuePaise,
      costBasisSoldPaise: sellCalc.costBasisSoldPaise,
      realizedPnlPaise: sellCalc.tradeRealizedPnlPaise,
      cashBalanceBeforePaise: balanceBeforePaise,
      updatedCashBalancePaise: updatedAccount.cashBalancePaise,
      updatedHolding,
      quoteSnapshot: quote,
    });
  }

  private async resolveIdempotentReplay(
    existingOrder: PersistedOrderRecord,
    validated: {
      userId: Types.ObjectId;
      practiceAccountId: Types.ObjectId;
      instrumentId: Types.ObjectId;
      side: OrderSide;
      quantity: number;
      idempotencyKey: string;
    },
    account: PersistedPracticeAccountRecord,
    options: ExecuteMarketOrderOptions,
    now: Date,
    session: ClientSession | undefined
  ): Promise<OrderExecutionResult> {
    const isSameIntent =
      existingOrder.userId.toString() === validated.userId.toString() &&
      existingOrder.practiceAccountId.toString() ===
        validated.practiceAccountId.toString() &&
      existingOrder.instrumentId.toString() ===
        validated.instrumentId.toString() &&
      existingOrder.side === validated.side &&
      existingOrder.quantity === validated.quantity;

    if (!isSameIntent) {
      throw new OrderExecutionError(
        "IDEMPOTENCY_KEY_CONFLICT",
        `idempotencyKey '${validated.idempotencyKey}' was already used with different order parameters.`
      );
    }

    const quote = await this.loadQuoteInsideTransaction(
      validated.instrumentId,
      now,
      options.maxQuoteAgeMs,
      session
    );
    const holding = await this.repository.findHoldingByAccountAndInstrument(
      validated.practiceAccountId,
      validated.userId,
      validated.instrumentId,
      { session }
    );

    if (existingOrder.status === "REJECTED") {
      return Object.freeze({
        status: "REJECTED",
        wasIdempotentReplay: true,
        order: existingOrder,
        rejectionCode: existingOrder.rejectionCode ?? "VALIDATION_ERROR",
        rejectionReason:
          existingOrder.rejectionReason ?? "Order was previously rejected.",
        trade: null,
        ledgerEntry: null,
        side: existingOrder.side,
        quantity: existingOrder.quantity,
        executionPricePaise: null,
        totalValuePaise: null,
        costBasisSoldPaise: null,
        realizedPnlPaise: null,
        cashBalanceBeforePaise: account.cashBalancePaise,
        updatedCashBalancePaise: account.cashBalancePaise,
        updatedHolding: holding,
        quoteSnapshot: quote,
      });
    }

    if (existingOrder.status === "EXECUTED") {
      const trade = await this.repository.findTradeByOrderId(
        existingOrder._id,
        { session }
      );
      if (!trade || !holding) {
        throw new OrderExecutionError(
          "EXECUTION_FAILED",
          "Executed order replay is missing its associated Trade or Holding record."
        );
      }
      const ledgerEntry = await this.repository.findLedgerEntryByTradeId(
        trade._id,
        { session }
      );
      if (!ledgerEntry) {
        throw new OrderExecutionError(
          "EXECUTION_FAILED",
          "Executed order replay is missing its associated LedgerEntry record."
        );
      }

      return Object.freeze({
        status: "EXECUTED",
        wasIdempotentReplay: true,
        order: existingOrder,
        trade,
        ledgerEntry,
        side: trade.side,
        quantity: trade.quantity,
        executionPricePaise: trade.executionPricePaise,
        totalValuePaise: trade.totalValuePaise,
        costBasisSoldPaise: trade.costBasisSoldPaise,
        realizedPnlPaise: trade.realizedPnlPaise,
        cashBalanceBeforePaise: ledgerEntry.balanceBeforePaise,
        updatedCashBalancePaise: ledgerEntry.balanceAfterPaise,
        updatedHolding: holding,
        quoteSnapshot: quote,
      });
    }

    throw new OrderExecutionError(
      "CONCURRENCY_CONFLICT",
      `Order '${existingOrder._id.toString()}' is in non-terminal status '${existingOrder.status}'.`
    );
  }
}
