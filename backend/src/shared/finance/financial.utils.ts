import {
  FinancialCalculationError,
  HoldingBuyTransitionInput,
  HoldingBuyTransitionResult,
  HoldingSellTransitionInput,
  HoldingSellTransitionResult,
  INITIAL_VIRTUAL_BALANCE_PAISE,
  INITIAL_VIRTUAL_BALANCE_RUPEES,
  PAISE_PER_RUPEE,
  SellCostBasisAllocationInput,
  SellCostBasisAllocationResult,
} from "./financial.types";

export {
  FinancialCalculationError,
  INITIAL_VIRTUAL_BALANCE_PAISE,
  INITIAL_VIRTUAL_BALANCE_RUPEES,
  PAISE_PER_RUPEE,
};

const MAX_SAFE_INT_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE_INT_BIGINT = BigInt(Number.MIN_SAFE_INTEGER);

/**
 * Validates that a value is a positive safe integer in paise (>= 1 and <= Number.MAX_SAFE_INTEGER).
 */
export function isPositiveSafeIntegerPaise(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

/**
 * Validates that a value is a non-negative safe integer in paise (>= 0 and <= Number.MAX_SAFE_INTEGER).
 */
export function isNonNegativeSafeIntegerPaise(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Validates that a value is a signed safe integer in paise (>= Number.MIN_SAFE_INTEGER and <= Number.MAX_SAFE_INTEGER).
 */
export function isSignedSafeIntegerPaise(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

/**
 * Validates that a value is a positive whole-number share quantity (>= 1 and <= Number.MAX_SAFE_INTEGER).
 */
export function isPositiveWholeShareQuantity(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

/**
 * Validates that a value is a non-negative whole-number share quantity (>= 0 and <= Number.MAX_SAFE_INTEGER).
 */
export function isNonNegativeWholeShareQuantity(
  value: unknown
): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Asserts that `value` is a positive safe integer in paise (>= 1).
 */
export function assertPositiveSafeIntegerPaise(
  value: unknown,
  fieldName = "amountPaise"
): number {
  if (!isPositiveSafeIntegerPaise(value)) {
    throw new FinancialCalculationError(
      "INVALID_PAISE_VALUE",
      `${fieldName} must be a positive safe integer in paise.`
    );
  }
  return value;
}

/**
 * Asserts that `value` is a non-negative safe integer in paise (>= 0).
 */
export function assertNonNegativeSafeIntegerPaise(
  value: unknown,
  fieldName = "amountPaise"
): number {
  if (!isNonNegativeSafeIntegerPaise(value)) {
    throw new FinancialCalculationError(
      "INVALID_PAISE_VALUE",
      `${fieldName} must be a non-negative safe integer in paise.`
    );
  }
  return value;
}

/**
 * Asserts that `value` is a signed safe integer in paise.
 */
export function assertSignedSafeIntegerPaise(
  value: unknown,
  fieldName = "amountPaise"
): number {
  if (!isSignedSafeIntegerPaise(value)) {
    throw new FinancialCalculationError(
      "INVALID_PAISE_VALUE",
      `${fieldName} must be a safe integer in paise.`
    );
  }
  return value === 0 ? 0 : value;
}

/**
 * Asserts that `value` is a positive whole-number share quantity (>= 1).
 */
export function assertPositiveWholeShareQuantity(
  value: unknown,
  fieldName = "quantity"
): number {
  if (!isPositiveWholeShareQuantity(value)) {
    throw new FinancialCalculationError(
      "INVALID_QUANTITY",
      `${fieldName} must be a positive whole-number safe integer.`
    );
  }
  return value;
}

/**
 * Asserts that `value` is a non-negative whole-number share quantity (>= 0).
 */
export function assertNonNegativeWholeShareQuantity(
  value: unknown,
  fieldName = "quantity"
): number {
  if (!isNonNegativeWholeShareQuantity(value)) {
    throw new FinancialCalculationError(
      "INVALID_QUANTITY",
      `${fieldName} must be a non-negative whole-number safe integer.`
    );
  }
  return value;
}

/**
 * Detects whether multiplying two non-negative safe integers would exceed `Number.MAX_SAFE_INTEGER`.
 */
export function willMultiplyOverflow(a: number, b: number): boolean {
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || a < 0 || b < 0) {
    return true;
  }
  if (a === 0 || b === 0) {
    return false;
  }
  return a > Math.floor(Number.MAX_SAFE_INTEGER / b);
}

/**
 * Detects whether adding two signed safe integers would exceed `[Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]`.
 */
export function willAddOverflow(a: number, b: number): boolean {
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b)) {
    return true;
  }
  const sum = BigInt(a) + BigInt(b);
  return sum > MAX_SAFE_INT_BIGINT || sum < MIN_SAFE_INT_BIGINT;
}

/**
 * Detects whether subtracting `subtrahend` from `minuend` would exceed `[Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]`.
 */
export function willSignedSubtractOverflow(
  minuend: number,
  subtrahend: number
): boolean {
  if (!Number.isSafeInteger(minuend) || !Number.isSafeInteger(subtrahend)) {
    return true;
  }
  const diff = BigInt(minuend) - BigInt(subtrahend);
  return diff > MAX_SAFE_INT_BIGINT || diff < MIN_SAFE_INT_BIGINT;
}

/**
 * Safely multiplies a positive whole-number quantity by a positive unit price in paise.
 * Throws `FinancialCalculationError` on invalid inputs or safe-integer overflow.
 */
export function safeMultiplyQuantityAndPricePaise(
  quantity: number,
  pricePaise: number,
  priceFieldName = "pricePaise"
): number {
  assertPositiveWholeShareQuantity(quantity, "quantity");
  assertPositiveSafeIntegerPaise(pricePaise, priceFieldName);

  if (willMultiplyOverflow(quantity, pricePaise)) {
    throw new FinancialCalculationError(
      "ARITHMETIC_OVERFLOW",
      `Multiplication of quantity (${quantity}) and ${priceFieldName} (${pricePaise}) exceeds Number.MAX_SAFE_INTEGER.`
    );
  }

  return quantity * pricePaise;
}

/**
 * Safely adds two non-negative safe integer values (e.g., paise balances or share quantities).
 * Throws `FinancialCalculationError` on invalid inputs or safe-integer overflow.
 */
export function safeAddPaise(
  firstPaise: number,
  secondPaise: number,
  fieldName = "amountPaise"
): number {
  assertNonNegativeSafeIntegerPaise(firstPaise, `${fieldName}[0]`);
  assertNonNegativeSafeIntegerPaise(secondPaise, `${fieldName}[1]`);

  if (firstPaise > Number.MAX_SAFE_INTEGER - secondPaise) {
    throw new FinancialCalculationError(
      "ARITHMETIC_OVERFLOW",
      `Addition on ${fieldName} (${firstPaise} + ${secondPaise}) exceeds Number.MAX_SAFE_INTEGER.`
    );
  }

  return firstPaise + secondPaise;
}

/**
 * Safely adds two signed safe integer paise values (e.g., cumulative realized P&L + trade realized P&L).
 * Throws `FinancialCalculationError` on invalid inputs or safe-integer overflow/underflow.
 */
export function safeAddSignedPaise(
  firstPaise: number,
  secondPaise: number,
  fieldName = "signedAmountPaise"
): number {
  assertSignedSafeIntegerPaise(firstPaise, `${fieldName}[0]`);
  assertSignedSafeIntegerPaise(secondPaise, `${fieldName}[1]`);

  const sum = BigInt(firstPaise) + BigInt(secondPaise);
  if (sum > MAX_SAFE_INT_BIGINT || sum < MIN_SAFE_INT_BIGINT) {
    throw new FinancialCalculationError(
      "ARITHMETIC_OVERFLOW",
      `Signed addition on ${fieldName} (${firstPaise} + ${secondPaise}) exceeds safe integer bounds.`
    );
  }

  const result = Number(sum);
  return result === 0 ? 0 : result;
}

/**
 * Safely subtracts a non-negative debit in paise from a non-negative balance in paise,
 * rejecting any result below zero.
 */
export function safeDebitBalancePaise(
  balanceBeforePaise: number,
  debitAmountPaise: number
): number {
  assertNonNegativeSafeIntegerPaise(balanceBeforePaise, "balanceBeforePaise");
  assertPositiveSafeIntegerPaise(debitAmountPaise, "debitAmountPaise");

  if (debitAmountPaise > balanceBeforePaise) {
    throw new FinancialCalculationError(
      "INSUFFICIENT_FUNDS",
      `debitAmountPaise (${debitAmountPaise}) exceeds balanceBeforePaise (${balanceBeforePaise}).`
    );
  }

  return balanceBeforePaise - debitAmountPaise;
}

/**
 * Safely subtracts two signed safe integer paise values (`minuendPaise - subtrahendPaise`).
 * Uses `BigInt` intermediate arithmetic and verifies safe-integer bounds.
 */
export function safeSignedSubtractPaise(
  minuendPaise: number,
  subtrahendPaise: number,
  fieldName = "signedDifferencePaise"
): number {
  assertSignedSafeIntegerPaise(minuendPaise, `${fieldName}.minuend`);
  assertSignedSafeIntegerPaise(subtrahendPaise, `${fieldName}.subtrahend`);

  const diff = BigInt(minuendPaise) - BigInt(subtrahendPaise);
  if (diff > MAX_SAFE_INT_BIGINT || diff < MIN_SAFE_INT_BIGINT) {
    throw new FinancialCalculationError(
      "ARITHMETIC_OVERFLOW",
      `Signed subtraction on ${fieldName} (${minuendPaise} - ${subtrahendPaise}) exceeds safe integer bounds.`
    );
  }

  const result = Number(diff);
  return result === 0 ? 0 : result;
}

/**
 * Calculates the authoritative BUY execution value in paise:
 * `totalValuePaise = quantity * askPricePaise`.
 */
export function calculateBuyTradeValuePaise(
  quantity: number,
  askPricePaise: number
): number {
  return safeMultiplyQuantityAndPricePaise(
    quantity,
    askPricePaise,
    "askPricePaise"
  );
}

/**
 * Calculates the authoritative SELL execution proceeds in paise:
 * `sellProceedsPaise = quantity * bidPricePaise`.
 */
export function calculateSellProceedsPaise(
  quantity: number,
  bidPricePaise: number
): number {
  return safeMultiplyQuantityAndPricePaise(
    quantity,
    bidPricePaise,
    "bidPricePaise"
  );
}

/**
 * Divides two positive `BigInt` values using deterministic half-up integer rounding:
 * `round(numerator / denominator) = floor((2 * numerator + denominator) / (2 * denominator))`.
 */
function divideBigIntHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator * 2n + denominator) / (2n * denominator);
}

