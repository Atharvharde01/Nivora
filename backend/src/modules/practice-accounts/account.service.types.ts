import { ClientSession, Types } from "mongoose";
import { ILedgerEntry } from "../ledger/ledger.types";
import { PracticeAccountStatus } from "./account.types";

export const PRACTICE_ACCOUNT_ERROR_CODES = [
  "INVALID_USER_ID",
  "INVALID_ACCOUNT_ID",
  "ACTIVE_ACCOUNT_NOT_FOUND",
  "ACCOUNT_NOT_FOUND",
  "ACCOUNT_OWNERSHIP_VIOLATION",
  "ACCOUNT_ARCHIVED",
  "ACCOUNT_RESET_CONFLICT",
  "TRANSACTION_UNAVAILABLE",
  "ACCOUNT_RESET_FAILED",
] as const;

export type PracticeAccountErrorCode =
  (typeof PRACTICE_ACCOUNT_ERROR_CODES)[number];

export class PracticeAccountError extends Error {
  public readonly code: PracticeAccountErrorCode;

  constructor(code: PracticeAccountErrorCode, message: string) {
    super(message);
    this.name = "PracticeAccountError";
    this.code = code;
    Object.setPrototypeOf(this, PracticeAccountError.prototype);
  }
}

export interface PersistedPracticeAccountRecord {
  readonly _id: Types.ObjectId;
  readonly userId: Types.ObjectId;
  readonly accountNumber: number;
  readonly status: PracticeAccountStatus;
  readonly initialBalancePaise: number;
  readonly cashBalancePaise: number;
  readonly version: number;
  readonly archivedAt?: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface PracticeAccountSummary {
  readonly accountId: Types.ObjectId;
  readonly userId: Types.ObjectId;
  readonly accountNumber: number;
  readonly status: PracticeAccountStatus;
  readonly initialBalancePaise: number;
  readonly cashBalancePaise: number;
  readonly version: number;
  readonly archivedAt?: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface PracticeAccountBalanceView {
  readonly accountId: Types.ObjectId;
  readonly userId: Types.ObjectId;
  readonly accountNumber: number;
  readonly status: "ACTIVE";
  readonly initialBalancePaise: number;
  readonly cashBalancePaise: number;
  readonly version: number;
}

export interface ResetPracticeAccountResult {
  readonly archivedAccount: PracticeAccountSummary | null;
  readonly activeAccount: PracticeAccountSummary;
  readonly initialFundingLedgerEntry: {
    readonly ledgerEntryId: Types.ObjectId;
    readonly practiceAccountId: Types.ObjectId;
    readonly entryType: "INITIAL_FUNDING";
    readonly direction: "CREDIT";
    readonly amountPaise: number;
    readonly balanceBeforePaise: 0;
    readonly balanceAfterPaise: number;
    readonly referenceType: "PRACTICE_ACCOUNT";
    readonly referenceId: Types.ObjectId;
    readonly idempotencyKey: string;
    readonly createdAt: Date;
  };
}

export interface PracticeAccountQueryOptions {
  readonly session?: ClientSession;
  readonly requireActive?: boolean;
}

export interface ResetPracticeAccountOptions {
  readonly idempotencyKey?: string;
  readonly now?: Date;
}

export interface CreatePracticeAccountInput {
  readonly userId: Types.ObjectId;
  readonly accountNumber: number;
  readonly initialBalancePaise: number;
  readonly cashBalancePaise: number;
  readonly status: "ACTIVE";
  readonly version: number;
}

export interface CreateInitialFundingLedgerInput {
  readonly userId: Types.ObjectId;
  readonly practiceAccountId: Types.ObjectId;
  readonly entryType: "INITIAL_FUNDING";
  readonly direction: "CREDIT";
  readonly amountPaise: number;
  readonly balanceBeforePaise: 0;
  readonly balanceAfterPaise: number;
  readonly referenceType: "PRACTICE_ACCOUNT";
  readonly referenceId: Types.ObjectId;
  readonly idempotencyKey: string;
  readonly description: string;
}

export interface PersistedLedgerEntryRecord extends ILedgerEntry {
  readonly _id: Types.ObjectId;
}

export interface PracticeAccountRepositoryPort {
  findActiveByUserId(
    userId: Types.ObjectId,
    options?: { session?: ClientSession }
  ): Promise<PersistedPracticeAccountRecord | null>;

  findById(
    accountId: Types.ObjectId,
    options?: { session?: ClientSession }
  ): Promise<PersistedPracticeAccountRecord | null>;

  findHighestAccountNumberForUser(
    userId: Types.ObjectId,
    options?: { session?: ClientSession }
  ): Promise<number>;

  archiveActiveAccount(
    params: {
      accountId: Types.ObjectId;
      userId: Types.ObjectId;
      expectedVersion: number;
      archivedAt: Date;
    },
    options?: { session?: ClientSession }
  ): Promise<PersistedPracticeAccountRecord | null>;

  createActiveAccount(
    input: CreatePracticeAccountInput,
    options?: { session?: ClientSession }
  ): Promise<PersistedPracticeAccountRecord>;

  createInitialFundingLedgerEntry(
    input: CreateInitialFundingLedgerInput,
    options?: { session?: ClientSession }
  ): Promise<PersistedLedgerEntryRecord>;
}

export type TransactionCallback<T> = (
  session: ClientSession | undefined
) => Promise<T>;

export type TransactionRunner = <T>(
  work: TransactionCallback<T>
) => Promise<T>;

export interface PracticeAccountServiceOptions {
  readonly repository?: PracticeAccountRepositoryPort;
  readonly runInTransaction?: TransactionRunner;
  readonly nowProvider?: () => Date;
}
