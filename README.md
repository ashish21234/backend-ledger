Backend Ledger

This repository contains the backend service for a simple ledger system. It is built with Node.js and Express and uses MongoDB for storing user accounts and transactions. The API handles authentication, account creation, and transaction recording.
The project uses JWT for authentication and bcrypt for password hashing. Cookies are used to store authentication tokens on the client side.

Live on Render: **https://backend-ledger-hi34.onrender.com/**

---

## Stack

- Node.js + Express
- MongoDB + Mongoose
- JWT (auth)
- bcryptjs (password hashing)
- Nodemailer (emails on registration, etc.)
- cookie-parser

---

## Getting started
```bash
git clone 
cd backend-ledger
npm install
```

Create a `.env` in the root:
```env
PORT=3000
MONGODB_URI=your_mongo_connection_string
JWT_SECRET=your_secret_key
# add email config if needed
```

Run dev server:
```bash
npm run dev
```

Or production:
```bash
npm start
```

## Endpoints

**Health**
- `GET /` — sanity check, make sure the server's alive

**Auth** `/api/auth`
- `POST /register` — create a new user
- `POST /login` — login, sets JWT cookie
- `POST /logout` — clears the cookie

**Accounts** `/api/accounts` *(requires auth)*
- `POST /` — create an account
- `GET /` — list all your accounts
- `GET /balance/:accountId` — check balance on a specific account

**Transactions** `/api/transactions`
- `POST /` — new transaction *(requires auth)*
- `POST /system/initial-funds` — seed initial funds via system user *(system-only)*

---
