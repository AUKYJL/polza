# Polza

## Локально

Требуются Node.js, npm, PostgreSQL и `psql`.

```bash
npm install
cp .env.example .env
```

Укажите в `.env` строку подключения к локальной PostgreSQL в `DATABASE_URL`, затем выполните:

```bash
npm run db:schema
npm run load:companies
npm run dev
```

Приложение: [http://localhost:3000](http://localhost:3000).

Дополнительные команды:

```bash
npm run load:review
npm run lint
npm run typecheck
npm run build
```

## Docker

```bash
cp .env.example .env
docker compose up -d db
docker compose run --rm app npm run db:schema
docker compose run --rm app npm run load:companies
docker compose up -d app
```

Приложение: [http://localhost:3000](http://localhost:3000).

Дополнительная команда импорта:

```bash
docker compose run --rm app npm run load:review
```
