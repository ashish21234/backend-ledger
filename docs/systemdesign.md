# 🧩 Backend Ledger — System Design Documentation

## Problem Statement

Design a backend financial ledger service where multiple users can hold accounts, transfer funds between them, and view their balances — with strong guarantees around atomicity, idempotency, auditability, and security.

---

## System Requirements

### Functional Requirements
- User registration and login with secure JWT authentication
- Logout with token invalidation (token blacklisting)
- Two user roles: regular users and system users
- Users can create one or more accounts (default currency: INR)
- Fund transfers between any two active accounts
- Real-time balance computation from ledger entries
- System user can credit initial funds to any account
- System user can list and search all users and their balances
- Email notifications on registration and transaction completion

### Non-Functional Requirements
- **Atomic transfers** — funds must never be partially applied (ACID transaction)
- **Idempotent transfers** — retrying the same request must not duplicate the transfer
- **Immutable audit trail** — ledger entries can never be modified or deleted
- **No stored balances** — balance is always derived from the ledger at query time
- **Stateless API** — JWT-based auth, no server-side session state
- **Secure** — passwords hashed, tokens invalidated on logout, role checks enforced

---

## High-Level System Design

```
┌───────────────────────────────────────────────────┐
│                  API Consumers                     │
│   (Postman / Frontend / Mobile / Other Services)  │
└─────────────────────┬─────────────────────────────┘
                      │ HTTP / REST
                      ▼
┌───────────────────────────────────────────────────┐
│          Express.js Backend (port 3000)            │
│                                                   │
│  Middleware: JSON body → cookies → authMiddleware │
│                                                   │
│  /api/auth          /api/users                    │
│  /api/accounts      /api/transactions             │
│                                                   │
│  Controllers → Services → Models                  │
└─────────────────────┬─────────────────────────────┘
                      │ Mongoose
         ┌────────────┴────────────┐
         ▼                         ▼
┌─────────────────┐     ┌────────────────────────┐
│  MongoDB Atlas  │     │  Gmail SMTP (OAuth2)    │
│  (Replica Set)  │     │  via Nodemailer         │
│                 │     │                         │
│  users          │     │  - Registration email   │
│  accounts       │     │  - Transaction confirm  │
│  transactions   │     └────────────────────────┘
│  ledgers        │
│  tokenblacklists│
└─────────────────┘
```

---

## Core Design: Double-Entry Bookkeeping

This is the most important architectural decision in the system. Rather than storing a `balance` field on each account, balances are computed from a permanent ledger of movements.

### Why Double-Entry?

| Approach | Risk |
|----------|------|
| Stored balance field | Race conditions, inconsistency under concurrent updates, no audit trail |
| Single-entry ledger | Hard to detect discrepancies, no natural debit/credit separation |
| **Double-entry ledger** ✅ | Every ₹ debited from one account is always credited to another; balance sheet always reconciles |

### The Rule

```
For every transfer of amount X:

  DEBIT  entry: { account: sender,   amount: X }
  CREDIT entry: { account: receiver, amount: X }

Account Balance = SUM(all CREDITs) − SUM(all DEBITs)

Total money in the system = SUM(all CREDITs) − SUM(all DEBITs) across ALL accounts = 0
(money flows in from system account via initial-funds, not created from thin air)
```

---

## The 10-Step Transfer Flow

```
POST /api/transactions
         │
         ▼
┌─────────────────────────────────────────────────────────┐
│  Step 1 │ Validate Request                               │
│         │ All fields present? fromAccount/toAccount valid?│
└─────────┴──────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────┐
│  Step 2 │ Idempotency Check                              │
│         │ Has this idempotencyKey been used before?      │
│         │   COMPLETED → return 200 (safe replay)         │
│         │   PENDING   → return 400 (still processing)    │
│         │   FAILED    → return 500 (ask client to retry) │
│         │   REVERSED  → return 400                       │
└─────────┴──────────────────────────────────────────────┘
         │ (first-time key)
         ▼
┌─────────────────────────────────────────────────────────┐
│  Step 3 │ Account Status Check                           │
│         │ Both fromAccount and toAccount must be ACTIVE  │
└─────────┴──────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────┐
│  Step 4 │ Derive Sender Balance                          │
│         │ account.getBalance() → ledger aggregation      │
│         │ balance < amount? → reject with 400            │
└─────────┴──────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────┐
│  Step 5 │ Start MongoDB Session + Transaction            │
│         │ mongoose.startSession() → session.startTransaction()│
└─────────┴──────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────┐
│  Step 6 │ Create Transaction (status: PENDING)           │
│         │ transactionModel.create([...], { session })    │
└─────────┴──────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────┐
│  Step 7 │ Create DEBIT Ledger Entry                      │
│         │ { account: fromAccount, type: DEBIT, amount }  │
└─────────┴──────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────┐
│  Step 8 │ Create CREDIT Ledger Entry                     │
│         │ { account: toAccount, type: CREDIT, amount }   │
└─────────┴──────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────┐
│  Step 9 │ Update Transaction → COMPLETED                 │
│         │ session.commitTransaction()                     │
│         │ session.endSession()                            │
└─────────┴──────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────┐
│  Step 10│ Send Email Notification (async, after response)│
│         │ emailService.sendTransactionEmail(...)          │
└─────────┴──────────────────────────────────────────────┘
```

