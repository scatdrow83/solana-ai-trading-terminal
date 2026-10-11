const sections = [
  "Terminal",
  "Markets",
  "Asset Intelligence",
  "Strategies",
  "Orders",
  "Positions",
  "Wallet Desk",
  "Performance",
  "System Logs",
  "Config"
];

export default function HomePage() {
  return (
    <main>
      <header>
        <p>LOCAL DEVELOPMENT SCAFFOLD</p>
        <h1>Solana Terminal</h1>
        <p>
          Foundation stage only. Market data, wallet signing, and live trading are
          not configured.
        </p>
      </header>
      <nav aria-label="Main navigation">
        {sections.map((section) => <span key={section}>{section}</span>)}
      </nav>
      <section aria-labelledby="system-status">
        <h2 id="system-status">System status</h2>
        <ul>
          <li>Trading: disabled</li>
          <li>Market data provider: provider_not_configured</li>
          <li>AI provider: provider_not_configured</li>
          <li>Wallet signing: disabled</li>
        </ul>
      </section>
    </main>
  );
}