/**
 * Calculates the rounded display `averageBuyPricePaise` from `totalInvestedPaise` and `totalQuantity`.
 *
 * Important Financial Rule:
 * - `totalInvestedPaise` is the authoritative remaining cost basis.
 * - `averageBuyPricePaise` is a derived, rounded display value and must NEVER be multiplied
 *   by `quantity` to recompute authoritative cost basis.
 * - When `totalQuantity === 0`, `totalInvestedPaise` must be `0` and the result is `0`.
 * - When `totalQuantity >= 1`, `totalInvestedPaise` must be `>= totalQuantity` and the result is `>= 1`.
 */
export function calculateAverageBuyPricePaise(
  totalInvestedPaise: number,
  totalQuantity: number
): number {
  assertNonNegativeSafeIntegerPaise(totalInvestedPaise, "totalInvestedPaise");
  assertNonNegativeWholeShareQuantity(totalQuantity, "totalQuantity");

  if (totalQuantity === 0) {
    if (totalInvestedPaise !== 0) {
      throw new FinancialCalculationError(
        "INVALID_HOLDING_STATE",
        "totalInvestedPaise must be 0 when totalQuantity is 0."
      );
    }
    return 0;
  }

  if (totalInvestedPaise < totalQuantity) {
    throw new FinancialCalculationError(
      "INVALID_HOLDING_STATE",
      "totalInvestedPaise must be at least equal to totalQuantity when totalQuantity is positive."
    );
  }

  const rounded = divideBigIntHalfUp(
    BigInt(totalInvestedPaise),
    BigInt(totalQuantity)
  );
  return Number(rounded);
}

