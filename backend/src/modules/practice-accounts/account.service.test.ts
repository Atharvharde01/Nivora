import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Types } from "mongoose";
import { INITIAL_VIRTUAL_BALANCE_PAISE } from "../../shared/finance/financial.utils";
import { LedgerEntryModel } from "../ledger/ledger.model";
import { WatchlistItemModel } from "../watchlist/watchlist.model";
import { PracticeAccountModel } from "./account.model";
import { PracticeAccountService } from "./account.service";
import {
  CreateInitialFundingLedgerInput,
  CreatePracticeAccountInput,
  PersistedLedgerEntryRecord,
  PersistedPracticeAccountRecord,
  PracticeAccountError,
  PracticeAccountRepositoryPort,
  TransactionCallback,
} from "./account.service.types";

class InMemoryTransactionalAccountStore implements PracticeAccountRepositoryPort {
  public accounts: PersistedPracticeAccountRecord[];
  public ledgerEntries: PersistedLedgerEntryRecord[];
  public watchlistItems: Array<{
    _id: Types.ObjectId;
    userId: Types.ObjectId;
    instrumentId: Types.ObjectId;
    symbolSnapshot: string;
    sortOrder: number;
  }>;
  public failOnCreateLedger = false;

  constructor(
    initialAccounts: PersistedPracticeAccountRecord[] = [],
    initialLedger: PersistedLedgerEntryRecord[] = []
  ) {
    this.accounts = [...initialAccounts];
    this.ledgerEntries = [...initialLedger];
    this.watchlistItems = [];
  }

  public createTransactionRunner() {
    return async <T>(work: TransactionCallback<T>): Promise<T> => {
      // Snapshot state before transaction to simulate atomic rollback on failure
      const accountsSnapshot = this.accounts.map((a) => ({ ...a }));
      const ledgerSnapshot = this.ledgerEntries.map((l) => ({ ...l }));
      const watchlistSnapshot = this.watchlistItems.map((w) => ({ ...w }));

      try {
        return await work(undefined);
      } catch (err) {
        this.accounts = accountsSnapshot;
        this.ledgerEntries = ledgerSnapshot;
        this.watchlistItems = watchlistSnapshot;
        throw err;
      }
    };
  }

  public async findActiveByUserId(
    userId: Types.ObjectId
  ): Promise<PersistedPracticeAccountRecord | null> {
    const found = this.accounts.find(
      (a) =>
        a.userId.toString() === userId.toString() && a.status === "ACTIVE"
    );
    return found ? { ...found } : null;
  }

  public async findById(
    accountId: Types.ObjectId
  ): Promise<PersistedPracticeAccountRecord | null> {
    const found = this.accounts.find(
      (a) => a._id.toString() === accountId.toString()
    );
    return found ? { ...found } : null;
  }

  public async findHighestAccountNumberForUser(
    userId: Types.ObjectId
  ): Promise<number> {
    const userAccounts = this.accounts.filter(
      (a) => a.userId.toString() === userId.toString()
    );
    if (userAccounts.length === 0) {
      return 0;
    }
    return Math.max(...userAccounts.map((a) => a.accountNumber));
  }

  public async archiveActiveAccount(params: {
    accountId: Types.ObjectId;
    userId: Types.ObjectId;
    expectedVersion: number;
    archivedAt: Date;
  }): Promise<PersistedPracticeAccountRecord | null> {
    const idx = this.accounts.findIndex(
      (a) =>
        a._id.toString() === params.accountId.toString() &&
        a.userId.toString() === params.userId.toString() &&
        a.status === "ACTIVE" &&
        a.version === params.expectedVersion
    );
    if (idx === -1) {
      return null;
    }

    const updated: PersistedPracticeAccountRecord = {
      ...this.accounts[idx],
      status: "ARCHIVED",
      archivedAt: params.archivedAt,
      version: this.accounts[idx].version + 1,
      updatedAt: params.archivedAt,
    };

    // Validate against PracticeAccountModel offline
    const doc = new PracticeAccountModel(updated);
    await doc.validate();

    this.accounts[idx] = updated;
    return { ...updated };
  }

