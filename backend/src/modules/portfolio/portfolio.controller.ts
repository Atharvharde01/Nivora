import { Request, Response, NextFunction } from "express";
import { Types } from "mongoose";
import { PortfolioService } from "./portfolio.service";
import { PracticeAccountError } from "../practice-accounts/account.service.types";

export interface PortfolioControllerDependencies {
  portfolioService?: PortfolioService;
}

export class PortfolioController {
  private readonly portfolioService: PortfolioService;

  constructor(dependencies: PortfolioControllerDependencies = {}) {
    this.portfolioService =
      dependencies.portfolioService ?? new PortfolioService();
  }

  /**
   * GET /api/v1/portfolio
   * Retrieves portfolio valuation summary and all active positions for the user.
   */
  public getPortfolio = async (
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

      const { practiceAccountId } = req.query;
      let accountIdOption: Types.ObjectId | undefined;

      if (practiceAccountId !== undefined) {
        if (
          typeof practiceAccountId !== "string" ||
          !Types.ObjectId.isValid(practiceAccountId) ||
          new Types.ObjectId(practiceAccountId).toString() !== practiceAccountId.trim()
        ) {
          res.status(400).json({
            success: false,
            error: {
              code: "INVALID_ACCOUNT_ID",
              message: "practiceAccountId must be a valid MongoDB ObjectId.",
            },
          });
          return;
        }
        accountIdOption = new Types.ObjectId(practiceAccountId.trim());
      }

      const portfolio = await this.portfolioService.getPortfolioForUser(
        userId,
        { practiceAccountId: accountIdOption }
      );

      res.status(200).json({
        success: true,
        data: {
          practiceAccountId: portfolio.summary.practiceAccountId.toString(),
          summary: portfolio.summary,
          positions: portfolio.positions,
          activePositionsCount: portfolio.summary.activePositionsCount,
        },
      });
    } catch (err: unknown) {
      if (err instanceof PracticeAccountError) {
        const statusCode =
          err.code === "ACCOUNT_NOT_FOUND" ||
          err.code === "ACTIVE_ACCOUNT_NOT_FOUND"
            ? 404
            : err.code === "ACCOUNT_OWNERSHIP_VIOLATION"
            ? 403
            : 400;
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

  /**
   * GET /api/v1/portfolio/positions/:instrumentId
   * Retrieves specific active portfolio position for the user.
   */
  public getPositionByInstrumentId = async (
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

      const { practiceAccountId } = req.query;
      let accountIdOption: Types.ObjectId | undefined;
      if (practiceAccountId !== undefined) {
        if (
          typeof practiceAccountId !== "string" ||
          !Types.ObjectId.isValid(practiceAccountId)
        ) {
          res.status(400).json({
            success: false,
            error: {
              code: "INVALID_ACCOUNT_ID",
              message: "practiceAccountId must be a valid MongoDB ObjectId.",
            },
          });
          return;
        }
        accountIdOption = new Types.ObjectId(practiceAccountId);
      }

      const portfolio = await this.portfolioService.getPortfolioForUser(
        userId,
        { practiceAccountId: accountIdOption }
      );

      const targetIdStr = instrumentId.trim();
      const position = portfolio.positions.find(
        (pos) => pos.instrumentId.toString() === targetIdStr
      );

      if (!position) {
        res.status(404).json({
          success: false,
          error: {
            code: "POSITION_NOT_FOUND",
            message: `No active position found for instrument ${targetIdStr}.`,
          },
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: { position },
      });
    } catch (err: unknown) {
      if (err instanceof PracticeAccountError) {
        const statusCode =
          err.code === "ACCOUNT_NOT_FOUND" ||
          err.code === "ACTIVE_ACCOUNT_NOT_FOUND"
            ? 404
            : err.code === "ACCOUNT_OWNERSHIP_VIOLATION"
            ? 403
            : 400;
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
