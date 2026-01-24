# אפליקציית ניהול אוכל משפחתי 🍽️

אפליקציה לניהול חלוקת אוכל בין בני משפחה.

## תכונות

- **ממשק ניהול**: רישום בני משפחה, עדכון מלאי מוצרים, והגדרת חוקי חלוקה
- **ממשק משתמש**: הצגת מלאי, דיווח על לקיחת מוצרים, ולוג פעילות משותף
- **חוקי חלוקה**: הגדרת מוצרים לכל המשפחה, רק לילדים, או רק למבוגרים

## טכנולוגיות

- **Backend**: Node.js + Express + Prisma
- **Frontend**: React + Vite
- **Database**: SQLite

## התקנה והפעלה

### 1. התקנת תלויות

```bash
npm run install-all
```

### 2. הגדרת בסיס הנתונים

```bash
cd server
npm run prisma:generate
npm run prisma:migrate
```

### 3. הפעלת השרת

בטרמינל נפרד:

```bash
cd server
npm run dev
```

השרת יפעל על פורט 3001.

### 4. הפעלת הלקוח

בטרמינל נפרד:

```bash
cd client
npm run dev
```

האפליקציה תיפתח ב-http://localhost:8081

### או הפעלה משולבת:

```bash
npm run dev
```

## שימוש

1. **ממשק ניהול** (`/admin`):
   - הוספת בני משפחה (ילדים/מבוגרים)
   - הוספת מוצרים למלאי
   - הגדרת חוקי חלוקה לכל מוצר

2. **ממשק משתמש** (`/user`):
   - בחירת שם המשתמש
   - צפייה במלאי הזמין
   - דיווח על לקיחת מוצרים
   - צפייה בלוג הפעילות

## פריסה עם Docker

### Production

```bash
# בנייה והרצה
docker-compose up -d --build

# האפליקציה תהיה זמינה ב: http://localhost
```

### Development (עם hot-reload)

```bash
docker-compose -f docker-compose.dev.yml up --build
```

לפרטים נוספים, ראה [DOCKER.md](./DOCKER.md)

## מבנה הפרויקט

```
tomerApp/
├── server/          # Backend API
│   ├── prisma/      # Prisma schema
│   ├── Dockerfile   # Production Docker image
│   ├── Dockerfile.dev # Development Docker image
│   └── index.js     # Express server
├── client/          # React frontend (Vite)
│   ├── index.html   # HTML entry point
│   ├── vite.config.js
│   ├── Dockerfile   # Production Docker image
│   ├── Dockerfile.dev # Development Docker image
│   ├── nginx.conf   # Nginx config for production
│   └── src/
│       ├── components/
│       │   ├── AdminPanel.jsx
│       │   └── UserPanel.jsx
│       └── App.jsx
├── docker-compose.yml      # Production compose
├── docker-compose.dev.yml  # Development compose
└── package.json
```
