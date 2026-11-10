import mongoose, { ClientSession, Types } from "mongoose";
import {
  assertNonNegativeSafeIntegerPaise,
  assertPositiveSafeIntegerPaise,
  INITIAL_VIRTUAL_BALANCE_PAISE,
} from "../../shared/finance/financial.utils";
import { LedgerEntryModel } from "../ledger/ledger.model";
import { PracticeAccountModel } from "./account.model";
import { DEFAULT_INITIAL_BALANCE_PAISE } from "./account.schema";
import {
  CreateInitialFundingLedgerInput,
  CreatePracticeAccountInput,
  PersistedLedgerEntryRecord,
  PersistedPracticeAccountRecord,
  PracticeAccountBalanceView,
  PracticeAccountError,
  PracticeAccountQueryOptions,
  PracticeAccountRepositoryPort,
  PracticeAccountServiceOptions,
  PracticeAccountSummary,
  ResetPracticeAccountOptions,
  ResetPracticeAccountResult,
  TransactionCallback,
  TransactionRunner,
} from "./account.service.types";

function resolveObjectId(
  rawId: Types.ObjectId | string,
  errorCode: "INVALID_USER_ID" | "INVALID_ACCOUNT_ID",
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
  throw new PracticeAccountError(
    errorCode,
    `${fieldName} must be a valid MongoDB ObjectId.`
  );
}

function toAccountSummary(
  record: PersistedPracticeAccountRecord
): PracticeAccountSummary {
  assertPositiveSafeIntegerPaise(
    record.initialBalancePaise,
    "initialBalancePaise"
  );
  assertNonNegativeSafeIntegerPaise(
    record.cashBalancePaise,
    "cashBalancePaise"
  );

  return Object.freeze({
    accountId: new Types.ObjectId(record._id.toString()),
    userId: new Types.ObjectId(record.userId.toString()),
    accountNumber: record.accountNumber,
    status: record.status,
    initialBalancePaise: record.initialBalancePaise,
    cashBalancePaise: record.cashBalancePaise,
    version: record.version,
    archivedAt: record.archivedAt
      ? new Date(record.archivedAt.getTime())
      : undefined,
    createdAt: new Date(record.createdAt.getTime()),
    updatedAt: new Date(record.updatedAt.getTime()),
  });
}

function isTransactionUnsupportedError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) {
    return false;
  }
  const record = err as Record<string, unknown>;
  const code = record.code;
  const message = typeof record.message === "string" ? record.message : "";
  return (
    code === 20 ||
    code === 263 ||
    /Transaction numbers are only allowed on a replica set member or mongos/i.test(
      message
    ) ||
    /transactions are not supported/i.test(message)
  );
}

function isDuplicateKeyOrWriteConflictError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) {
    return false;
  }
  const record = err as Record<string, unknown>;
  return (
    record.code === 11000 ||
    record.code === 112 ||
    record.codeName === "WriteConflict" ||
    record.codeName === "DuplicateKey"
  );
}

/**
 * Default MongoDB transaction runner using Mongoose `startSession()`.
 * Requires a transaction-capable MongoDB deployment (replica set or mongos).
 * Never silently falls back to non-transactional writes.
 */
export async function executeMongoTransaction<T>(
  work: TransactionCallback<T>
): Promise<T> {
  let session: ClientSession;
  try {
    session = await mongoose.startSession();
  } catch (err: unknown) {
    if (isTransactionUnsupportedError(err)) {
      throw new PracticeAccountError(
        "TRANSACTION_UNAVAILABLE",
        "MongoDB transactions require a replica set or sharded cluster deployment."
      );
    }
    throw err;
  }

  try {
    session.startTransaction({
      readConcern: { level: "snapshot" },
      writeConcern: { w: "majority" },
    });

    const result = await work(session);
    await session.commitTransaction();
    return result;
  } catch (err: unknown) {
    if (session.inTransaction()) {
      try {
        await session.abortTransaction();
      } catch {
        // Ignore secondary abort errors while preserving the primary failure
      }
    }
    if (isTransactionUnsupportedError(err)) {
      throw new PracticeAccountError(
        "TRANSACTION_UNAVAILABLE",
        "MongoDB transactions require a replica set or sharded cluster deployment."
      );
    }
    throw err;
  } finally {
    await session.endSession();
  }
}

/**
 * Default Mongoose-backed repository for `PracticeAccount` and initial `LedgerEntry` creation.
 */
