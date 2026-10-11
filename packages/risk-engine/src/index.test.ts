import { describe, expect, it } from "vitest";
import { evaluateTradeRisk, type RiskLimits, type TradeRiskContext } from "./index.js";

const limits: RiskLimits = {
  killSwitchEnabled: false,
  maxPositionUsd: 100,
  maxOpenPositions: 3,
  dailyLossLimitUsd: 30,
  maxSlippageBps: 100,
  minLiquidityUsd: 1_000
};

const context: TradeRiskContext = {
  requestedNotionalUsd: 50,
  availableBalanceUsd: 100,
  requiredFeeReserveUsd: 1,
  openPositions: 0,
  dailyLossUsd: 0,
  quoteAgeMs: 1_000,
  maxQuoteAgeMs: 5_000,
  slippageBps: 50,
  liquidityUsd: 10_000
};

describe("evaluateTradeRisk", () => {
  it("allows a request that satisfies all configured limits", () => {
    expect(evaluateTradeRisk(limits, context)).toEqual({
      allowed: true,
      denialCodes: []
    });
  });

  it("blocks a request when the kill switch is enabled", () => {
    expect(evaluateTradeRisk(
      { ...limits, killSwitchEnabled: true },
      context
    ).denialCodes).toContain("kill_switch_enabled");
  });

  it("blocks requests that exceed position and fee-reserve limits", () => {
    const decision = evaluateTradeRisk(limits, {
      ...context,
      requestedNotionalUsd: 101,
      availableBalanceUsd: 101,
      requiredFeeReserveUsd: 1
    });

    expect(decision.denialCodes).toContain("position_limit_exceeded");
    expect(decision.denialCodes).toContain("insufficient_balance_or_fee_reserve");
  });

  it("blocks stale quotes, excess slippage, and low liquidity", () => {
    const decision = evaluateTradeRisk(limits, {
      ...context,
      quoteAgeMs: 5_001,
      slippageBps: 101,
      liquidityUsd: 999
    });

    expect(decision.denialCodes).toEqual([
      "quote_stale",
      "slippage_limit_exceeded",
      "insufficient_liquidity"
    ]);
  });

  it("rejects non-finite and invalid financial inputs", () => {
    const decision = evaluateTradeRisk(limits, {
      ...context,
      requestedNotionalUsd: Number.NaN
    });

    expect(decision.allowed).toBe(false);
    expect(decision.denialCodes).toContain("invalid_risk_input");
  });
});
