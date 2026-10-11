alter table public.orders
  drop constraint if exists orders_check;

alter table public.orders
  drop constraint if exists orders_mode_check;

alter table public.orders
  alter column mode set default 'live';

alter table public.orders
  add constraint orders_live_mode_only check (mode = 'live');

alter table public.trading_signals
  drop constraint if exists trading_signals_signal_check;

update public.trading_signals
  set signal = case signal
    when 'paper_buy' then 'buy'
    when 'paper_sell' then 'sell'
  end
  where signal in ('paper_buy', 'paper_sell');

alter table public.trading_signals
  add constraint trading_signals_signal_live_check
  check (signal in ('watch', 'buy', 'sell', 'blocked'));
