# SOUQ Luxury — Full Store Package

A production-style Arabic storefront with a shared server-side catalog, owner authentication, products, promo codes, orders, health endpoint and a luxury responsive UI.

## 1. Requirements
- Node.js 20+
- A hosting provider with persistent disk/storage if using the included JSON datastore.

## 2. Local setup
```bash
copy .env.example .env
npm start
```
Set `ADMIN_PIN` in `.env` to a strong private value. Then open `http://localhost:3000`.

## 3. Architecture
- Public: `GET /api/store` returns products/promos.
- Public orders: `POST /api/orders` creates an order.
- Owner login: `POST /api/auth/login` creates an HttpOnly session cookie.
- Owner writes: `PUT /api/store` require the authenticated owner session.
- Owner stats: `GET /api/admin/stats` require the authenticated owner session.
- Health: `GET /health`.

The browser no longer contains the owner PIN. The server owns authentication.

## 4. Data
`data/store.json` is an atomic file-backed datastore. For a larger company deployment, replace it with PostgreSQL/Supabase while keeping the same API contract. Do not deploy without persistent storage if you need data to survive restarts.

## 5. Production checklist
- Set a strong `ADMIN_PIN` and never commit `.env`.
- Use HTTPS through the hosting provider.
- Enable persistent storage or migrate the datastore to PostgreSQL.
- Add a custom domain and DNS.
- Configure automated backups before taking real orders.
- Add payment processing only through a trusted provider; never store card numbers in this app.
- Rotate credentials if the project is ever shared publicly.

## 6. Deploy
The included `render.yaml` is a starting point for Render-style deployment. Create the service, set `ADMIN_PIN` as a secret, attach persistent storage, deploy, then use the generated HTTPS URL.