/**
 * Allocates the cost basis removed by a SELL execution (`costBasisSoldPaise`) and computes
 * the remaining holding state (`remainingQuantity`, `remainingTotalInvestedPaise`,
 * `remainingAverageBuyPricePaise`).
 *
 * Behaviour:
 * - Full exit (`sellQuantity === currentQuantity`): removes the entire `currentTotalInvestedPaise`,
 *   leaving `remainingQuantity = 0`, `remainingTotalInvestedPaise = 0`, `remainingAverageBuyPricePaise = 0`.
 * - Partial exit (`sellQuantity < currentQuantity`): allocates proportional cost basis using
 *   `BigInt` intermediate arithmetic and half-up integer rounding:
 *   `round((currentTotalInvestedPaise * sellQuantity) / currentQuantity)`.
 */
export function allocateSellCostBasisPaise(
  input: SellCostBasisAllocationInput
): SellCostBasisAllocationResult {
  const { currentQuantity, currentTotalInvestedPaise, sellQuantity } = input;

  assertPositiveWholeShareQuantity(currentQuantity, "currentQuantity");
  assertPositiveSafeIntegerPaise(
    currentTotalInvestedPaise,
    "currentTotalInvestedPaise"
  );
  assertPositiveWholeShareQuantity(sellQuantity, "sellQuantity");

  if (currentTotalInvestedPaise < currentQuantity) {
    throw new FinancialCalculationError(
      "INVALID_HOLDING_STATE",
      "currentTotalInvestedPaise must be at least equal to currentQuantity."
    );
  }

  if (sellQuantity > currentQuantity) {
    throw new FinancialCalculationError(
      "INSUFFICIENT_HOLDING_QUANTITY",
      `sellQuantity (${sellQuantity}) exceeds currentQuantity (${currentQuantity}).`
    );
  }

  if (sellQuantity === currentQuantity) {
    return {
      costBasisSoldPaise: currentTotalInvestedPaise,
      remainingQuantity: 0,
      remainingTotalInvestedPaise: 0,
      remainingAverageBuyPricePaise: 0,
    };
  }

  const numerator = BigInt(currentTotalInvestedPaise) * BigInt(sellQuantity);
  const denominator = BigInt(currentQuantity);
  const costBasisSoldBigInt = divideBigIntHalfUp(numerator, denominator);
  const costBasisSoldPaise = Number(costBasisSoldBigInt);

  const remainingQuantity = currentQuantity - sellQuantity;
  const remainingTotalInvestedPaise =
    currentTotalInvestedPaise - costBasisSoldPaise;

  if (
    costBasisSoldPaise < 1 ||
    remainingTotalInvestedPaise < remainingQuantity
  ) {
    throw new FinancialCalculationError(
      "INVALID_COST_BASIS",
      "Allocated cost basis violated remaining holding cost-basis invariants."
    );
  }

  const remainingAverageBuyPricePaise = calculateAverageBuyPricePaise(
    remainingTotalInvestedPaise,
    remainingQuantity
  );

  return {
    costBasisSoldPaise,
    remainingQuantity,
    remainingTotalInvestedPaise,
    remainingAverageBuyPricePaise,
  };
}

