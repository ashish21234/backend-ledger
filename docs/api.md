# 📡 Backend Ledger — API Reference

**Base URL:** `http://localhost:3000`

All responses return JSON. Protected routes require a valid JWT passed as either:
- An HTTP cookie: `token=<jwt>`
- An Authorization header: `Authorization: Bearer <jwt>`

---

## Auth Endpoints — `/api/auth`

### `POST /api/auth/register`

Register a new user. Triggers a welcome email after the response is sent.

**Request Body**
```json
{
  "name": "Jane Smith",
  "email": "jane@example.com",
  "password": "secret123"
}
```

**Success Response** `201 Created`
```json
{
  "user": {
    "_id": "661a1b2c3d4e5f6a7b8c9d0e",
    "name": "Jane Smith",
    "email": "jane@example.com"
  },
  "token": "eyJhbGciOiJIUzI1NiIs..."
}
```
> Also sets `Set-Cookie: token=<jwt>` in the response.

**Error Response** `422 Unprocessable Entity`
```json
{
  "message": "User already exists with email",
  "status": "failed"
}
```

---

### `POST /api/auth/login`

Authenticate a user and receive a JWT.

**Request Body**
```json
{
  "email": "jane@example.com",
  "password": "secret123"
}
```

**Success Response** `200 OK`
```json
{
  "user": {
    "_id": "661a1b2c3d4e5f6a7b8c9d0e",
    "name": "Jane Smith",
    "email": "jane@example.com"
  },
  "token": "eyJhbGciOiJIUzI1NiIs..."
}
```
> Also sets `Set-Cookie: token=<jwt>`.

**Error Response** `401 Unauthorized`
```json
{
  "message": "email or password is invalid"
}
```

---

### `POST /api/auth/logout`

Invalidate the current JWT by adding it to the token blacklist. The token auto-expires from the blacklist after 3 days (via MongoDB TTL index).

**Headers / Cookie**
```
Cookie: token=<jwt>
```
or
```
Authorization: Bearer <jwt>
```

**Success Response** `200 OK`
```json
{
  "message": "User logged out successfully"
}
```
> Clears the `token` cookie. The JWT is now permanently invalid until it naturally expires.

---

## User Endpoints — `/api/users`

### `GET /api/users/profile` 🔒 Auth Required

Returns the authenticated user's profile.

**Success Response** `200 OK`
```json
{
  "user": {
    "_id": "661a1b2c3d4e5f6a7b8c9d0e",
    "name": "Jane Smith",
    "email": "jane@example.com",
    "systemUser": false
  }
}
```

**Error Response** `404 Not Found`
```json
{
  "message": "User not found"
}
```

---

### `GET /api/users` 🔒 System User Only

List all users with their accounts and live balances. Supports optional case-insensitive search by name or email.

**Query Parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| `search` | string | Optional. Filters by name or email (regex, case-insensitive) |

**Example**
```
GET /api/users?search=jane
```

**Success Response** `200 OK`
```json
{
  "users": [
    {
      "_id": "661a1b2c3d4e5f6a7b8c9d0e",
      "name": "Jane Smith",
      "email": "jane@example.com",
      "createdAt": "2024-03-01T10:00:00.000Z",
      "accounts": [
        {
          "_id": "662b2c3d4e5f6a7b8c9d0e1f",
          "status": "ACTIVE",
          "currency": "INR",
          "balance": 1500
        }
      ]
    }
  ]
}
```

**Error Response** `403 Forbidden`
```json
{
  "message": "Forbidden access, not a system user"
}
```

---

## Account Endpoints — `/api/accounts`

### `POST /api/accounts` 🔒 Auth Required

Create a new account for the authenticated user. Default currency is `INR` and status is `ACTIVE`.

**Request Body**
```json
{}
```
> No body fields required — the user is derived from the JWT.

**Success Response** `201 Created`
```json
{
  "account": {
    "_id": "662b2c3d4e5f6a7b8c9d0e1f",
    "user": "661a1b2c3d4e5f6a7b8c9d0e",
    "status": "ACTIVE",
    "currency": "INR",
    "createdAt": "2024-03-01T10:00:00.000Z",
    "updatedAt": "2024-03-01T10:00:00.000Z"
  }
}
```

---

### `GET /api/accounts` 🔒 Auth Required

List all accounts belonging to the authenticated user.

**Success Response** `200 OK`
```json
{
  "accounts": [
    {
      "_id": "662b2c3d4e5f6a7b8c9d0e1f",
      "user": "661a1b2c3d4e5f6a7b8c9d0e",
      "status": "ACTIVE",
      "currency": "INR",
      "createdAt": "2024-03-01T10:00:00.000Z"
    }
  ]
}
```