export class MongoosePracticeAccountRepository
  implements PracticeAccountRepositoryPort
{
  public async findActiveByUserId(
    userId: Types.ObjectId,
    options?: { session?: ClientSession }
  ): Promise<PersistedPracticeAccountRecord | null> {
    const query = PracticeAccountModel.findOne({
      userId,
      status: "ACTIVE",
    });
    if (options?.session) {
      query.session(options.session);
    }
    const doc = await query.lean<PersistedPracticeAccountRecord>().exec();
    return doc ?? null;
  }

  public async findById(
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

  public async findHighestAccountNumberForUser(
    userId: Types.ObjectId,
    options?: { session?: ClientSession }
  ): Promise<number> {
    const query = PracticeAccountModel.findOne({ userId })
      .sort({ accountNumber: -1 })
      .select("accountNumber");
    if (options?.session) {
      query.session(options.session);
    }
    const doc = await query
      .lean<{ accountNumber: number }>()
      .exec();
    return doc?.accountNumber ?? 0;
  }

  public async archiveActiveAccount(
    params: {
      accountId: Types.ObjectId;
      userId: Types.ObjectId;
      expectedVersion: number;
      archivedAt: Date;
    },
    options?: { session?: ClientSession }
  ): Promise<PersistedPracticeAccountRecord | null> {
    const query = PracticeAccountModel.findOneAndUpdate(
      {
        _id: params.accountId,
        userId: params.userId,
        status: "ACTIVE",
        version: params.expectedVersion,
      },
      {
        $set: {
          status: "ARCHIVED",
          archivedAt: params.archivedAt,
        },
        $inc: {
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

  public async createActiveAccount(
    input: CreatePracticeAccountInput,
    options?: { session?: ClientSession }
  ): Promise<PersistedPracticeAccountRecord> {
    const doc = new PracticeAccountModel({
      userId: input.userId,
      accountNumber: input.accountNumber,
      status: input.status,
      initialBalancePaise: input.initialBalancePaise,
      cashBalancePaise: input.cashBalancePaise,
      version: input.version,
    });
    const saved = await doc.save({ session: options?.session });
    return saved.toObject() as unknown as PersistedPracticeAccountRecord;
  }

  public async createInitialFundingLedgerEntry(
    input: CreateInitialFundingLedgerInput,
    options?: { session?: ClientSession }
  ): Promise<PersistedLedgerEntryRecord> {
    const doc = new LedgerEntryModel({
      userId: input.userId,
      practiceAccountId: input.practiceAccountId,
      entryType: input.entryType,
      direction: input.direction,
      amountPaise: input.amountPaise,
      balanceBeforePaise: input.balanceBeforePaise,
      balanceAfterPaise: input.balanceAfterPaise,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      idempotencyKey: input.idempotencyKey,
      description: input.description,
    });
    const saved = await doc.save({ session: options?.session });
    return saved.toObject() as unknown as PersistedLedgerEntryRecord;
  }
}

/**
 * Practice Account Business Service.
 *
 * Responsibilities:
 * - Retrieves active practice accounts and enforces user-level ownership in the service layer.
 * - Prevents archived practice accounts from being used as active accounts.
 * - Resets a user's practice account atomically inside a single MongoDB transaction:
 *   1. Archives the current ACTIVE account (preserving all orders, trades, holdings, and ledger entries).
 *   2. Allocates the next monotonic `accountNumber` for the user (`highestAccountNumber + 1`).
 *   3. Creates a new ACTIVE practice account funded with `100_000_000` paise (₹10,00,000.00).
 *   4. Writes a reconciled `INITIAL_FUNDING` `CREDIT` ledger entry (`0 -> 100_000_000` paise).
 *   5. Leaves user-level watchlists untouched.
 */
export class PracticeAccountService {
  private readonly repository: PracticeAccountRepositoryPort;
  private readonly runInTransaction: TransactionRunner;
  private readonly nowProvider: () => Date;

  constructor(options: PracticeAccountServiceOptions = {}) {
    this.repository =
      options.repository ?? new MongoosePracticeAccountRepository();
    this.runInTransaction =
      options.runInTransaction ?? executeMongoTransaction;
    this.nowProvider = options.nowProvider ?? (() => new Date());
  }

  /**
   * Retrieves the currently ACTIVE practice account for a user.
   */
  public async getActiveAccountForUser(
    userId: Types.ObjectId | string,
    options: { session?: ClientSession } = {}
  ): Promise<PracticeAccountSummary> {
    const resolvedUserId = resolveObjectId(
      userId,
      "INVALID_USER_ID",
      "userId"
    );
    const record = await this.repository.findActiveByUserId(
      resolvedUserId,
      options
    );

    if (!record) {
      throw new PracticeAccountError(
        "ACTIVE_ACCOUNT_NOT_FOUND",
        `No active practice account found for user ${resolvedUserId.toString()}.`
      );
    }

    if (record.userId.toString() !== resolvedUserId.toString()) {
      throw new PracticeAccountError(
        "ACCOUNT_OWNERSHIP_VIOLATION",
        "Practice account does not belong to the specified user."
      );
    }

    if (record.status !== "ACTIVE") {
      throw new PracticeAccountError(
        "ACCOUNT_ARCHIVED",
        "Practice account is archived and cannot be used as an active account."
      );
    }

    return toAccountSummary(record);
  }

  /**
   * Retrieves a specific practice account by ID and verifies that `userId` owns it.
   * When `options.requireActive` is true, rejects `ARCHIVED` accounts with `ACCOUNT_ARCHIVED`.
   */
  public async getAccountByIdForUser(
    accountId: Types.ObjectId | string,
    userId: Types.ObjectId | string,
    options: PracticeAccountQueryOptions = {}
  ): Promise<PracticeAccountSummary> {
    const resolvedAccountId = resolveObjectId(
      accountId,
      "INVALID_ACCOUNT_ID",
      "accountId"
    );
    const resolvedUserId = resolveObjectId(
      userId,
      "INVALID_USER_ID",
      "userId"
    );

    const record = await this.repository.findById(resolvedAccountId, {
      session: options.session,
    });

    if (!record) {
      throw new PracticeAccountError(
        "ACCOUNT_NOT_FOUND",
        `Practice account ${resolvedAccountId.toString()} was not found.`
      );
    }

    if (record.userId.toString() !== resolvedUserId.toString()) {
      throw new PracticeAccountError(
        "ACCOUNT_OWNERSHIP_VIOLATION",
        "User is not authorized to access another user's practice account."
      );
    }

    if (options.requireActive && record.status !== "ACTIVE") {
      throw new PracticeAccountError(
        "ACCOUNT_ARCHIVED",
        `Practice account ${resolvedAccountId.toString()} is archived.`
      );
    }

    return toAccountSummary(record);
  }

  /**
   * Retrieves the active balance and basic account information for a user
   * (either for a specified active `accountId` owned by the user or their current active account).
   */
  public async getAccountBalanceForUser(
    userId: Types.ObjectId | string,
    accountId?: Types.ObjectId | string,
    options: { session?: ClientSession } = {}
  ): Promise<PracticeAccountBalanceView> {
    const account = accountId
      ? await this.getAccountByIdForUser(accountId, userId, {
          session: options.session,
          requireActive: true,
        })
      : await this.getActiveAccountForUser(userId, options);

    return Object.freeze({
      accountId: account.accountId,
      userId: account.userId,
      accountNumber: account.accountNumber,
      status: "ACTIVE",
      initialBalancePaise: account.initialBalancePaise,
      cashBalancePaise: account.cashBalancePaise,
      version: account.version,
    });
  }

  /**
   * Atomically archives the user's existing ACTIVE practice account (if any),
   * creates a new ACTIVE practice account starting at `100_000_000` paise (₹10,00,000),
   * and writes a reconciled `INITIAL_FUNDING` `CREDIT` ledger entry inside one MongoDB transaction.
   *
   * Account Numbering Design:
   * Queries the user's highest existing `accountNumber` across active and archived accounts
   * inside the transaction and assigns `highestAccountNumber + 1` (starting at `1`).
   * Enforced at the database level by `practice_accounts_user_account_number_unique_idx`
   * and `practice_accounts_one_active_per_user_idx`.
   */
  public async resetPracticeAccount(
    userId: Types.ObjectId | string,
    options: ResetPracticeAccountOptions = {}
  ): Promise<ResetPracticeAccountResult> {
    const resolvedUserId = resolveObjectId(
      userId,
      "INVALID_USER_ID",
      "userId"
    );
    const now = options.now ?? this.nowProvider();

    if (
      options.idempotencyKey !== undefined &&
      (typeof options.idempotencyKey !== "string" ||
        options.idempotencyKey.trim().length < 1 ||
        options.idempotencyKey.trim().length > 128)
    ) {
      throw new PracticeAccountError(
        "ACCOUNT_RESET_FAILED",
        "idempotencyKey must be between 1 and 128 characters when provided."
      );
    }

    try {
      return await this.runInTransaction(async (session) => {
        const currentActive = await this.repository.findActiveByUserId(
          resolvedUserId,
          { session }
        );

        let archivedSummary: PracticeAccountSummary | null = null;
        if (currentActive) {
          const archivedRecord = await this.repository.archiveActiveAccount(
            {
              accountId: currentActive._id,
              userId: resolvedUserId,
              expectedVersion: currentActive.version,
              archivedAt: now,
            },
            { session }
          );

          if (!archivedRecord) {
            throw new PracticeAccountError(
              "ACCOUNT_RESET_CONFLICT",
              "Concurrent modification detected while archiving active practice account."
            );
          }

          archivedSummary = toAccountSummary(archivedRecord);
        }

        const highestAccountNumber =
          await this.repository.findHighestAccountNumberForUser(
            resolvedUserId,
            { session }
          );
        if (
          !Number.isSafeInteger(highestAccountNumber) ||
          highestAccountNumber < 0 ||
          highestAccountNumber >= Number.MAX_SAFE_INTEGER
        ) {
          throw new PracticeAccountError(
            "ACCOUNT_RESET_FAILED",
            "Unable to allocate a valid next accountNumber."
          );
        }

        const nextAccountNumber = highestAccountNumber + 1;
        const initialBalancePaise =
          DEFAULT_INITIAL_BALANCE_PAISE || INITIAL_VIRTUAL_BALANCE_PAISE;

        const createdAccountRecord = await this.repository.createActiveAccount(
          {
            userId: resolvedUserId,
            accountNumber: nextAccountNumber,
            status: "ACTIVE",
            initialBalancePaise,
            cashBalancePaise: initialBalancePaise,
            version: 0,
          },
          { session }
        );

        const activeSummary = toAccountSummary(createdAccountRecord);
        const effectiveIdempotencyKey =
          options.idempotencyKey?.trim() ??
          `initial-funding-${activeSummary.accountId.toString()}`;

        const ledgerRecord =
          await this.repository.createInitialFundingLedgerEntry(
            {
              userId: resolvedUserId,
              practiceAccountId: activeSummary.accountId,
              entryType: "INITIAL_FUNDING",
              direction: "CREDIT",
              amountPaise: initialBalancePaise,
              balanceBeforePaise: 0,
              balanceAfterPaise: initialBalancePaise,
              referenceType: "PRACTICE_ACCOUNT",
              referenceId: activeSummary.accountId,
              idempotencyKey: effectiveIdempotencyKey,
              description: `Initial virtual funding for practice account #${nextAccountNumber}`,
            },
            { session }
          );

        return Object.freeze({
          archivedAccount: archivedSummary,
          activeAccount: activeSummary,
          initialFundingLedgerEntry: Object.freeze({
            ledgerEntryId: new Types.ObjectId(ledgerRecord._id.toString()),
            practiceAccountId: new Types.ObjectId(
              ledgerRecord.practiceAccountId.toString()
            ),
            entryType: "INITIAL_FUNDING",
            direction: "CREDIT",
            amountPaise: ledgerRecord.amountPaise,
            balanceBeforePaise: 0,
            balanceAfterPaise: ledgerRecord.balanceAfterPaise,
            referenceType: "PRACTICE_ACCOUNT",
            referenceId: new Types.ObjectId(
              ledgerRecord.referenceId.toString()
            ),
            idempotencyKey: ledgerRecord.idempotencyKey,
            createdAt: new Date(ledgerRecord.createdAt.getTime()),
          }),
        });
      });
    } catch (err: unknown) {
      if (err instanceof PracticeAccountError) {
        throw err;
      }
      if (isDuplicateKeyOrWriteConflictError(err)) {
        throw new PracticeAccountError(
          "ACCOUNT_RESET_CONFLICT",
          "Concurrent practice account reset conflict detected."
        );
      }
      throw new PracticeAccountError(
        "ACCOUNT_RESET_FAILED",
        "Failed to reset practice account cleanly."
      );
    }
  }
}