/**
 * Calculates realized P&L in integer paise for a SELL execution:
 * `realizedPnlPaise = sellProceedsPaise - costBasisSoldPaise`.
 * Result may be positive (profit), zero (break-even), or negative (loss).
 */
export function calculateRealizedPnlPaise(
  sellProceedsPaise: number,
  costBasisSoldPaise: number
): number {
  assertPositiveSafeIntegerPaise(sellProceedsPaise, "sellProceedsPaise");
  assertPositiveSafeIntegerPaise(costBasisSoldPaise, "costBasisSoldPaise");

  return safeSignedSubtractPaise(
    sellProceedsPaise,
    costBasisSoldPaise,
    "realizedPnlPaise"
  );
}

/**
 * Computes the complete holding and trade accounting transition for a BUY execution.
 */
export function calculateHoldingAfterBuy(
  input: HoldingBuyTransitionInput
): HoldingBuyTransitionResult {
  const {
    currentQuantity,
    currentTotalInvestedPaise,
    currentRealizedPnlPaise = 0,
    currentVersion = 0,
    buyQuantity,
    askPricePaise,
  } = input;

  assertNonNegativeWholeShareQuantity(currentQuantity, "currentQuantity");
  assertNonNegativeSafeIntegerPaise(
    currentTotalInvestedPaise,
    "currentTotalInvestedPaise"
  );
  assertSignedSafeIntegerPaise(
    currentRealizedPnlPaise,
    "currentRealizedPnlPaise"
  );
  assertNonNegativeWholeShareQuantity(currentVersion, "currentVersion");

  // Validate existing holding consistency before applying BUY
  calculateAverageBuyPricePaise(currentTotalInvestedPaise, currentQuantity);

  const totalValuePaise = calculateBuyTradeValuePaise(
    buyQuantity,
    askPricePaise
  );

  if (currentQuantity > Number.MAX_SAFE_INTEGER - buyQuantity) {
    throw new FinancialCalculationError(
      "ARITHMETIC_OVERFLOW",
      "Updated holding quantity exceeds Number.MAX_SAFE_INTEGER."
    );
  }
  const newQuantity = currentQuantity + buyQuantity;

  const newTotalInvestedPaise = safeAddPaise(
    currentTotalInvestedPaise,
    totalValuePaise,
    "newTotalInvestedPaise"
  );

  const newAverageBuyPricePaise = calculateAverageBuyPricePaise(
    newTotalInvestedPaise,
    newQuantity
  );

  if (currentVersion >= Number.MAX_SAFE_INTEGER) {
    throw new FinancialCalculationError(
      "ARITHMETIC_OVERFLOW",
      "Holding version increment exceeds Number.MAX_SAFE_INTEGER."
    );
  }
  const newVersion = currentVersion + 1;

  return {
    executionPricePaise: askPricePaise,
    totalValuePaise,
    costBasisSoldPaise: 0,
    tradeRealizedPnlPaise: 0,
    newQuantity,
    newTotalInvestedPaise,
    newAverageBuyPricePaise,
    newRealizedPnlPaise: currentRealizedPnlPaise === 0 ? 0 : currentRealizedPnlPaise,
    newVersion,
  };
}

