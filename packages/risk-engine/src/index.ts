export interface RiskLimits {
  killSwitchEnabled: boolean;
  maxPositionUsd: number;
  maxOpenPositions: number;
  dailyLossLimitUsd: number;
  maxSlippageBps: number;
  minLiquidityUsd: number;
}

export interface TradeRiskContext {
  requestedNotionalUsd: number;
  availableBalanceUsd: number;
  requiredFeeReserveUsd: number;
  openPositions: number;
  dailyLossUsd: number;
  quoteAgeMs: number;
  maxQuoteAgeMs: number;
  slippageBps: number;
  liquidityUsd: number;
}

export type RiskDenialCode =
  | "kill_switch_enabled"
  | "invalid_risk_input"
  | "position_limit_exceeded"
  | "insufficient_balance_or_fee_reserve"
  | "open_positions_limit_reached"
  | "daily_loss_limit_reached"
  | "quote_stale"
  | "slippage_limit_exceeded"
  | "insufficient_liquidity";

export interface RiskDecision {
  allowed: boolean;
  denialCodes: RiskDenialCode[];
}

export function evaluateTradeRisk(
  limits: RiskLimits,
  context: TradeRiskContext
): RiskDecision {
  const denialCodes: RiskDenialCode[] = [];
  const numericInputs = [
    limits.maxPositionUsd,
    limits.maxOpenPositions,
    limits.dailyLossLimitUsd,
    limits.maxSlippageBps,
    limits.minLiquidityUsd,
    context.requestedNotionalUsd,
    context.availableBalanceUsd,
    context.requiredFeeReserveUsd,
    context.openPositions,
    context.dailyLossUsd,
    context.quoteAgeMs,
    context.maxQuoteAgeMs,
    context.slippageBps,
    context.liquidityUsd
  ];

  if (limits.killSwitchEnabled) denialCodes.push("kill_switch_enabled");
  if (numericInputs.some((value) => !Number.isFinite(value)) ||
      context.requestedNotionalUsd <= 0 ||
      context.availableBalanceUsd < 0 ||
      context.requiredFeeReserveUsd < 0 ||
      context.openPositions < 0 ||
      context.dailyLossUsd < 0 ||
      context.quoteAgeMs < 0 ||
      context.maxQuoteAgeMs < 0 ||
      context.slippageBps < 0 ||
      context.liquidityUsd < 0 ||
      limits.maxPositionUsd <= 0 ||
      limits.maxOpenPositions <= 0 ||
      !Number.isInteger(limits.maxOpenPositions) ||
      !Number.isInteger(context.openPositions) ||
      limits.dailyLossLimitUsd <= 0 ||
      limits.maxSlippageBps < 0 ||
      limits.minLiquidityUsd < 0) {
    denialCodes.push("invalid_risk_input");
    return { allowed: false, denialCodes };
  }

  if (context.requestedNotionalUsd > limits.maxPositionUsd) {
    denialCodes.push("position_limit_exceeded");
  }
  if (context.requestedNotionalUsd + context.requiredFeeReserveUsd >
      context.availableBalanceUsd) {
    denialCodes.push("insufficient_balance_or_fee_reserve");
  }
  if (context.openPositions >= limits.maxOpenPositions) {
    denialCodes.push("open_positions_limit_reached");
  }
  if (context.dailyLossUsd >= limits.dailyLossLimitUsd) {
    denialCodes.push("daily_loss_limit_reached");
  }
  if (context.quoteAgeMs > context.maxQuoteAgeMs) {
    denialCodes.push("quote_stale");
  }
  if (context.slippageBps > limits.maxSlippageBps) {
    denialCodes.push("slippage_limit_exceeded");
  }
  if (context.liquidityUsd < limits.minLiquidityUsd) {
    denialCodes.push("insufficient_liquidity");
  }

  return { allowed: denialCodes.length === 0, denialCodes };
}
