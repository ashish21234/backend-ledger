# 🏛️ Backend Ledger — Architecture Documentation

## Overview

Backend Ledger is a production-grade financial ledger REST API built with Node.js and Express. It implements **double-entry bookkeeping** — every money transfer creates two immutable ledger entries (a DEBIT and a CREDIT) inside a single MongoDB ACID transaction, ensuring funds are never created or destroyed, only moved. Account balances are never stored as a field; they are always **derived at query time** by aggregating the ledger.

---

## High-Level Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                  API Clients (HTTP/REST)                       │
│          Postman / Frontend / Mobile / Service-to-Service     │
└──────────────────────────┬───────────────────────────────────┘
                           │ HTTPS  (cookie or Bearer token)
                           ▼
┌──────────────────────────────────────────────────────────────┐
│               Express.js Application  (port 3000)             │
│                                                              │
│  ┌───────────────────────────────────────────────────────┐   │
│  │                    Middleware Stack                    │   │
│  │  express.json()   cookie-parser   authMiddleware      │   │
│  └───────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌──────────┐ ┌──────────┐ ┌──────────────┐ ┌───────────┐  │
│  │/api/auth │ │/api/users│ │/api/accounts │ │/api/trans-│  │
│  │          │ │          │ │              │ │actions    │  │
│  └────┬─────┘ └────┬─────┘ └──────┬───────┘ └─────┬─────┘  │
│       │            │              │               │          │
│  ┌────▼────────────▼──────────────▼───────────────▼──────┐  │
│  │             Controllers Layer                           │  │
│  │  auth.controller  user.controller  account.controller  │  │
│  │                   transaction.controller               │  │
│  └────────────────────────────────┬────────────────────── ┘  │
│                                   │                          │
│  ┌────────────────────────────────▼────────────────────── ┐  │
│  │             Services Layer                              │  │
│  │             email.service (Nodemailer + Gmail OAuth2)  │  │
│  └─────────────────────────────────────────────────────── ┘  │
└──────────────────────────────────────────────────────────────┘
                           │ Mongoose ODM
                           ▼
┌──────────────────────────────────────────────────────────────┐
│                   MongoDB (Database)                          │
│                                                              │
│  ┌──────────┐ ┌──────────┐ ┌──────────────┐ ┌───────────┐  │
│  │  users   │ │ accounts │ │  ledger      │ │transact-  │  │
│  │          │ │          │ │  (immutable) │ │ions       │  │
│  └──────────┘ └──────────┘ └──────────────┘ └───────────┘  │
│                                                              │
│  ┌────────────────────────────────────────────┐             │
│  │  tokenblacklists  (TTL: 3 days)            │             │
│  └────────────────────────────────────────────┘             │
└──────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────┐
│          External Service: Gmail (via OAuth2 + Nodemailer)    │
│          - Registration welcome email                         │
│          - Transaction confirmation email                     │
└──────────────────────────────────────────────────────────────┘
```

---

## Technology Stack

| Technology | Version | Purpose |
|------------|---------|---------|
| Node.js | LTS | Runtime |
| Express | 5.2.1 | Web framework |
| Mongoose | 9.2.4 | MongoDB ODM |
| bcryptjs | 3.0.3 | Password hashing |
| jsonwebtoken | 9.0.3 | JWT auth (3-day expiry) |
| cookie-parser | 1.4.7 | JWT cookie support |
| nodemailer | 8.0.2 | Email via Gmail OAuth2 |
| dotenv | 17.3.1 | Environment config |
| nodemon | 3.1.14 | Dev auto-restart |

---

## Project Folder Structure

```
backend-ledger/
├── server.js                      # Entry point: loads .env, connects DB, starts server
├── package.json
├── .gitignore
│
└── src/
    ├── app.js                     # Express app, route mounting, middleware
    │
    ├── config/
    │   └── db.js                  # MongoDB connection via Mongoose
    │
    ├── models/
    │   ├── user.model.js          # User schema (bcrypt pre-save hook, comparePassword)
    │   ├── account.model.js       # Account schema (getBalance() aggregation method)
    │   ├── transaction.model.js   # Transaction schema (idempotencyKey, status enum)
    │   ├── ledger.model.js        # Ledger schema (fully immutable, double-entry)
    │   └── blackList.model.js     # Token blacklist (TTL auto-expires after 3 days)
    │
    ├── controllers/
    │   ├── auth.controller.js     # Register, Login, Logout
    │   ├── user.controller.js     # Get profile, List all users (system only)
    │   ├── account.controller.js  # Create account, Get accounts, Get balance
    │   └── transaction.controller.js # Transfer funds, Credit initial funds (system only)
    │
    ├── middleware/
    │   └── auth.middleware.js     # authMiddleware + authSystemUserMiddleware
    │
    ├── routes/
    │   ├── auth.routes.js
    │   ├── user.routes.js
    │   ├── account.routes.js
    │   └── transaction.routes.js
    │
    └── services/
        └── email.service.js       # Nodemailer transporter + sendEmail helpers
