# Swappy Backend API

Node.js + Express + PostgreSQL backend for the Swappy community exchange marketplace.

---

## Complete Setup Guide (Starting from Zero)

### Step 1 — Install Node.js

Go to https://nodejs.org and download the **LTS** version. Install it.

Verify:
```bash
node --version   # should show v18 or v20
npm --version
```

---

### Step 2 — Install PostgreSQL

**Windows:**
- Download from https://www.postgresql.org/download/windows/
- Run the installer. Remember the password you set for the `postgres` user.

**Mac:**
```bash
brew install postgresql@16
brew services start postgresql@16
```

**Linux (Ubuntu):**
```bash
sudo apt update
sudo apt install postgresql postgresql-contrib
sudo systemctl start postgresql
```

---

### Step 3 — Create the Database

Open a terminal and run:
```bash
psql -U postgres
```

Then inside psql:
```sql
CREATE DATABASE swappy_db;
\q
```

---

### Step 4 — Set up the project

```bash
# Unzip and enter the folder
cd swappy-backend

# Install all dependencies
npm install

# Copy the environment file
cp .env.example .env
```

Now open `.env` and fill in your PostgreSQL password:
```
DB_PASSWORD=your_postgres_password_here
```

Leave everything else as-is for now (OTP_DEV_MODE=true means you can test with OTP 123456).

---

### Step 5 — Create all tables

```bash
npm run migrate
```

You should see: `✅ Migration complete! All tables created.`

---

### Step 6 — Add sample data (optional but recommended)

```bash
npm run seed
```

This adds 8 test users and 8 items so you can browse and test the app immediately.

Test login phones (all use OTP: **123456** in dev mode):
```
9876543210  —  Krishna Yadav
9876543211  —  Arjun Sharma
9876543212  —  Priya Mehta
9876543213  —  Rahul Kumar
```

---

### Step 7 — Start the server

```bash
npm run dev
```

You should see:
```
✅ PostgreSQL connected successfully
🚀 Swappy API running on http://localhost:5000
```

---

### Step 8 — Test it's working

Open your browser or Postman and go to:
```
http://localhost:5000/health
```

You should get:
```json
{ "status": "ok", "service": "Swappy API" }
```

---

## API Reference

### Auth
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/send-otp` | Send OTP to phone |
| POST | `/api/auth/verify-otp` | Verify OTP, get JWT |
| GET  | `/api/auth/me` | Get own profile (auth) |
| PATCH| `/api/auth/profile` | Update profile (auth) |
| POST | `/api/auth/logout` | Logout |

### Items
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/items` | Browse listings (search, filter, paginate) |
| GET | `/api/items/my` | My listed items (auth) |
| GET | `/api/items/saved` | My saved items (auth) |
| GET | `/api/items/:id` | Item detail |
| POST | `/api/items` | Create listing (auth) |
| PATCH | `/api/items/:id` | Update listing (auth) |
| DELETE | `/api/items/:id` | Remove listing (auth) |
| POST | `/api/items/:id/save` | Toggle save (auth) |
| POST | `/api/items/:id/interest` | Express swap interest — feeds triangle matcher (auth) |

### Swaps
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/swaps` | My swaps (auth) |
| POST | `/api/swaps` | Send swap request (auth) |
| PATCH | `/api/swaps/:id/respond` | Accept or decline (auth) |
| PATCH | `/api/swaps/:id/cancel` | Cancel pending swap (auth) |
| POST | `/api/swaps/:id/rate` | Rate after completion (auth) |

### Triangle Swaps
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/triangle/matches` | Detected 3-way matches for me (auth) |
| GET | `/api/triangle/my` | My triangle swaps (auth) |
| POST | `/api/triangle` | Initiate a triangle swap (auth) |
| PATCH | `/api/triangle/:id/confirm` | Confirm your leg (auth) |

### Users & Notifications
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/users/:id` | Public user profile |
| POST | `/api/users/report` | Report a user (auth) |
| GET | `/api/notifications` | My notifications (auth) |
| PATCH | `/api/notifications/read-all` | Mark all read (auth) |
| PATCH | `/api/notifications/:id/read` | Mark one read (auth) |

---

## Connecting to the Frontend

In `swappy/src/hooks/useSwappyStore.js`, replace localStorage calls with real API calls.

Example:
```js
// OLD (mock)
setItems(prev => [...prev, newItem]);

// NEW (real API)
const res = await fetch("http://localhost:5000/api/items", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${localStorage.getItem("swappy_token")}`,
  },
  body: JSON.stringify(newItem),
});
const data = await res.json();
```

Store the JWT token in `localStorage` after `verify-otp` succeeds and attach it to every request.

---

## Going to Production

### PostgreSQL — Use Supabase (free tier, no setup needed)
1. Go to https://supabase.com → New project
2. Go to Settings → Database → copy the connection string
3. Paste into `.env` as `DB_HOST`, `DB_USER` etc.

### Backend Hosting — Use Railway (free tier)
1. Go to https://railway.app
2. New Project → Deploy from GitHub
3. Add your `.env` variables in Railway dashboard
4. Done — Railway gives you a live URL like `https://swappy-backend.up.railway.app`

### SMS OTPs — Use Fast2SMS
1. Sign up at https://fast2sms.com (free 50 credits)
2. Get your API key from dashboard
3. Set `OTP_DEV_MODE=false` and `FAST2SMS_API_KEY=your_key` in `.env`

---

## Project Structure

```
swappy-backend/
├── src/
│   ├── server.js                    # Express app entry point
│   ├── config/
│   │   └── db.js                    # PostgreSQL connection pool
│   ├── db/
│   │   ├── schema.sql               # All table definitions + triggers
│   │   ├── migrate.js               # Run schema.sql against DB
│   │   └── seed.js                  # Sample data for testing
│   ├── middleware/
│   │   ├── auth.js                  # JWT protect / optionalAuth / generateToken
│   │   └── errorHandler.js          # Global error handler + validator
│   ├── controllers/
│   │   ├── authController.js        # OTP send/verify, profile
│   │   ├── itemController.js        # Item CRUD, save, interest signal
│   │   ├── swapController.js        # Create/respond/cancel/rate swaps
│   │   ├── triangleController.js    # Triangle matching + confirmation
│   │   ├── userController.js        # Public profile, report
│   │   └── notificationController.js# Fetch + mark read
│   └── routes/
│       ├── auth.js
│       ├── items.js
│       ├── swaps.js
│       ├── triangle.js
│       └── users.js                 # Exports userRouter + notifRouter
├── uploads/                         # Local image/video storage (dev only)
├── .env.example                     # Copy to .env and fill in
└── package.json
```
"# swappy-backend-" 
"# swappy-backend-" 
