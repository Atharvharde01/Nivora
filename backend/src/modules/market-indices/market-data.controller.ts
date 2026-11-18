import { NextFunction, Request, Response } from "express";
import { CandleInterval } from "../market-candles/market-candle.types";
import { parseMarketQueryDate } from "../market-candles/market-candle.utils";
import {
  CandleQueryOptions,
  MarketDataService,
  MarketDataServiceError,
} from "./market-data.service";

export interface MarketDataControllerDependencies {
  readonly marketDataService?: MarketDataService;
}

function parseCandleQueryFromRequest(req: Request): CandleQueryOptions {
  const intervalRaw = req.query.interval;
  const interval =
    typeof intervalRaw === "string" && intervalRaw.trim().length > 0
      ? (intervalRaw.trim() as CandleInterval)
      : undefined;

  const fromRaw = req.query.from;
  let from: Date | undefined;
  if (fromRaw instanceof Date) {
    from = fromRaw;
  } else if (typeof fromRaw === "string" && fromRaw.trim().length > 0) {
    from = parseMarketQueryDate(fromRaw, "start") ?? new Date("invalid");
  }

  const toRaw = req.query.to;
  let to: Date | undefined;
  if (toRaw instanceof Date) {
    to = toRaw;
  } else if (typeof toRaw === "string" && toRaw.trim().length > 0) {
    to = parseMarketQueryDate(toRaw, "end") ?? new Date("invalid");
  }

  const limitRaw = req.query.limit;
  const limit =
    typeof limitRaw === "number"
      ? limitRaw
      : typeof limitRaw === "string" && limitRaw.trim().length > 0
      ? Number(limitRaw.trim())
      : undefined;

  return { interval, from, to, limit };
}

export class MarketDataController {
  private readonly marketDataService: MarketDataService;

  constructor(dependencies: MarketDataControllerDependencies = {}) {
    this.marketDataService =
      dependencies.marketDataService ?? new MarketDataService();
  }

  /**
   * GET /api/v1/market/indices
   * Lists all synthetic market indices ("NIFTY50", "SENSEX").
   */
  public listIndices = async (
    _req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const indices = await this.marketDataService.listMarketIndices();

      res.status(200).json({
        success: true,
        data: {
          items: indices,
        },
      });
    } catch (err: unknown) {
      next(err);
    }
  };

  /**
   * GET /api/v1/market/indices/:symbol
   * Retrieves a single synthetic market index with constituent breakdown.
   */
  public getIndexBySymbol = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { symbol } = req.params;
      const index = await this.marketDataService.getMarketIndexBySymbol(
        symbol ?? ""
      );

      res.status(200).json({
        success: true,
        data: {
          index,
        },
      });
    } catch (err: unknown) {
      if (err instanceof MarketDataServiceError) {
        res.status(err.statusCode).json({
          success: false,
          error: {
            code: err.code,
            message: err.message,
          },
        });
        return;
      }
      next(err);
    }
  };

  /**
   * GET /api/v1/market/indices/:symbol/candles
   * Retrieves historical OHLC candles for a synthetic market index.
   */
  public getIndexCandles = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { symbol } = req.params;
      const queryOptions = parseCandleQueryFromRequest(req);

      const result = await this.marketDataService.getMarketIndexCandles(
        symbol ?? "",
        queryOptions
      );

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err: unknown) {
      if (err instanceof MarketDataServiceError) {
        res.status(err.statusCode).json({
          success: false,
          error: {
            code: err.code,
            message: err.message,
          },
        });
        return;
      }
      next(err);
    }
  };

  /**
   * GET /api/v1/market/instruments/:instrumentId/candles
   * Retrieves historical OHLC candles for a tradable equity instrument.
   */
  public getInstrumentCandles = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { instrumentId } = req.params;
      const queryOptions = parseCandleQueryFromRequest(req);

      const result = await this.marketDataService.getInstrumentCandles(
        instrumentId ?? "",
        queryOptions
      );

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err: unknown) {
      if (err instanceof MarketDataServiceError) {
        res.status(err.statusCode).json({
          success: false,
          error: {
            code: err.code,
            message: err.message,
          },
        });
        return;
      }
      next(err);
    }
  };
}