```

---

## Two User Roles

The system distinguishes between two user types via a hidden `systemUser` boolean field:

```
┌─────────────────────────────────────────────────────────────┐
│  Regular User (systemUser: false)                            │
│  - Register / login                                          │
│  - Create and view own accounts                              │
│  - Check own account balances                                │
│  - Transfer funds between accounts                           │
│  - View own profile                                          │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  System User (systemUser: true)                              │
│  - All regular user capabilities                             │
│  - Credit initial funds to any user account (mint money)     │
│  - List and search all users + their account balances        │
└─────────────────────────────────────────────────────────────┘
```

`systemUser` is flagged `immutable: true` and `select: false` — it cannot be changed after creation and is never exposed in API responses unless explicitly requested.

---

## Request Lifecycle

```
Incoming HTTP Request
      │
      ├── express.json()      parse JSON body
      ├── cookie-parser()     parse cookies
      │
      ▼
Route Match (/api/auth | /api/users | /api/accounts | /api/transactions)
      │
      ├── [Public routes]  → Controller directly
      │
      └── [Protected routes]
            │
            ├── authMiddleware OR authSystemUserMiddleware
            │     ├── Extract token (cookie or Authorization header)
            │     ├── Check tokenBlacklist
            │     ├── jwt.verify()
            │     ├── Load user from DB → req.user
            │     └── next()
            │
            ▼
         Controller
            │
            ├── Business logic
            ├── Model queries (Mongoose)
            ├── MongoDB session (for transactions)
            └── res.json()
                  │
                  └── (async, after response) email.service
```

---

## Double-Entry Ledger Design

The core accounting principle: **every transfer creates exactly two ledger entries**.

```
Transfer: Account A → Account B  (amount: ₹500)

  ledger entry 1:  { account: A, type: DEBIT,  amount: 500 }
  ledger entry 2:  { account: B, type: CREDIT, amount: 500 }

Balance of A = SUM(CREDITs) - SUM(DEBITs) from ledger
Balance of B = SUM(CREDITs) - SUM(DEBITs) from ledger
```

Ledger entries are permanently `immutable` — Mongoose pre-hooks throw errors on any attempt to `update`, `delete`, or `replace` them.

---

## Security Model

| Concern | Solution |
|---------|----------|
| Password storage | bcryptjs, salt rounds 10, auto-hashed in `pre('save')` |
| Auth token | JWT, signed with `JWT_SECRET`, expires in 3 days |
| Token delivery | HTTP cookie (`token`) + optional `Authorization: Bearer` header |
| Logout invalidation | Blacklisted token stored in MongoDB with TTL auto-expiry (3 days) |
| System user access | Separate `authSystemUserMiddleware` checks `systemUser: true` |
| `systemUser` field | `immutable: true`, `select: false` — never returned in default queries |
| Ledger integrity | All fields `immutable: true`, pre-hooks block modification/deletion |
| Atomic transfers | MongoDB sessions + `startTransaction()` + `commitTransaction()` |
| Idempotency | `idempotencyKey` unique index prevents duplicate transfer execution |