  public async createActiveAccount(
    input: CreatePracticeAccountInput
  ): Promise<PersistedPracticeAccountRecord> {
    // Enforce partial unique index (at most 1 ACTIVE account per user)
    const existingActive = this.accounts.find(
      (a) =>
        a.userId.toString() === input.userId.toString() &&
        a.status === "ACTIVE"
    );
    if (existingActive) {
      const dupErr = new Error("E11000 duplicate key error") as any;
      dupErr.code = 11000;
      throw dupErr;
    }

    const doc = new PracticeAccountModel({
      userId: input.userId,
      accountNumber: input.accountNumber,
      status: input.status,
      initialBalancePaise: input.initialBalancePaise,
      cashBalancePaise: input.cashBalancePaise,
      version: input.version,
    });
    await doc.validate();

    const now = new Date("2026-11-10T12:00:00.000Z");
    const created: PersistedPracticeAccountRecord = {
      _id: doc._id,
      userId: doc.userId,
      accountNumber: doc.accountNumber,
      status: doc.status,
      initialBalancePaise: doc.initialBalancePaise,
      cashBalancePaise: doc.cashBalancePaise,
      version: doc.version,
      createdAt: now,
      updatedAt: now,
    };
    this.accounts.push(created);
    return { ...created };
  }

  public async createInitialFundingLedgerEntry(
    input: CreateInitialFundingLedgerInput
  ): Promise<PersistedLedgerEntryRecord> {
    if (this.failOnCreateLedger) {
      throw new Error("Simulated database failure while writing ledger entry");
    }

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
    await doc.validate();

    const created: PersistedLedgerEntryRecord = {
      _id: doc._id,
      userId: doc.userId,
      practiceAccountId: doc.practiceAccountId,
      entryType: doc.entryType,
      direction: doc.direction,
      amountPaise: doc.amountPaise,
      balanceBeforePaise: doc.balanceBeforePaise,
      balanceAfterPaise: doc.balanceAfterPaise,
      referenceType: doc.referenceType,
      referenceId: doc.referenceId,
      idempotencyKey: doc.idempotencyKey,
      description: doc.description,
      createdAt: new Date("2026-11-10T12:00:00.000Z"),
    };
    this.ledgerEntries.push(created);
    return { ...created };
  }
}

