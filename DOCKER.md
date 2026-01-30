# Docker Deployment Guide

מדריך לפריסת האפליקציה באמצעות Docker.

## דרישות מוקדמות

- Docker Desktop (או Docker Engine + Docker Compose)
- Git (לשיבוט הפרויקט)

## פריסה מהירה (Production)

### 1. בניית והרצת הקונטיינרים

מומלץ להשתמש ב-**Docker Compose V2** (פקודה: `docker compose` עם רווח):

```bash
docker compose up -d --build
```

אם מותקן רק ה־Compose הישן (Python):

```bash
docker-compose up -d --build
```

זה יבנה ויריץ:
- **Server** על פורט `3001`
- **Client** על פורט `80` (http://localhost)

### 2. גישה לאפליקציה

פתח בדפדפן: `http://localhost`

### 3. עצירת הקונטיינרים

```bash
docker compose down
# או: docker-compose down
```

### 4. עצירה עם מחיקת volumes (מחיקת בסיס הנתונים)

```bash
docker-compose down -v
```

## פיתוח עם Docker (Development)

לשימוש עם hot-reload:

```bash
docker-compose -f docker-compose.dev.yml up --build
```

זה יריץ:
- **Server** עם nodemon (hot-reload) על פורט `3001`
- **Client** עם Vite dev server על פורט `8081`

## פקודות שימושיות

### צפייה בלוגים

```bash
# כל השירותים
docker-compose logs -f

# רק השרת
docker-compose logs -f server

# רק הלקוח
docker-compose logs -f client
```

### בנייה מחדש

```bash
# בנייה מחדש של כל השירותים
docker-compose build

# בנייה מחדש של שירות ספציפי
docker-compose build server
docker-compose build client
```

### הרצת פקודות בתוך הקונטיינר

```bash
# גישה לשרת
docker-compose exec server sh

# הרצת Prisma commands
docker-compose exec server npx prisma studio
docker-compose exec server npx prisma migrate dev
```

### ניקוי

```bash
# מחיקת קונטיינרים, רשתות, ו-volumes
docker-compose down -v

# מחיקת images שלא בשימוש
docker system prune -a
```

## מבנה הקבצים

```
tomerApp/
├── docker-compose.yml          # Production configuration
├── docker-compose.dev.yml      # Development configuration
├── server/
│   ├── Dockerfile              # Production server image
│   ├── Dockerfile.dev          # Development server image
│   └── .dockerignore
├── client/
│   ├── Dockerfile              # Production client image (multi-stage)
│   ├── Dockerfile.dev          # Development client image
│   ├── nginx.conf              # Nginx configuration for production
│   └── .dockerignore
└── .dockerignore
```

## משתני סביבה

### Server
- `PORT` - פורט השרת (ברירת מחדל: 3001)
- `DATABASE_URL` - כתובת בסיס הנתונים (ברירת מחדל: file:./prisma/dev.db)
- `NODE_ENV` - סביבת הרצה (production/development)

### Client
- `VITE_API_URL` - כתובת ה-API (ברירת מחדל: /api עבור production)

## פתרון בעיות

### שגיאה: `KeyError: 'ContainerConfig'` (docker-compose ישן)

אם מופיעה שגיאה כמו:
```text
ERROR: for server  'ContainerConfig'
KeyError: 'ContainerConfig'
```

זו באג ב-**docker-compose 1.29.2** (גרסת Python) עם Docker Engine חדש. פתרונות:

**א. מעבר ל-Docker Compose V2 (מומלץ)**

התקן את ה-Compose החדש והרץ עם רווח (`compose` בלי מקף):

```bash
# Ubuntu: התקנת plugin
sudo apt-get update
sudo apt-get install docker-compose-v2

# הרצה
docker compose up -d --build
```

**ב. בלי לשדרג – ניקוי והרצה מחדש**

מחק את הקונטיינר וה-image של השרת, ואז הרץ מחדש:

```bash
docker-compose down --remove-orphans
docker rm -f tomer-app-server 2>/dev/null || true
docker rmi a-good-time-to-food_server:latest 2>/dev/null || true
docker-compose up -d --build
```

### השרת נשאר unhealthy / dependency failed to start

אם מופיע:
```text
dependency failed to start: container tomer-app-server is unhealthy
```

1. **בדוק לוגים של השרת** – לראות אם הוא קורס או שאין DB:
   ```bash
   docker compose logs server
   ```
2. **ודא שהתיקייה `server/prisma` קיימת** על המארח (כולל `schema.prisma` ו־`migrations`). ה-volume ממפה אותה לתוך הקונטיינר.
3. **הרץ מיגרציות ידנית** אם יש שגיאות Prisma:
   ```bash
   docker compose run --rm server npx prisma migrate deploy
   docker compose up -d --build
   ```
4. ב־`docker-compose.yml` ה-healthcheck עודכן לבדיקת **TCP** (פורט 3001 פתוח) עם **start_period: 60s** – אם השרת עולה לאט, הוא אמור לעבור אחרי עד ~60 שניות.

### בסיס הנתונים לא נשמר

ודא שה-volume מוגדר נכון ב-`docker-compose.yml`:
```yaml
volumes:
  - ./server/prisma:/app/prisma
```

### Prisma: `libssl.so.1.1` / `libssl` not found

אם בלוגים של השרת מופיע:
```text
libssl.so.1.1: cannot open shared object file
(...libquery_engine-debian-openssl-1.1.x.so.node)
```

ב־**server/prisma/schema.prisma** הוגדר `binaryTargets = ["native", "debian-openssl-3.0.x"]` כדי ש־Prisma יבנה גם את ה-binary ל־Debian עם OpenSSL 3 (Bookworm).  
ב־**server/Dockerfile** משתמשים ב-**node:18-bookworm-slim** (Debian 12 = OpenSSL 3).  
אחרי שינוי ב-schema או ב-Dockerfile הרץ:
```bash
docker compose build server --no-cache
docker compose up -d
```

### שגיאת Prisma (כללית)

אם יש שגיאות Prisma אחרות, הרץ:
```bash
docker compose exec server npx prisma generate
docker compose exec server npx prisma migrate deploy
```

### פורט תפוס

אם הפורט תפוס, שנה את הפורטים ב-`docker-compose.yml`:
```yaml
ports:
  - "3002:3001"  # שינוי פורט חיצוני
```

### בעיות עם hot-reload

ודא שה-volumes מוגדרים נכון ב-`docker-compose.dev.yml`:
```yaml
volumes:
  - ./server:/app
  - /app/node_modules  # חשוב למנוע override של node_modules
```

## פריסה ל-production

### 1. עדכן משתני סביבה

צור קובץ `.env` עם המשתנים הנדרשים:
```env
PORT=3001
DATABASE_URL=file:./prisma/dev.db
NODE_ENV=production
```

### 2. בניית images

```bash
docker-compose build
```

### 3. הרצה

```bash
docker-compose up -d
```

### 4. בדיקת סטטוס

```bash
docker-compose ps
```

## הערות חשובות

1. **בסיס הנתונים**: SQLite נשמר ב-`./server/prisma/dev.db` על המארח
2. **Migrations**: רצות אוטומטית בעת הפעלת הקונטיינר
3. **Nginx**: משמש לשרת את ה-frontend ב-production
4. **API Proxy**: Nginx מנתב בקשות `/api` לשרת ה-backend
