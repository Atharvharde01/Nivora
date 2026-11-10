import { HydratedDocument, Model } from "mongoose";

export const INSTRUMENT_EXCHANGES = ["NSE", "BSE"] as const;

export type InstrumentExchange = (typeof INSTRUMENT_EXCHANGES)[number];

export interface IInstrument {
  symbol: string;
  name: string;
  exchange: InstrumentExchange;
  isTradable: boolean;
  lastPricePaise: number;
  bidPricePaise: number;
  askPricePaise: number;
  previousClosePaise: number;
  isStarterWatchlist: boolean;
  priceUpdatedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type InstrumentDocument = HydratedDocument<IInstrument>;

export type InstrumentModelType = Model<IInstrument>;
