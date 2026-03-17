# OXE BALL — Deployment Guide
## Share your game with anyone in the world

---

## 🚀 OPTION 1: Deploy to Railway (Recommended — Free)

**Railway gives you a live URL in under 5 minutes.**

### Step 1 — Create free account
Go to **railway.app** → Sign up with GitHub (free)

### Step 2 — Deploy
1. Click **"New Project"** → **"Deploy from GitHub repo"**
2. Upload this folder to a GitHub repo first:
   - Go to **github.com** → New repository → name it `oxeball`
   - Drag all files from this folder into the repo
3. In Railway, select your `oxeball` repo → Deploy

### Step 3 — Done!
Railway gives you a URL like: `https://oxeball-production.up.railway.app`

Share that URL with players!

---

## 🚀 OPTION 2: Deploy to Render (Free)

1. Go to **render.com** → Create account
2. New → **Web Service**
3. Connect your GitHub repo
4. Settings:
   - **Build Command:** (leave empty)
   - **Start Command:** `node server.js`
5. Deploy → Get your URL

---

## 🚀 OPTION 3: Deploy to Glitch (Easiest — No GitHub needed)

1. Go to **glitch.com** → Sign in
2. Click **"New Project"** → **"Import from GitHub"**
   - OR: New Project → blank → drag files in
3. Your app runs at `https://your-project.glitch.me`

---

## 🚀 OPTION 4: VPS / Dedicated Server

If you have a VPS (DigitalOcean, Hetzner, etc.):

```bash
# Upload files to your server
scp -r oxeball/ user@yourserver.com:/var/www/

# SSH into server
ssh user@yourserver.com

# Install Node.js (if not installed)
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Start the app
cd /var/www/oxeball
node server.js

# To keep it running forever (install pm2)
npm install -g pm2
pm2 start server.js --name oxeball
pm2 startup
pm2 save
```

Then configure Nginx to proxy port 3000:
```nginx
server {
    listen 80;
    server_name yourdomain.com;
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
    }
}
```

---

## 📁 FILE STRUCTURE

```
oxeball/
├── server.js          ← Node.js backend (handles all API + serves files)
├── package.json       ← Node.js config
├── data/              ← Auto-created, stores all game data as JSON
│   ├── users.json
│   ├── config.json
│   ├── refs.json
│   └── txlog.json
└── public/
    ├── game.html      ← The game (share this URL with players)
    ├── admin.html     ← Admin panel (keep this private)
    └── api.js         ← Shared API client
```

---

## 🔧 CONFIGURATION

**Default admin password:** `oxeball2024`

To change it, edit `data/config.json` after first run:
```json
{
  "rate": 20,
  "minBet": 10,
  "maxBet": 100000,
  "winPct": 10,
  "trialOxe": 200,
  "adminPw": "YOUR_NEW_PASSWORD"
}
```

---

## 🔗 URLS AFTER DEPLOY

| URL | For |
|-----|-----|
| `https://yourdomain.com/` | Players (the game) |
| `https://yourdomain.com/admin` | Admin panel |

---

## 💰 DEPOSIT ADDRESS

Update the BNB wallet address in `public/game.html`:
Search for `0xC843b33A3C8a20cE3AB23E59A94Df09Ee3856DEb` and replace with your wallet.

---

## ⚠️ PRODUCTION NOTES

1. **Google OAuth**: Replace the simulation in `server.js` `/api/auth/google` with real Google token verification using `google-auth-library`
2. **BSCScan**: Replace the deposit simulation in `/api/deposit/verify` with real BSCScan API calls
3. **HTTPS**: All cloud platforms (Railway, Render, Glitch) provide HTTPS automatically
4. **Data backup**: Copy the `data/` folder regularly to backup all user/game data