describe("Task 18A — Practice Account Service", () => {
  const userA = new Types.ObjectId("65f000000000000000000001");
  const userB = new Types.ObjectId("65f000000000000000000002");
  const baseDate = new Date("2026-11-01T09:00:00.000Z");

  function makeActiveAccount(
    userId: Types.ObjectId = userA,
    overrides: Partial<PersistedPracticeAccountRecord> = {}
  ): PersistedPracticeAccountRecord {
    return {
      _id: new Types.ObjectId(),
      userId,
      accountNumber: 1,
      status: "ACTIVE",
      initialBalancePaise: INITIAL_VIRTUAL_BALANCE_PAISE,
      cashBalancePaise: 75_500_000,
      version: 3,
      createdAt: baseDate,
      updatedAt: baseDate,
      ...overrides,
    };
  }

  it("retrieves the active practice account and balance view for a user", async () => {
    const active = makeActiveAccount(userA);
    const store = new InMemoryTransactionalAccountStore([active]);
    const service = new PracticeAccountService({
      repository: store,
      runInTransaction: store.createTransactionRunner(),
    });

    const summary = await service.getActiveAccountForUser(userA);
    assert.equal(summary.accountId.toString(), active._id.toString());
    assert.equal(summary.userId.toString(), userA.toString());
    assert.equal(summary.accountNumber, 1);
    assert.equal(summary.status, "ACTIVE");
    assert.equal(summary.cashBalancePaise, 75_500_000);

    const balanceView = await service.getAccountBalanceForUser(userA);
    assert.equal(balanceView.cashBalancePaise, 75_500_000);
    assert.equal(
      balanceView.initialBalancePaise,
      INITIAL_VIRTUAL_BALANCE_PAISE
    );
  });

  it("throws ACTIVE_ACCOUNT_NOT_FOUND or ACCOUNT_NOT_FOUND when missing", async () => {
    const store = new InMemoryTransactionalAccountStore([]);
    const service = new PracticeAccountService({
      repository: store,
      runInTransaction: store.createTransactionRunner(),
    });

    await assert.rejects(
      () => service.getActiveAccountForUser(userA),
      (err: unknown) =>
        err instanceof PracticeAccountError &&
        err.code === "ACTIVE_ACCOUNT_NOT_FOUND"
    );

    await assert.rejects(
      () => service.getAccountByIdForUser(new Types.ObjectId(), userA),
      (err: unknown) =>
        err instanceof PracticeAccountError && err.code === "ACCOUNT_NOT_FOUND"
    );
  });

  it("enforces account ownership and rejects cross-user access with ACCOUNT_OWNERSHIP_VIOLATION", async () => {
    const userAAccount = makeActiveAccount(userA);
    const store = new InMemoryTransactionalAccountStore([userAAccount]);
    const service = new PracticeAccountService({
      repository: store,
      runInTransaction: store.createTransactionRunner(),
    });

    // User B attempting to access User A's account
    await assert.rejects(
      () => service.getAccountByIdForUser(userAAccount._id, userB),
      (err: unknown) =>
        err instanceof PracticeAccountError &&
        err.code === "ACCOUNT_OWNERSHIP_VIOLATION"
    );

    await assert.rejects(
      () => service.getAccountBalanceForUser(userB, userAAccount._id),
      (err: unknown) =>
        err instanceof PracticeAccountError &&
        err.code === "ACCOUNT_OWNERSHIP_VIOLATION"
    );
  });

  it("rejects archived accounts when an active account is required", async () => {
    const archivedAccount = makeActiveAccount(userA, {
      status: "ARCHIVED",
      archivedAt: new Date("2026-11-05T10:00:00.000Z"),
    });
    const store = new InMemoryTransactionalAccountStore([archivedAccount]);
    const service = new PracticeAccountService({
      repository: store,
      runInTransaction: store.createTransactionRunner(),
    });

    // Historical lookup without requireActive succeeds for owner
    const historical = await service.getAccountByIdForUser(
      archivedAccount._id,
      userA
    );
    assert.equal(historical.status, "ARCHIVED");

    // Requiring active throws ACCOUNT_ARCHIVED
    await assert.rejects(
      () =>
        service.getAccountByIdForUser(archivedAccount._id, userA, {
          requireActive: true,
        }),
      (err: unknown) =>
        err instanceof PracticeAccountError && err.code === "ACCOUNT_ARCHIVED"
    );

    await assert.rejects(
      () => service.getAccountBalanceForUser(userA, archivedAccount._id),
      (err: unknown) =>
        err instanceof PracticeAccountError && err.code === "ACCOUNT_ARCHIVED"
    );
  });

  it("resets the practice account atomically: archives old account, creates new 100000000 paise account, writes INITIAL_FUNDING ledger entry, and preserves watchlists", async () => {
    const originalActive = makeActiveAccount(userA, {
      accountNumber: 1,
      cashBalancePaise: 42_000_000,
      version: 5,
    });
    const store = new InMemoryTransactionalAccountStore([originalActive]);

    // Seed a user watchlist item to verify it remains untouched across account reset
    const watchlistDoc = new WatchlistItemModel({
      userId: userA,
      instrumentId: new Types.ObjectId(),
      symbolSnapshot: "RELIANCE",
      sortOrder: 0,
    });
    await watchlistDoc.validate();
    store.watchlistItems.push({
      _id: watchlistDoc._id,
      userId: watchlistDoc.userId,
      instrumentId: watchlistDoc.instrumentId,
      symbolSnapshot: watchlistDoc.symbolSnapshot,
      sortOrder: watchlistDoc.sortOrder,
    });

    const resetTime = new Date("2026-11-10T12:00:00.000Z");
    const service = new PracticeAccountService({
      repository: store,
      runInTransaction: store.createTransactionRunner(),
      nowProvider: () => resetTime,
    });

    const result = await service.resetPracticeAccount(userA);

    // 1. Previous account archived and preserved
    assert.ok(result.archivedAccount);
    assert.equal(
      result.archivedAccount.accountId.toString(),
      originalActive._id.toString()
    );
    assert.equal(result.archivedAccount.status, "ARCHIVED");
    assert.equal(result.archivedAccount.accountNumber, 1);
    assert.equal(result.archivedAccount.cashBalancePaise, 42_000_000);
    assert.equal(result.archivedAccount.version, 6);
    assert.equal(
      result.archivedAccount.archivedAt?.getTime(),
      resetTime.getTime()
    );

    // 2. New ACTIVE account created with accountNumber = 2 and 100,000,000 paise
    assert.equal(result.activeAccount.accountNumber, 2);
    assert.equal(result.activeAccount.status, "ACTIVE");
    assert.equal(
      result.activeAccount.initialBalancePaise,
      INITIAL_VIRTUAL_BALANCE_PAISE
    );
    assert.equal(
      result.activeAccount.cashBalancePaise,
      INITIAL_VIRTUAL_BALANCE_PAISE
    );
    assert.equal(result.activeAccount.cashBalancePaise, 100_000_000);

    // 3. Reconciled INITIAL_FUNDING ledger entry created
    const ledger = result.initialFundingLedgerEntry;
    assert.equal(
      ledger.practiceAccountId.toString(),
      result.activeAccount.accountId.toString()
    );
    assert.equal(ledger.entryType, "INITIAL_FUNDING");
    assert.equal(ledger.direction, "CREDIT");
    assert.equal(ledger.amountPaise, 100_000_000);
    assert.equal(ledger.balanceBeforePaise, 0);
    assert.equal(ledger.balanceAfterPaise, 100_000_000);
    assert.equal(ledger.referenceType, "PRACTICE_ACCOUNT");
    assert.equal(
      ledger.referenceId.toString(),
      result.activeAccount.accountId.toString()
    );

    // 4. Only 1 ACTIVE account exists in store; old archived account also remains in store
    assert.equal(store.accounts.length, 2);
    const activeAccounts = store.accounts.filter((a) => a.status === "ACTIVE");
    assert.equal(activeAccounts.length, 1);

    // 5. Watchlist items remain completely preserved
    assert.equal(store.watchlistItems.length, 1);
    assert.equal(store.watchlistItems[0].symbolSnapshot, "RELIANCE");
  });

  it("rolls back the entire reset transaction if creating the initial funding ledger entry fails", async () => {
    const originalActive = makeActiveAccount(userA, {
      accountNumber: 1,
      cashBalancePaise: 64_000_000,
      version: 2,
    });
    const store = new InMemoryTransactionalAccountStore([originalActive]);
    store.failOnCreateLedger = true;

    const service = new PracticeAccountService({
      repository: store,
      runInTransaction: store.createTransactionRunner(),
    });

    await assert.rejects(
      () => service.resetPracticeAccount(userA),
      (err: unknown) =>
        err instanceof PracticeAccountError &&
        err.code === "ACCOUNT_RESET_FAILED"
    );

    // Verify atomic rollback: original account is still ACTIVE at version 2, no new account or ledger entry exists
    assert.equal(store.accounts.length, 1);
    assert.equal(store.accounts[0].status, "ACTIVE");
    assert.equal(store.accounts[0].version, 2);
    assert.equal(store.accounts[0].cashBalancePaise, 64_000_000);
    assert.equal(store.ledgerEntries.length, 0);
  });
});