---

### `GET /api/accounts/balance/:accountId` 🔒 Auth Required

Get the live balance of a specific account. The balance is computed in real time from the ledger using a MongoDB aggregation pipeline (SUM of CREDITs minus SUM of DEBITs).

**URL Parameters**

| Parameter | Description |
|-----------|-------------|
| `accountId` | MongoDB ObjectId of the account |

**Success Response** `200 OK`
```json
{
  "accountId": "662b2c3d4e5f6a7b8c9d0e1f",
  "balance": 1500
}
```

**Error Response** `404 Not Found`
```json
{
  "message": "Account not found"
}
```

---

## Transaction Endpoints — `/api/transactions`

### `POST /api/transactions` 🔒 Auth Required

Transfer funds between two accounts. This is the core operation of the system — it executes the **10-step transfer flow** inside a MongoDB ACID session.

**Request Body**
```json
{
  "fromAccount": "662b2c3d4e5f6a7b8c9d0e1f",
  "toAccount":   "663c3d4e5f6a7b8c9d0e1f2a",
  "amount":      500,
  "idempotencyKey": "unique-client-generated-key-001"
}
```

> `idempotencyKey` must be a unique string generated by the client for each intended transfer. Reusing a key returns the previous result without re-executing the transfer.

**Success Response** `201 Created`
```json
{
  "message": "Transaction completed successfully",
  "transaction": {
    "_id": "664d4e5f6a7b8c9d0e1f2a3b",
    "fromAccount": "662b2c3d4e5f6a7b8c9d0e1f",
    "toAccount":   "663c3d4e5f6a7b8c9d0e1f2a",
    "amount": 500,
    "status": "COMPLETED",
    "idempotencyKey": "unique-client-generated-key-001",
    "createdAt": "2024-03-01T10:05:00.000Z"
  }
}
```

**Idempotency Responses**

| Prior Status | HTTP | Message |
|-------------|------|---------|
| `COMPLETED` | 200 | `"Transaction already completed"` + transaction |
| `PENDING` | 400 | `"Transaction is still processing"` |
| `FAILED` | 500 | `"Transaction failed, please retry"` |
| `REVERSED` | 400 | `"Transaction was reversed, please retry"` |

**Validation Error Responses** `400 Bad Request`
```json
{ "message": "FromAccount, toAccount, amount and idempotencyKey are required" }
{ "message": "Invalid fromAccount or toAccount" }
{ "message": "Both fromAccount and toAccount must be active" }
{ "message": "Insufficient balance. Current balance is 200. Requested amount is 500" }
```

> A confirmation email is sent to the authenticated user after every successful transfer.

---

### `POST /api/transactions/system/initial-funds` 🔒 System User Only

Credit funds into any user account from the system account. Used to seed accounts with an initial balance.

**Request Body**
```json
{
  "toAccount":      "662b2c3d4e5f6a7b8c9d0e1f",
  "amount":         10000,
  "idempotencyKey": "system-seed-jane-001"
}
```

**Success Response** `201 Created`
```json
{
  "message": "Initial funds transaction completed successfully",
  "transaction": {
    "_id": "664d4e5f6a7b8c9d0e1f2a3b",
    "fromAccount": "<system_account_id>",
    "toAccount":   "662b2c3d4e5f6a7b8c9d0e1f",
    "amount": 10000,
    "status": "COMPLETED",
    "idempotencyKey": "system-seed-jane-001"
  }
}
```

**Error Responses** `400 Bad Request`
```json
{ "message": "toAccount, amount and idempotencyKey are required" }
{ "message": "Invalid toAccount" }
{ "message": "System user account not found" }
```

---

## Health Check

### `GET /`

```
200 OK
Ledger Service is up and running
```

---

## Error Reference

| HTTP Status | Scenario |
|-------------|----------|
| `400` | Missing fields, invalid account IDs, inactive accounts, insufficient balance |
| `401` | No token, blacklisted token, expired token, user not found |
| `403` | Valid token but `systemUser !== true` on system-only route |
| `404` | Resource (user/account) not found |
| `422` | Registration with duplicate email |
| `500` | Unexpected server / session error |

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `MONGO_URI` | MongoDB connection string |
| `JWT_SECRET` | Secret for signing JWTs |
| `EMAIL_USER` | Gmail address for sending emails |
| `CLIENT_ID` | Google OAuth2 client ID |
| `CLIENT_SECRET` | Google OAuth2 client secret |
| `REFRESH_TOKEN` | Google OAuth2 refresh token |
