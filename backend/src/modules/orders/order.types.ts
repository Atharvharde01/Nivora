import { HydratedDocument, Model, Types } from "mongoose";
import {
  INSTRUMENT_EXCHANGES,
  InstrumentExchange,
} from "../instruments/instrument.types";

export { INSTRUMENT_EXCHANGES };
export type { InstrumentExchange };

export const ORDER_SIDES = ["BUY", "SELL"] as const;

export type OrderSide = (typeof ORDER_SIDES)[number];

export const ORDER_TYPES = ["MARKET"] as const;

export type OrderType = (typeof ORDER_TYPES)[number];

export const ORDER_STATUSES = ["RECEIVED", "EXECUTED", "REJECTED"] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_REJECTION_CODES = [
  "INSUFFICIENT_FUNDS",
  "INSUFFICIENT_QUANTITY",
  "INSTRUMENT_UNAVAILABLE",
  "STALE_QUOTE",
  "ACCOUNT_INACTIVE",
  "OVERFLOW_LIMIT_EXCEEDED",
  "VALIDATION_ERROR",
] as const;

export type OrderRejectionCode = (typeof ORDER_REJECTION_CODES)[number];

export interface IOrder {
  userId: Types.ObjectId;
  practiceAccountId: Types.ObjectId;
  instrumentId: Types.ObjectId;
  symbol: string;
  exchange: InstrumentExchange;
  side: OrderSide;
  orderType: OrderType;
  quantity: number;
  status: OrderStatus;
  idempotencyKey: string;
  executedQuantity: number;
  executionPricePaise?: number;
  totalValuePaise?: number;
  rejectionCode?: OrderRejectionCode;
  rejectionReason?: string;
  executedAt?: Date;
  rejectedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type OrderDocument = HydratedDocument<IOrder>;

export type OrderModelType = Model<IOrder>;
