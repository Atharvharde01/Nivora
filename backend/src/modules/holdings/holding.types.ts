import { HydratedDocument, Model, Types } from "mongoose";
import {
  INSTRUMENT_EXCHANGES,
  InstrumentExchange,
} from "../instruments/instrument.types";

export { INSTRUMENT_EXCHANGES };
export type { InstrumentExchange };

export interface IHolding {
  userId: Types.ObjectId;
  practiceAccountId: Types.ObjectId;
  instrumentId: Types.ObjectId;
  symbol: string;
  exchange: InstrumentExchange;
  quantity: number;
  averageBuyPricePaise: number;
  totalInvestedPaise: number;
  realizedPnlPaise: number;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export type HoldingDocument = HydratedDocument<IHolding>;

export type HoldingModelType = Model<IHolding>;
