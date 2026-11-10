import { Request, Response, NextFunction } from "express";
import { FilterQuery, Types } from "mongoose";
import { InstrumentModel } from "./instrument.model";
import { InstrumentQuoteService } from "./instrument-quote.service";
import { InstrumentQuoteError } from "./instrument-quote.types";
import { IInstrument, INSTRUMENT_EXCHANGES, InstrumentExchange } from "./instrument.types";

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface InstrumentControllerDependencies {
  quoteService?: InstrumentQuoteService;
}

export class InstrumentController {
  private readonly quoteService: InstrumentQuoteService;

  constructor(dependencies: InstrumentControllerDependencies = {}) {
    this.quoteService =
      dependencies.quoteService ?? new InstrumentQuoteService();
  }

  /**
   * GET /api/v1/instruments
   * Search and filter instruments with deterministic pagination.
   */
  public searchInstruments = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const searchRaw = req.query.search ?? req.query.q;
      const search =
        typeof searchRaw === "string" ? searchRaw.trim() : undefined;

      const exchangeRaw = req.query.exchange;
      const exchange =
        typeof exchangeRaw === "string"
          ? (exchangeRaw.trim().toUpperCase() as InstrumentExchange)
          : undefined;

      const isTradableRaw = req.query.isTradable;

      const pageRaw = req.query.page;
      const parsedPage =
        typeof pageRaw === "string" ? parseInt(pageRaw, 10) : 1;
      const page = Number.isSafeInteger(parsedPage) && parsedPage >= 1 ? parsedPage : 1;

      const limitRaw = req.query.limit;
      const parsedLimit =
        typeof limitRaw === "string" ? parseInt(limitRaw, 10) : 20;
      const limit =
        Number.isSafeInteger(parsedLimit) && parsedLimit >= 1
          ? Math.min(100, parsedLimit)
          : 20;

      const filter: FilterQuery<IInstrument> = {};

      if (search && search.length > 0) {
        const escaped = escapeRegex(search);
        const regex = new RegExp(escaped, "i");
        filter.$or = [{ symbol: regex }, { name: regex }];
      }

      if (exchange && (INSTRUMENT_EXCHANGES as readonly string[]).includes(exchange)) {
        filter.exchange = exchange;
      }

      if (isTradableRaw !== undefined) {
        filter.isTradable =
          isTradableRaw === "true" || isTradableRaw === "1";
      }

      const skip = (page - 1) * limit;

      const [items, total] = await Promise.all([
        InstrumentModel.find(filter)
          .sort({ symbol: 1, _id: 1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        InstrumentModel.countDocuments(filter),
      ]);

      const totalPages = Math.ceil(total / limit) || 1;

      res.status(200).json({
        success: true,
        data: {
          items,
          pagination: {
            page,
            limit,
            total,
            totalPages,
          },
        },
      });
    } catch (err: unknown) {
      next(err);
    }
  };

  /**
   * GET /api/v1/instruments/:instrumentId
   * Retrieves instrument details by ObjectId.
   */
  public getInstrumentById = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { instrumentId } = req.params;

      if (
        !instrumentId ||
        !Types.ObjectId.isValid(instrumentId) ||
        new Types.ObjectId(instrumentId).toString() !== instrumentId.trim()
      ) {
        res.status(400).json({
          success: false,
          error: {
            code: "INVALID_INSTRUMENT_ID",
            message: "instrumentId must be a valid MongoDB ObjectId.",
          },
        });
        return;
      }

      const instrument = await InstrumentModel.findById(
        new Types.ObjectId(instrumentId.trim())
      ).lean();

      if (!instrument) {
        res.status(404).json({
          success: false,
          error: {
            code: "INSTRUMENT_NOT_FOUND",
            message: `Instrument ${instrumentId} was not found.`,
          },
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: { instrument },
      });
    } catch (err: unknown) {
      next(err);
    }
  };

  /**
   * GET /api/v1/instruments/:instrumentId/quote
   * Retrieves quote snapshot for instrument.
   */
  public getInstrumentQuote = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { instrumentId } = req.params;

      if (
        !instrumentId ||
        !Types.ObjectId.isValid(instrumentId) ||
        new Types.ObjectId(instrumentId).toString() !== instrumentId.trim()
      ) {
        res.status(400).json({
          success: false,
          error: {
            code: "INVALID_INSTRUMENT_ID",
            message: "instrumentId must be a valid MongoDB ObjectId.",
          },
        });
        return;
      }

      const quote = await this.quoteService.getQuoteByInstrumentId(
        new Types.ObjectId(instrumentId.trim()),
        { requireFresh: false, requireTradable: false }
      );

      res.status(200).json({
        success: true,
        data: { quote },
      });
    } catch (err: unknown) {
      if (err instanceof InstrumentQuoteError) {
        const statusCode = err.code === "INSTRUMENT_NOT_FOUND" ? 404 : 400;
        res.status(statusCode).json({
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
