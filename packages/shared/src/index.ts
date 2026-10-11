export type ProviderStatus = "configured" | "provider_not_configured";

export type TradingMode = "paper";

export interface HealthStatus {
  status: "ok";
  service: string;
}