If any step inside the session (steps 5–9) throws an error, the MongoDB session aborts and all operations roll back — the transaction stays in `PENDING` status and no ledger entries are written.

---

## Authentication & Authorization Design

```
Two Auth Middlewares:

authMiddleware               authSystemUserMiddleware
─────────────────            ───────────────────────────
1. Extract token             1. Extract token
2. Check blacklist           2. Check blacklist
3. jwt.verify()              3. jwt.verify()
4. Load user from DB         4. Load user from DB (+systemUser)
5. req.user = user           5. Check systemUser === true
6. next()                    6. req.user = user
                             7. next()

Regular users hit           System-only routes
most endpoints              (/api/users, /system/initial-funds)
```

**Token Blacklisting on Logout**
```
POST /api/auth/logout
  │
  ├── res.clearCookie('token')
  └── tokenBlackListModel.create({ token })
        │
        └── MongoDB TTL index auto-deletes
            after 3 days (= JWT lifespan)
```

On every protected request, the middleware checks `tokenBlackListModel.findOne({ token })` before trusting the JWT. A logged-out token is rejected even if its signature is valid.

---

## Idempotency Design

The `idempotencyKey` is a client-provided unique string. The server stores it with a unique index on the `transactions` collection.

```
Client sends request with idempotencyKey = "pay-001"
                │
                ▼
   Already exists in DB?
        │               │
       YES              NO
        │               │
  What status?      Proceed with
   COMPLETED        new transfer
   PENDING
   FAILED
   REVERSED
        │
  Return appropriate
  response without
  re-executing transfer
```

This ensures that network retries or duplicate requests from the client never result in double-charging.

---

## Sequence Diagrams

### Fund Transfer

```
Client          Express          MongoDB          Email
  │                │                │               │
  │ POST /txn      │                │               │
  │───────────────►│                │               │
  │                │ verify JWT     │               │
  │                │───────────────►│               │
  │                │ check idempotency key          │
  │                │───────────────►│               │
  │                │ getBalance()   │               │
  │                │───────────────►│               │
  │                │ startSession() │               │
  │                │ create txn(PENDING)            │
  │                │───────────────►│               │
  │                │ create DEBIT ledger            │
  │                │───────────────►│               │
  │                │ create CREDIT ledger           │
  │                │───────────────►│               │
  │                │ update txn(COMPLETED)          │
  │                │───────────────►│               │
  │                │ commitTransaction()            │
  │                │───────────────►│               │
  │ 201 { txn }    │                │               │
  │◄───────────────│                │               │
  │                │                │  sendEmail()  │
  │                │────────────────────────────────►
```

### Login + Protected Request

```
Client          Express          MongoDB
  │                │                │
  │ POST /login    │                │
  │───────────────►│                │
  │                │ findOne(email) │
  │                │───────────────►│
  │                │ comparePassword│
  │                │ sign JWT (3d)  │
  │ { token }      │                │
  │◄───────────────│                │
  │                │                │
  │ GET /accounts  │                │
  │ (cookie/header)│                │
  │───────────────►│                │
  │                │ check blacklist│
  │                │───────────────►│
  │                │ jwt.verify()   │
  │                │ findById(user) │
  │                │───────────────►│
  │                │ find(accounts) │
  │                │───────────────►│
  │ { accounts }   │                │
  │◄───────────────│                │
```

---

## API Route Map

```
/api/auth
  POST   /register         → userRegisterController    [Public]
  POST   /login            → userLoginController       [Public]
  POST   /logout           → userLogoutController      [Public*]

/api/users
  GET    /profile          → getUserProfileController  [Auth]
  GET    /                 → getAllUsersController      [System Only]

/api/accounts
  POST   /                 → createAccountController   [Auth]
  GET    /                 → getUserAccountsController [Auth]
  GET    /balance/:id      → getAccountBalanceController [Auth]

/api/transactions
  POST   /                 → createTransaction          [Auth]
  POST   /system/initial-funds → createInitialFunds    [System Only]

GET /                      → health check              [Public]

* Logout is technically public but only meaningful with a token present
```

---

## Scalability Considerations

| Layer | Current Design | At Scale |
|-------|---------------|----------|
| **Server** | Single Express process | Multiple instances behind a load balancer (stateless JWT = no sticky sessions needed) |
| **Database** | Single Atlas cluster | Read replicas for balance queries; sharding by `account._id` |
| **Balance Queries** | Live aggregation per request | Cache balances in Redis with invalidation on each ledger write |
| **Email** | Synchronous after-response call | Move to a message queue (Bull/Redis) for retry and reliability |
| **Transactions** | 15-second intentional delay (dev artifact) | Remove delay; add a job queue for async processing |
| **Token Blacklist** | Full collection scan | Already indexed on `token`; Redis would be faster at high volume |

---

## Known Design Notes

- The `createTransaction` controller includes a **15-second artificial delay** (`setTimeout`) between creating the DEBIT and CREDIT ledger entries. This appears to be a development/testing artifact to simulate slow processing — it should be removed before production deployment.
- `userId` in transactions is stored as `ObjectId` (proper Mongoose ref), unlike the ImagineX project — enabling future `.populate()` calls.
- The balance aggregation runs on every balance check. For high-frequency reads, a Redis-cached balance with ledger-write-triggered invalidation would significantly reduce DB load.
