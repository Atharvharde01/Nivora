# NIVORA

> *Trade. Learn. Evolve.*

NIVORA is a simulated stock trading and portfolio management platform engineered with modern full-stack TypeScript technologies. Designed for active traders and market learners, NIVORA combines real-time portfolio analytics, modular trading workflows, and responsive market dashboards in a unified monorepo architecture.

---

## 🏛️ System Architecture

NIVORA is structured as a high-cohesion, modular monorepo containing three specialized applications:

```text
Nivora/
│
├── backend/                  # Node.js + Express + TypeScript API Server
│   ├── model/                # Mongoose POJO models
│   ├── schemas/              # Mongoose data schemas
│   ├── index.ts              # Server lifecycle, security middleware & API endpoints
│   ├── package.json          # Backend dependencies
│   ├── tsconfig.json         # Strict TypeScript compiler configuration
│   └── .env.example          # Environment configuration template
│
├── frontend/                 # React + TypeScript Landing Page & Discovery Portal
│   ├── public/               # Public assets, icons & media
│   ├── src/                  # Portal components, routes & layouts
│   ├── package.json          # Frontend dependencies
│   └── tsconfig.json         # Strict TypeScript compiler configuration
│
├── dashboard/                # React + TypeScript Trading Dashboard
│   ├── public/               # Static assets
│   ├── src/                  # Watchlist, orders, holdings, positions & context
│   ├── package.json          # Dashboard dependencies
│   └── tsconfig.json         # Strict TypeScript compiler configuration
│
├── .gitignore                # Unified monorepo ignore rules
└── README.md                 # Project documentation & architectural roadmap
```

---

## 🛠️ Technology Stack

| Layer | Technologies |
|---|---|
| **Backend API** | Node.js (v20/v22), Express.js (v4), TypeScript (v5.4), Mongoose (v8), Helmet, CORS, Express-Rate-Limit |
| **Frontend Portal** | React (v18), TypeScript (v4.9), React Router (v6), Bootstrap (v5), FontAwesome |
| **Trading Dashboard** | React (v18), TypeScript (v4.9), Material UI (v5), Chart.js (v4), react-chartjs-2, Axios |
| **Database** | MongoDB Atlas with Mongoose ODM (native schema typing) |
| **Tooling & Build** | Create React App (CRA 5), TypeScript Compiler (`tsc`), tsx |

---

## 🚀 Development Progress & Roadmap

NIVORA is being developed incrementally with end-to-end type safety, automated verification, and strict software engineering practices:

- [x] **Monorepo Architecture**: Unified repository structure and multi-project configuration
- [x] **Backend TypeScript Foundation**: Native Mongoose 8 typing, zero universal `any`, strict compiler checks
- [x] **Lifecycle & Health Probes**: Fail-fast async database connection, graceful shutdown (`SIGTERM`/`SIGINT`), and probes (`/health`, `/health/live`, `/health/ready`)
- [x] **Production Security Hardening**: Origin-partitioned CORS allowlisting, HTTPS validation via WHATWG `URL`, Helmet HTTP security headers, and DoS rate limiting
- [x] **Frontend TypeScript Migration**: Type-safe landing page and account discovery flows (100% complete)
- [x] **Dashboard TypeScript Migration**: Fully typed contexts, watchlist, holdings, positions, and order entry (100% complete)
- [ ] **Authentication Engine**: Passwordless email OTP verification and JWT session tokens
- [ ] **User-Level Data Isolation**: Multi-tenant database architecture separating portfolios per user
- [ ] **Simulated Trading Engine**: Real-time order matching, margin checks, and dynamic P&L calculation
- [ ] **Market Charts**: TradingView Lightweight Charts integration with simulated OHLC price feeds
- [ ] **Production Deployment**: Automated CI/CD pipelines deploying frontend/dashboard to Vercel and backend to Render

---

## 💻 Getting Started

### Prerequisites
- **Node.js**: `v20.x` or `v22.x`
- **npm**: `v10.x+`
- **MongoDB**: Live MongoDB Atlas cluster or local MongoDB instance

### 1. Clone the Repository
```bash
git clone https://github.com/Atharvharde01/Nivora.git
cd Nivora
```

### 2. Configure Backend Environment
Create `backend/.env` from the provided template:
```bash
cp backend/.env.example backend/.env
```
Populate your environment variables:
```env
PORT=3002
MONGO_URL=mongodb+srv://<username>:<password>@<cluster>.mongodb.net/<database>?retryWrites=true&w=majority
NODE_ENV=development
FRONTEND_URL=http://localhost:3000
DASHBOARD_URL=http://localhost:3001
```

### 3. Install Dependencies & Run
Each application runs independently within the monorepo:

```bash
# Backend (Port 3002)
cd backend
npm install
npm run dev

# Dashboard (Port 3001)
cd ../dashboard
npm install
npm start

# Frontend (Port 3000)
cd ../frontend
npm install
npm start
```

---

## 🔒 Security & Privacy

- Environment secrets (`.env`) are never committed to version control.
- In production, cross-origin access is strictly restricted to verified HTTPS URLs with localhost blocked.
- Health probe endpoints are exempt from API rate limiting for monitoring uptime without false positives.

---

## 📄 License

ISC License. Copyright (c) 2026 Atharv Harde.
