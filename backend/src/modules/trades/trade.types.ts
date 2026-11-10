import { HydratedDocument, Model, Types } from "mongoose";
import {
  INSTRUMENT_EXCHANGES,
  InstrumentExchange,
} from "../instruments/instrument.types";
import { ORDER_SIDES, OrderSide } from "../orders/order.types";

export { INSTRUMENT_EXCHANGES, ORDER_SIDES };
export type { InstrumentExchange, OrderSide };

export const TRADE_SIDES = ORDER_SIDES;

export type TradeSide = OrderSide;

export interface ITradeQuoteSnapshot {
  lastPricePaise: number;
  bidPricePaise: number;
  askPricePaise: number;
  priceUpdatedAt: Date;
}

export interface ITrade {
  orderId: Types.ObjectId;
  userId: Types.ObjectId;
  practiceAccountId: Types.ObjectId;
  instrumentId: Types.ObjectId;
  symbol: string;
  exchange: InstrumentExchange;
  side: TradeSide;
  quantity: number;
  executionPricePaise: number;
  totalValuePaise: number;
  costBasisSoldPaise: number;
  realizedPnlPaise: number;
  quoteSnapshot: ITradeQuoteSnapshot;
  idempotencyKey: string;
  executedAt: Date;
  createdAt: Date;
}

export type TradeDocument = HydratedDocument<ITrade>;

export type TradeModelType = Model<ITrade>;