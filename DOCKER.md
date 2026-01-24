# Docker Deployment Guide

מדריך לפריסת האפליקציה באמצעות Docker.

## דרישות מוקדמות

- Docker Desktop (או Docker Engine + Docker Compose)
- Git (לשיבוט הפרויקט)

## פריסה מהירה (Production)

### 1. בניית והרצת הקונטיינרים

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
docker-compose down
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

### בסיס הנתונים לא נשמר

ודא שה-volume מוגדר נכון ב-`docker-compose.yml`:
```yaml
volumes:
  - ./server/prisma:/app/prisma
```

### שגיאת Prisma

אם יש שגיאות Prisma, הרץ:
```bash
docker-compose exec server npx prisma generate
docker-compose exec server npx prisma migrate deploy
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
