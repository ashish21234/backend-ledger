# 🚀 Backend Ledger — Deployment Guide

## Prerequisites

Before running the project you need:

- **Node.js** v18+ and npm
- **MongoDB** — Atlas (cloud) or local instance with replica set enabled
- **Google Cloud Console** project with Gmail OAuth2 credentials (for email)

> **Replica Set Required:** MongoDB transactions (used for atomic fund transfers) only work on a replica set. MongoDB Atlas provides this by default. A local standalone instance does not support transactions — use `mongod --replSet rs0` locally.

---

## Local Development Setup

### 1. Clone the Repository

```bash
git clone https://github.com/ashish21234/backend-ledger.git
cd backend-ledger
npm install
```

### 2. Create the `.env` File

Create a `.env` file in the root directory:

```env
# MongoDB
MONGO_URI=mongodb+srv://<username>:<password>@cluster0.xxxxx.mongodb.net/ledger

# JWT
JWT_SECRET=your_super_secret_jwt_key_min_32_chars

# Gmail OAuth2 (for email notifications)
EMAIL_USER=yourapp@gmail.com
CLIENT_ID=123456789-abc.apps.googleusercontent.com
CLIENT_SECRET=GOCSPX-xxxxxxxxxxxxx
REFRESH_TOKEN=1//0xxxxxxxxxxxxxxxxxxxxxxxx
```

### 3. Run the Server

```bash
npm run dev     # nodemon (auto-restart on changes)
npm start       # plain node (production-like)
```

The server starts on `http://localhost:3000`. Verify with:
```bash
curl http://localhost:3000/
# → Ledger Service is up and running
```

---

## Gmail OAuth2 Setup (Email Notifications)

The email service uses Gmail + OAuth2, not a plain username/password. Follow these steps once:

1. Go to [Google Cloud Console](https://console.cloud.google.com) → Create a project.
2. Enable the **Gmail API** under APIs & Services.
3. Go to **Credentials** → Create OAuth2 Client ID → Desktop App.
4. Note your `CLIENT_ID` and `CLIENT_SECRET`.
5. Use [OAuth2 Playground](https://developers.google.com/oauthplayground):
   - In settings, check "Use your own OAuth credentials" and enter your client ID/secret.
   - Authorize `https://mail.googleapis.com/` scope.
   - Exchange authorization code for a `REFRESH_TOKEN`.
6. Add all four values to your `.env`.

---

## MongoDB Atlas Setup

1. Create a free cluster at [mongodb.com/cloud/atlas](https://www.mongodb.com/cloud/atlas).
2. Under **Database Access**, create a user with Read/Write permissions.
3. Under **Network Access**, add your server IP (or `0.0.0.0/0` for all IPs in development).
4. Click **Connect** → **Connect your application** → copy the connection string.
5. Replace `<password>` and set it as `MONGO_URI` in `.env`.

Atlas clusters run as replica sets by default, so MongoDB transactions work out of the box.

---

## Local MongoDB with Replica Set (Optional)

If you prefer a local MongoDB for development, you must enable replica set mode — otherwise `mongoose.startSession()` will fail.

```bash
# Start mongod with replica set flag
mongod --replSet rs0 --dbpath /data/db

# In a new terminal, initiate the replica set (first time only)
mongosh
> rs.initiate()
```

Then set your `.env`:
```env
MONGO_URI=mongodb://localhost:27017/ledger?replicaSet=rs0
```

---

## Production Deployment

### Option A — Render

1. Push your repo to GitHub.
2. Go to [render.com](https://render.com) → **New Web Service**.
3. Connect your GitHub repo.
4. Configure:

   | Setting | Value |
   |---------|-------|
   | **Build Command** | `npm install` |
   | **Start Command** | `npm start` |
   | **Node Version** | 18+ |

5. Under **Environment**, add all `.env` variables.
6. Deploy. Your API will be at `https://your-service.onrender.com`.

---

### Option B — Railway

```bash
npm install -g @railway/cli
railway login
railway init
railway up
```

Set all environment variables in the Railway dashboard under your project's **Variables** tab.

---

### Option C — Docker

**`Dockerfile`** (place in project root)
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
```

**Build and run:**
```bash
docker build -t backend-ledger .
docker run -p 3000:3000 \
  -e MONGO_URI="mongodb+srv://..." \
  -e JWT_SECRET="..." \
  -e EMAIL_USER="..." \
  -e CLIENT_ID="..." \
  -e CLIENT_SECRET="..." \
  -e REFRESH_TOKEN="..." \
  backend-ledger
```

**Or with docker-compose:**

```yaml
# docker-compose.yml
version: '3.8'
services:
  api:
    build: .
    ports:
      - "3000:3000"
    env_file:
      - .env
    restart: unless-stopped
```

```bash
docker-compose up --build
```

---

## Seeding a System User

The system user is required to credit initial funds to regular user accounts. Create one directly in MongoDB (do **not** use the `/register` endpoint — that sets `systemUser: false`):

```js
// Run in mongosh
use ledger

db.users.insertOne({
  name: "System",
  email: "system@ledger.internal",
  password: "$2a$10$<bcrypt_hash_of_your_password>",
  systemUser: true,
  createdAt: new Date(),
  updatedAt: new Date()
})
```

To generate the bcrypt hash, run this locally before inserting:
```js
const bcrypt = require('bcryptjs');
console.log(await bcrypt.hash('your_system_password', 10));
```

Then create an account for this system user via `POST /api/accounts` (logged in as the system user) — this account will be used as the source for initial fund credits.

---

## Environment Variable Summary

```env
# Required
MONGO_URI=mongodb+srv://...
JWT_SECRET=<random min 32-char string>

# Required for email notifications
EMAIL_USER=yourapp@gmail.com
CLIENT_ID=<google oauth2 client id>
CLIENT_SECRET=<google oauth2 client secret>
REFRESH_TOKEN=<google oauth2 refresh token>
```

> ⚠️ **Never commit `.env` to GitHub.** It is already listed in `.gitignore`.

---

## Post-Deployment Checklist

- [ ] Health check: `GET /` returns `Ledger Service is up and running`
- [ ] Register a new user: `POST /api/auth/register`
- [ ] Login and receive JWT: `POST /api/auth/login`
- [ ] Create account: `POST /api/accounts`
- [ ] Check balance (should be 0): `GET /api/accounts/balance/:id`
- [ ] Login as system user, credit initial funds: `POST /api/transactions/system/initial-funds`
- [ ] Verify balance updated: `GET /api/accounts/balance/:id`
- [ ] Transfer between two accounts: `POST /api/transactions`
- [ ] Verify sender balance decreased, receiver balance increased
- [ ] Confirm idempotency: repeat the same request with same `idempotencyKey` → should return `200 Transaction already completed`
- [ ] Logout: `POST /api/auth/logout`
- [ ] Verify blacklisted token is rejected on re-use
- [ ] Registration welcome email received
- [ ] Transaction confirmation email received
