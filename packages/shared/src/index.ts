export type ProviderStatus = "configured" | "provider_not_configured";

export type TradingMode = "live";

export interface HealthStatus {
  status: "ok";
  service: string;
}
