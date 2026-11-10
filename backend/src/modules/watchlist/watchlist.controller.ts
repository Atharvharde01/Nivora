import { Request, Response, NextFunction } from "express";
import { Types } from "mongoose";
import { WatchlistError } from "./watchlist.types";
import { WatchlistService } from "./watchlist.service";

export interface WatchlistControllerDependencies {
  watchlistService: WatchlistService;
}

export class WatchlistController {
  private readonly watchlistService: WatchlistService;

  constructor(dependencies: WatchlistControllerDependencies) {
    this.watchlistService = dependencies.watchlistService;
  }

  /**
   * GET /api/v1/watchlist
   * Retrieves authenticated user's watchlist items with live quotes.
   */
  public getWatchlist = async (
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

      const items = await this.watchlistService.getUserWatchlist(userId);

      res.status(200).json({
        success: true,
        data: {
          items,
          count: items.length,
        },
      });
    } catch (err: unknown) {
      if (err instanceof WatchlistError) {
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
   * POST /api/v1/watchlist/items
   * Adds an instrument to authenticated user's watchlist.
   */
  public addItem = async (
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

      const { instrumentId } = req.body ?? {};
      if (
        !instrumentId ||
        typeof instrumentId !== "string" ||
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

      const item = await this.watchlistService.addWatchlistItem(
        userId,
        instrumentId.trim()
      );

      res.status(201).json({
        success: true,
        data: { item },
      });
    } catch (err: unknown) {
      if (err instanceof WatchlistError) {
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
   * DELETE /api/v1/watchlist/items/:instrumentId
   * Removes an instrument from authenticated user's watchlist.
   */
  public removeItem = async (
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

      const result = await this.watchlistService.removeWatchlistItem(
        userId,
        instrumentId.trim()
      );

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err: unknown) {
      if (err instanceof WatchlistError) {
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
   * PATCH /api/v1/watchlist/reorder
   * Reorders items in authenticated user's watchlist.
   */
  public reorderWatchlist = async (
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

      const { instrumentIds } = req.body ?? {};
      const items = await this.watchlistService.reorderWatchlist(
        userId,
        instrumentIds
      );

      res.status(200).json({
        success: true,
        data: {
          items,
          count: items.length,
        },
      });
    } catch (err: unknown) {
      if (err instanceof WatchlistError) {
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
