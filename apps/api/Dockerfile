FROM python:3.12-slim

ENV APP_ENV=staging-local \
    DATABASE_SCHEMA=public \
    DATABASE_INITIALIZE=true \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HOST=0.0.0.0 \
    PORT=4000 \
    TRADING_MODE=live \
    LIVE_TRADING_ENABLED=true \
    SOLANA_RPC_URL=https://api.mainnet-beta.solana.com \
    SESSION_COOKIE_HTTPONLY=true \
    SESSION_COOKIE_SAMESITE=Strict

WORKDIR /app
COPY apps/api/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt \
    && groupadd --system app \
    && useradd --system --gid app --no-create-home app

COPY apps/api/app.py ./app.py
COPY apps/api/schema.sql ./schema.sql
USER app

EXPOSE 4000
CMD ["waitress-serve", "--listen=0.0.0.0:4000", "app:app"]
