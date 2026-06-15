# 🗄️ Backend Ledger — Database Design Documentation

## Overview

Backend Ledger uses **MongoDB** accessed via **Mongoose**. The database holds five collections. The most architecturally significant design decision is that **account balances are never stored as a field** — they are always computed on-the-fly by aggregating the `ledger` collection. This is the double-entry bookkeeping pattern: money is tracked through movements, not snapshots.

---

## Collections

### 1. `users`

Stores registered user accounts.

**Schema**
```js
{
  email:      String  // required, unique, regex-validated, lowercase trimmed
  name:       String  // required
  password:   String  // required, min 6 chars, select:false (never returned by default)
  systemUser: Boolean // default:false, immutable:true, select:false
  createdAt:  Date    // auto (timestamps:true)
  updatedAt:  Date    // auto (timestamps:true)
}
```

**Field Reference**

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| `_id` | ObjectId | auto PK | — |
| `email` | String | required, unique, regex | Stored lowercase, trimmed |
| `name` | String | required | — |
| `password` | String | required, min 6, `select:false` | bcrypt hash, never returned |
| `systemUser` | Boolean | default `false`, `immutable`, `select:false` | Privilege flag, hidden |
| `createdAt` | Date | auto | — |
| `updatedAt` | Date | auto | — |

**Hooks & Methods**
- `pre('save')`: if `password` is modified, hashes it with `bcrypt.hash(password, 10)` automatically.
- `comparePassword(plain)`: instance method using `bcrypt.compare` for login verification.

**Indexes**
- `email` — unique index
- `_id` — default

**Sample Document**
```json
{
  "_id": "661a1b2c3d4e5f6a7b8c9d0e",
  "name": "Jane Smith",
  "email": "jane@example.com",
  "password": "$2a$10$X7Qv...",
  "systemUser": false,
  "createdAt": "2024-03-01T10:00:00.000Z",
  "updatedAt": "2024-03-01T10:00:00.000Z"
}
```

---

### 2. `accounts`

Represents a financial account belonging to a user. **Does not store a balance field** — the balance is derived from the `ledger` collection at query time.

**Schema**
```js
{
  user:      ObjectId → users  // required, indexed
  status:    String            // enum: ACTIVE | FROZEN | CLOSED, default: ACTIVE
  currency:  String            // default: INR
  createdAt: Date              // auto
  updatedAt: Date              // auto
}
```

**Field Reference**

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| `_id` | ObjectId | auto PK | — |
| `user` | ObjectId | required, ref `user` | Foreign key to `users` |
| `status` | String | enum, default `ACTIVE` | Controls transfer eligibility |
| `currency` | String | default `INR` | — |

**Indexes**
- `{ user: 1 }` — for fast account lookup by user
- `{ user: 1, status: 1 }` — compound index for active account queries

**Instance Method: `getBalance()`**

The balance is computed using a MongoDB aggregation pipeline:
```js
ledger.aggregate([
  { $match: { account: this._id } },
  {
    $group: {
      _id: null,
      totalDebit:  { $sum: { $cond: [{ $eq: ["$type", "DEBIT"]  }, "$amount", 0] } },
      totalCredit: { $sum: { $cond: [{ $eq: ["$type", "CREDIT"] }, "$amount", 0] } }
    }
  },
  {
    $project: {
      balance: { $subtract: ["$totalCredit", "$totalDebit"] }
    }
  }
])
```
Returns `0` if no ledger entries exist.

**Sample Document**
```json
{
  "_id": "662b2c3d4e5f6a7b8c9d0e1f",
  "user": "661a1b2c3d4e5f6a7b8c9d0e",
  "status": "ACTIVE",
  "currency": "INR",
  "createdAt": "2024-03-01T10:01:00.000Z",
  "updatedAt": "2024-03-01T10:01:00.000Z"
}
```

---

### 3. `transactions`

Records every transfer attempt. Tracks the lifecycle status from `PENDING` through `COMPLETED` (or `FAILED`/`REVERSED`). The `idempotencyKey` prevents double-execution of the same transfer.

**Schema**
```js
{
  fromAccount:    ObjectId → accounts  // required, indexed
  toAccount:      ObjectId → accounts  // required, indexed
  status:         String               // enum: PENDING | COMPLETED | FAILED | REVERSED
  amount:         Number               // required, min: 0
  idempotencyKey: String               // required, unique, indexed
  createdAt:      Date                 // auto
  updatedAt:      Date                 // auto
}
```

**Field Reference**

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| `_id` | ObjectId | auto PK | — |
| `fromAccount` | ObjectId | required, ref `account` | Sender account |
| `toAccount` | ObjectId | required, ref `account` | Receiver account |
| `status` | String | enum, default `PENDING` | Transfer lifecycle state |
| `amount` | Number | required, min 0 | Amount in account currency |
| `idempotencyKey` | String | required, unique | Client-provided deduplication key |

**Transaction Status Lifecycle**
```
PENDING → COMPLETED   (normal path)
PENDING → FAILED      (session error / MongoDB failure)
COMPLETED → REVERSED  (manual reversal, future feature)
```

**Indexes**
- `idempotencyKey` — unique index (prevents duplicate transfers)
- `fromAccount` — for querying outgoing transfers
- `toAccount` — for querying incoming transfers

