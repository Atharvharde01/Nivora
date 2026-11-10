export const PAISE_PER_RUPEE = 100;
export const INITIAL_VIRTUAL_BALANCE_RUPEES = 1_000_000;
export const INITIAL_VIRTUAL_BALANCE_PAISE = 100_000_000;

export const FINANCIAL_ERROR_CODES = [
  "INVALID_PAISE_VALUE",
  "INVALID_QUANTITY",
  "ARITHMETIC_OVERFLOW",
  "INSUFFICIENT_FUNDS",
  "INSUFFICIENT_HOLDING_QUANTITY",
  "INVALID_COST_BASIS",
  "INVALID_HOLDING_STATE",
] as const;

export type FinancialErrorCode = (typeof FINANCIAL_ERROR_CODES)[number];

export class FinancialCalculationError extends Error {
  public readonly code: FinancialErrorCode;

  constructor(code: FinancialErrorCode, message: string) {
    super(message);
    this.name = "FinancialCalculationError";
    this.code = code;
    Object.setPrototypeOf(this, FinancialCalculationError.prototype);
  }
}

export interface SellCostBasisAllocationInput {
  currentQuantity: number;
  currentTotalInvestedPaise: number;
  sellQuantity: number;
}

export interface SellCostBasisAllocationResult {
  costBasisSoldPaise: number;
  remainingQuantity: number;
  remainingTotalInvestedPaise: number;
  remainingAverageBuyPricePaise: number;
}

export interface HoldingBuyTransitionInput {
  currentQuantity: number;
  currentTotalInvestedPaise: number;
  currentRealizedPnlPaise?: number;
  currentVersion?: number;
  buyQuantity: number;
  askPricePaise: number;
}

export interface HoldingBuyTransitionResult {
  executionPricePaise: number;
  totalValuePaise: number;
  costBasisSoldPaise: 0;
  tradeRealizedPnlPaise: 0;
  newQuantity: number;
  newTotalInvestedPaise: number;
  newAverageBuyPricePaise: number;
  newRealizedPnlPaise: number;
  newVersion: number;
}

export interface HoldingSellTransitionInput {
  currentQuantity: number;
  currentTotalInvestedPaise: number;
  currentRealizedPnlPaise?: number;
  currentVersion?: number;
  sellQuantity: number;
  bidPricePaise: number;
}

export interface HoldingSellTransitionResult {
  executionPricePaise: number;
  totalValuePaise: number;
  costBasisSoldPaise: number;
  tradeRealizedPnlPaise: number;
  newQuantity: number;
  newTotalInvestedPaise: number;
  newAverageBuyPricePaise: number;
  newRealizedPnlPaise: number;
  newVersion: number;
}
