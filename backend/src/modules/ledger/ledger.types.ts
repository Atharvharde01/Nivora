import { HydratedDocument, Model, Types } from "mongoose";

export const LEDGER_ENTRY_TYPES = [
  "INITIAL_FUNDING",
  "BUY_EXECUTION",
  "SELL_EXECUTION",
  "TRADE_REVERSAL",
  "ADJUSTMENT",
] as const;

export type LedgerEntryType = (typeof LEDGER_ENTRY_TYPES)[number];

export const LEDGER_DIRECTIONS = ["CREDIT", "DEBIT"] as const;

export type LedgerDirection = (typeof LEDGER_DIRECTIONS)[number];

export const LEDGER_REFERENCE_TYPES = [
  "PRACTICE_ACCOUNT",
  "TRADE",
  "ADJUSTMENT",
] as const;

export type LedgerReferenceType = (typeof LEDGER_REFERENCE_TYPES)[number];

export interface ILedgerEntry {
  userId: Types.ObjectId;
  practiceAccountId: Types.ObjectId;
  entryType: LedgerEntryType;
  direction: LedgerDirection;
  amountPaise: number;
  balanceBeforePaise: number;
  balanceAfterPaise: number;
  referenceType: LedgerReferenceType;
  referenceId: Types.ObjectId;
  idempotencyKey: string;
  description?: string;
  createdAt: Date;
}

export type LedgerEntryDocument = HydratedDocument<ILedgerEntry>;

export type LedgerEntryModelType = Model<ILedgerEntry>;