**Sample Document**
```json
{
  "_id": "664d4e5f6a7b8c9d0e1f2a3b",
  "fromAccount": "662b2c3d4e5f6a7b8c9d0e1f",
  "toAccount":   "663c3d4e5f6a7b8c9d0e1f2a",
  "status": "COMPLETED",
  "amount": 500,
  "idempotencyKey": "client-key-abc-001",
  "createdAt": "2024-03-01T10:05:00.000Z",
  "updatedAt": "2024-03-01T10:05:15.000Z"
}
```

---

### 4. `ledgers`

The heart of the system. Each ledger entry represents one side of a transfer — every transaction produces exactly **two** ledger entries. All fields are `immutable` — once written, they cannot be modified or deleted.

**Schema**
```js
{
  account:     ObjectId → accounts     // required, immutable, indexed
  transaction: ObjectId → transactions // required, immutable, indexed
  amount:      Number                  // required, immutable
  type:        String                  // enum: CREDIT | DEBIT, required, immutable
}
```

**Field Reference**

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| `_id` | ObjectId | auto PK | — |
| `account` | ObjectId | required, ref `account`, immutable | Which account this entry belongs to |
| `transaction` | ObjectId | required, ref `transaction`, immutable | Parent transaction |
| `amount` | Number | required, immutable | Always positive |
| `type` | String | `CREDIT` or `DEBIT`, immutable | Direction of money flow |

> **No `timestamps: true`** on this schema — ledger entries have no `updatedAt` because they can never be updated.

**Immutability Enforcement**

Mongoose pre-hooks block **every** mutation operation:
```
findOneAndUpdate, updateOne, updateMany, deleteOne, deleteMany,
remove, findOneAndDelete, findOneAndReplace
```
All throw: `"Ledger entries are immutable and cannot be modified or deleted"`

**Double-Entry Pair Example**

For a transfer of ₹500 from Account A to Account B:
```json
// Entry 1 — Sender
{
  "account": "<Account_A_id>",
  "transaction": "<txn_id>",
  "amount": 500,
  "type": "DEBIT"
}

// Entry 2 — Receiver
{
  "account": "<Account_B_id>",
  "transaction": "<txn_id>",
  "amount": 500,
  "type": "CREDIT"
}
```

**Indexes**
- `{ account: 1 }` — for balance aggregation queries
- `{ transaction: 1 }` — for fetching all entries of a transaction

---

### 5. `tokenblacklists`

Stores invalidated JWTs (from logout). MongoDB's TTL index automatically deletes entries after 3 days — matching the JWT's own `expiresIn: "3d"` lifespan.

**Schema**
```js
{
  token:     String  // required, unique
  createdAt: Date    // auto (timestamps:true)
}
```

**Field Reference**

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| `_id` | ObjectId | auto PK | — |
| `token` | String | required, unique | Full JWT string |
| `createdAt` | Date | auto | Used by TTL index |

**TTL Index**
```js
{ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 3 }  // 3 days
```
MongoDB's background TTL thread automatically removes expired blacklisted tokens, keeping the collection small without manual cleanup.

---

## Entity Relationship Diagram

```
┌─────────────────────────┐
│         users            │
│─────────────────────────│
│ _id         (PK)        │
│ name                    │
│ email       (unique)    │
│ password    (hidden)    │
│ systemUser  (hidden)    │
│ createdAt               │
│ updatedAt               │
└────────────┬────────────┘
             │ 1
             │ has many
             │ N
┌────────────▼────────────┐
│         accounts         │
│─────────────────────────│
│ _id         (PK)        │
│ user        (FK→users)  │
│ status                  │
│ currency                │
└──────┬──────────┬───────┘
       │          │
       │ 1        │ 1
       │          │
       │ N        │ N
┌──────▼──────┐  ┌▼───────────────────────┐
│  ledgers    │  │      transactions        │
│─────────────│  │─────────────────────────│
│ _id  (PK)   │  │ _id           (PK)      │
│ account(FK) │  │ fromAccount   (FK→accts)│
│ transaction │  │ toAccount     (FK→accts)│
│   (FK)      │  │ amount                  │
│ amount      │  │ status                  │
│ type        │  │ idempotencyKey (unique) │
└─────────────┘  └─────────────────────────┘
       │                    │
       └────────────────────┘
       N entries per 1 transaction
       (always exactly 2 per transfer)

┌─────────────────────────┐
│    tokenblacklists       │
│─────────────────────────│
│ _id         (PK)        │
│ token       (unique)    │
│ createdAt   (TTL 3d)    │
└─────────────────────────┘
```

---

## Data Integrity Guarantees

| Guarantee | Mechanism |
|-----------|-----------|
| Atomic transfers | MongoDB `startSession()` + `commitTransaction()` — both ledger entries succeed or both roll back |
| No duplicate transfers | `idempotencyKey` unique index on `transactions` |
| Immutable audit trail | Ledger `immutable` fields + pre-hook guards |
| No negative balances | Balance checked before creating the DEBIT entry |
| Inactive account guard | `status !== 'ACTIVE'` check before any transfer |
| Auto-expiring blacklist | TTL index on `tokenblacklists.createdAt` |
| Password never readable | `select: false` on `password` + bcrypt hash |
