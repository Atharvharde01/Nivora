# NIVORA Backend — Production Deployment Readiness & Runbook

This document details the production deployment architecture, environment configuration checklist, hosting specification on Render, cookie and custom domain topology, and backup/rollback runbooks for the NIVORA virtual trading platform.

---

## 1. Hosting Architecture Specification

- **Platform**: Render Web Service (Native Node.js Runtime)
- **Node.js Target**: Node.js 20.x LTS or 22.x LTS
- **Build Command**: `npm ci && npm run build`
- **Start Command**: `npm start` (`node dist/index.js`)
- **Health Check Path**: `/health/live` (Process liveness) or `/health` (UptimeRobot 5-minute health check probe)
- **Database Engine**: MongoDB Atlas (Replica-Set Required for Multi-Document ACID Transactions)
  - Connection string format: `mongodb+srv://<user>:<password>@<cluster>.mongodb.net/<dbname>?retryWrites=true&w=majority`

---

## 2. Production Environment Variable Checklist

Every variable must be defined in the Render Dashboard before triggering deployment:

| Variable | Type | Production Requirement | Purpose |
|---|---|---|---|
| `NODE_ENV` | String | Must be strictly `production` | Enforces production security headers, cookies, and error redaction |
| `PORT` | Integer | Assigned automatically by Render | Express HTTP listener port |
| `MONGO_URL` | String | Valid `mongodb+srv://` URI pointing to Atlas replica-set | Database access with ACID transaction support |
| `FRONTEND_URL` | String | Must be HTTPS (e.g. `https://app.nivora.in`) | Primary client origin for CORS and cookie acceptance |
| `DASHBOARD_URL` | String | Must be HTTPS (e.g. `https://dashboard.nivora.in`) | Admin dashboard origin for CORS |
| `OTP_HMAC_SECRET` | String | Minimum 32 random high-entropy characters | Cryptographic HMAC signing for 6-digit email OTPs |
| `JWT_ACCESS_SECRET`| String | Minimum 32 random high-entropy characters | HS256 JWT signature for 15-minute access tokens |
| `JWT_ISSUER` | String | `nivora-api` | JWT token issuer claim validation |
| `JWT_AUDIENCE` | String | `nivora-client` | JWT audience claim validation |
| `BREVO_API_KEY` | String | Active Brevo (Sendinblue) API v3 key | Email delivery for OTP login |
| `BREVO_SENDER_EMAIL`| String | Verified sender email (e.g. `noreply@nivora.in`) | Sender address on transactional emails |
| `BREVO_SENDER_NAME` | String | `NIVORA` | Display name on transactional emails |
| `ENABLE_SWAGGER_UI`| Boolean | `false` (default) | Set to `true` only if public OpenAPI UI is desired |
| `TRUST_PROXY` | Boolean / Num | `false` (default) | **Blocker**: Do NOT enable until staging header verification |

---

## 3. Reverse Proxy & Trust Proxy Blocker Notice

> [!WARNING]
> **Render Reverse Proxy & Cloudflare IP Resolution**:
> Render routes all external traffic through Cloudflare edge nodes and internal load balancers before delivering requests to the Express container.
> Setting `app.set("trust proxy", true)` indiscriminately allows clients to spoof `X-Forwarded-For` headers if the edge does not overwrite them, enabling rate limit bypasses.
> Conversely, setting it to `false` causes `express-rate-limit` to rate limit Render's internal reverse proxy IP rather than individual client IPs.
> **Mandatory Staging Step**: Deploy to a private Render staging instance and inspect the inbound `req.headers['x-forwarded-for']` and `req.ip` behavior. Once the exact proxy hop count is verified (typically `1` or Cloudflare `cf-connecting-ip`), configure `TRUST_PROXY` accordingly.

---

## 4. Custom Domain & Cookie Topology

### Domain Structure
- **Production Web Application**: `https://app.nivora.in`
- **Production API Service**: `https://api.nivora.in` (CNAME to `nivora-backend.onrender.com`)
- **Admin Dashboard**: `https://dashboard.nivora.in`

### Cookie Specifications
1. **Refresh Token Cookie**:
   - Name: `__Host-refresh_token` (enforces Secure, Path=/, Host-only restrictions)
   - `HttpOnly`: `true` (inaccessible to JavaScript)
   - `Secure`: `true` (transmitted over HTTPS only)
   - `SameSite`: `Lax` (or `None` if frontend and API are hosted on different apex domains)
   - Lifetime: 7 days with single-use rotation and reuse detection
2. **CSRF Protection Cookie**:
   - Name: `csrf_token`
   - `HttpOnly`: `false` (read by frontend application to populate `X-CSRF-Token` header)
   - `Secure`: `true`
   - `SameSite`: `Lax` (or `None` for cross-site deployments)
   - Cryptographic Binding: Tokens use HMAC `${salt}.${hmac}` bound to the user's active session ID

---

## 5. Graceful Shutdown & Process Lifecycle

The backend handles `SIGTERM` and `SIGINT` signals emitted by Render during zero-downtime rolling deploys:
1. Express server stops accepting new incoming TCP connections (`server.close()`).
2. Active in-flight requests are granted up to a 10-second drain window.
3. MongoDB connection pool disconnects cleanly (`await mongoose.disconnect()`).
4. Process exits with exit code 0.
5. If in-flight requests exceed 10 seconds, the unreferenced timer triggers a forced `process.exit(1)`.

---

## 6. Backup, Audit & Disaster Recovery Runbook

### Continuous Backup
- MongoDB Atlas continuous automated snapshots with Point-in-Time Recovery (PITR) enabled.
- Retention: 7 days of continuous restore points with 1-minute granularity.

### Post-Incident Financial Reconciliation
In the event of an unexpected database failover or cluster disruption, run the mathematical financial reconciliation audit:
```bash
npm run smoke-test
```
The smoke test verifies that:
1. `cashBalancePaise` equals `initialBalancePaise + sum(CREDIT) - sum(DEBIT)`.
2. Every executed order matches exactly one trade and one immutable ledger entry.
3. No negative balances, fractional shares, or client price overrides exist.

---

## 7. Rollback Procedure

If a deployed release experiences runtime exceptions or unhandled errors:
1. In the Render Dashboard, select **Deploys**.
2. Identify the previous stable commit SHA (e.g. `ea74ac1`).
3. Click **Rollback to this deploy**.
4. Monitor `/health/ready` until status returns `200 OK`.