/**
 * Computes the complete holding and trade accounting transition for a SELL execution.
 * Retains zero-quantity holding state (`newQuantity: 0`, `newTotalInvestedPaise: 0`,
 * `newAverageBuyPricePaise: 0`) while preserving cumulative `newRealizedPnlPaise` and `newVersion`.
 */
export function calculateHoldingAfterSell(
  input: HoldingSellTransitionInput
): HoldingSellTransitionResult {
  const {
    currentQuantity,
    currentTotalInvestedPaise,
    currentRealizedPnlPaise = 0,
    currentVersion = 1,
    sellQuantity,
    bidPricePaise,
  } = input;

  assertSignedSafeIntegerPaise(
    currentRealizedPnlPaise,
    "currentRealizedPnlPaise"
  );
  assertPositiveWholeShareQuantity(currentVersion, "currentVersion");

  const totalValuePaise = calculateSellProceedsPaise(
    sellQuantity,
    bidPricePaise
  );

  const allocation = allocateSellCostBasisPaise({
    currentQuantity,
    currentTotalInvestedPaise,
    sellQuantity,
  });

  const tradeRealizedPnlPaise = calculateRealizedPnlPaise(
    totalValuePaise,
    allocation.costBasisSoldPaise
  );

  const newRealizedPnlPaise = safeAddSignedPaise(
    currentRealizedPnlPaise,
    tradeRealizedPnlPaise,
    "newRealizedPnlPaise"
  );

  if (currentVersion >= Number.MAX_SAFE_INTEGER) {
    throw new FinancialCalculationError(
      "ARITHMETIC_OVERFLOW",
      "Holding version increment exceeds Number.MAX_SAFE_INTEGER."
    );
  }
  const newVersion = currentVersion + 1;

  return {
    executionPricePaise: bidPricePaise,
    totalValuePaise,
    costBasisSoldPaise: allocation.costBasisSoldPaise,
    tradeRealizedPnlPaise,
    newQuantity: allocation.remainingQuantity,
    newTotalInvestedPaise: allocation.remainingTotalInvestedPaise,
    newAverageBuyPricePaise: allocation.remainingAverageBuyPricePaise,
    newRealizedPnlPaise,
    newVersion,
  };
}
