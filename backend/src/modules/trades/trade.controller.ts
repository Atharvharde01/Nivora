import { Request, Response, NextFunction } from "express";
import { FilterQuery, Types } from "mongoose";
import { TradeModel } from "./trade.model";
import { ITrade, TRADE_SIDES, TradeSide } from "./trade.types";

export class TradeController {
  /**
   * GET /api/v1/trades
   * Retrieves paginated execution history strictly scoped to the authenticated user.
   */
  public listTrades = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const userId = req.user?._id;
      if (!userId) {
        res.status(401).json({
          success: false,
          error: {
            code: "UNAUTHORIZED",
            message: "Authentication required.",
          },
        });
        return;
      }

      const {
        practiceAccountId,
        instrumentId,
        side,
        from,
        to,
        page: rawPage,
        limit: rawLimit,
      } = req.query;

      const filter: FilterQuery<ITrade> = { userId };

      if (practiceAccountId && typeof practiceAccountId === "string") {
        if (!Types.ObjectId.isValid(practiceAccountId)) {
          res.status(400).json({
            success: false,
            error: {
              code: "INVALID_ACCOUNT_ID",
              message: "practiceAccountId must be a valid MongoDB ObjectId.",
            },
          });
          return;
        }
        filter.practiceAccountId = new Types.ObjectId(practiceAccountId);
      }

      if (instrumentId && typeof instrumentId === "string") {
        if (!Types.ObjectId.isValid(instrumentId)) {
          res.status(400).json({
            success: false,
            error: {
              code: "INVALID_INSTRUMENT_ID",
              message: "instrumentId must be a valid MongoDB ObjectId.",
            },
          });
          return;
        }
        filter.instrumentId = new Types.ObjectId(instrumentId);
      }

      if (
        side &&
        typeof side === "string" &&
        (TRADE_SIDES as readonly string[]).includes(side)
      ) {
        filter.side = side as TradeSide;
      }

      if (from || to) {
        const dateFilter: { $gte?: Date; $lte?: Date } = {};
        if (from && typeof from === "string") {
          const fromDate = new Date(from);
          if (!Number.isNaN(fromDate.getTime())) {
            dateFilter.$gte = fromDate;
          }
        }
        if (to && typeof to === "string") {
          const toDate = new Date(to);
          if (!Number.isNaN(toDate.getTime())) {
            dateFilter.$lte = toDate;
          }
        }
        if (Object.keys(dateFilter).length > 0) {
          filter.executedAt = dateFilter;
        }
      }

      const parsedPage =
        typeof rawPage === "string" ? parseInt(rawPage, 10) : 1;
      const page =
        Number.isSafeInteger(parsedPage) && parsedPage >= 1 ? parsedPage : 1;

      const parsedLimit =
        typeof rawLimit === "string" ? parseInt(rawLimit, 10) : 20;
      const limit =
        Number.isSafeInteger(parsedLimit) && parsedLimit >= 1
          ? Math.min(100, parsedLimit)
          : 20;

      const skip = (page - 1) * limit;

      const [items, total] = await Promise.all([
        TradeModel.find(filter)
          .sort({ executedAt: -1, _id: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        TradeModel.countDocuments(filter),
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
   * GET /api/v1/trades/:tradeId
   * Retrieves specific trade execution details with strict user ownership enforcement.
   */
  public getTradeById = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const userId = req.user?._id;
      if (!userId) {
        res.status(401).json({
          success: false,
          error: {
            code: "UNAUTHORIZED",
            message: "Authentication required.",
          },
        });
        return;
      }

      const { tradeId } = req.params;
      if (
        !tradeId ||
        !Types.ObjectId.isValid(tradeId) ||
        new Types.ObjectId(tradeId).toString() !== tradeId.trim()
      ) {
        res.status(400).json({
          success: false,
          error: {
            code: "INVALID_TRADE_ID",
            message: "tradeId must be a valid MongoDB ObjectId.",
          },
        });
        return;
      }

      const trade = await TradeModel.findOne({
        _id: new Types.ObjectId(tradeId.trim()),
        userId,
      }).lean();

      if (!trade) {
        res.status(404).json({
          success: false,
          error: {
            code: "TRADE_NOT_FOUND",
            message: `Trade ${tradeId} was not found.`,
          },
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: { trade },
      });
    } catch (err: unknown) {
      next(err);
    }
  };
}
