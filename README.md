# אפליקציית ניהול אוכל משפחתי 🍽️

אפליקציה לניהול חלוקת אוכל בין בני משפחה: הקצבה הוגנת, העברות ובקשות הקצבה, פיקדונות, והתחברות עם QR + TOTP.

## תכונות

- **ממשק ניהול** (`/admin`): רישום בני משפחה, עדכון מלאי מוצרים, חוקי חלוקה (כולם / ילדים / מבוגרים / רשימה נבחרת), דוח חלוקה, היסטוריה ופיקדונות. פעולות רגישות דורשות סיסמת אדמין או סיסמה per-משתמש.
- **ממשק משתמש** (`/user`): התחברות בשני שלבים — סריקת QR (מזהה לקוח) ואז קוד TOTP מאפליקציית Authenticator. צפייה במלאי, לקיחת מוצרים, העברת/בקשת הקצבה, פיקדונות, ולוג פעילות. תצוגת בחירת משתמש: GRID או רשימה (נשמר ב-localStorage).
- **חוקי חלוקה**: כולם, רק ילדים, רק מבוגרים, או **רשימה נבחרת** (בחירת משתתפים ידנית למוצר). חלוקה הוגנת עם סיבוב שארית (extraOffset).

## טכנולוגיות

- **Backend**: Node.js, Express, Prisma, SQLite (פורט 3001)
- **Frontend**: React, Vite, React Router, Axios (פורט 8081)
- **Database**: SQLite

## התקנה והפעלה (ללא Docker)

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

### 3. הפעלת השרת והלקוח

```bash
# שרת (פורט 3001)
cd server && npm run dev

# לקוח (פורט 8081) — בטרמינל נפרד
cd client && npm run dev
```

או הפעלה משולבת מהשורש:

```bash
npm run dev
```

האפליקציה: http://localhost:8081

## פריסה עם Docker

מומלץ להשתמש ב-**Docker Compose V2** (`docker compose` עם רווח):

```bash
docker compose up -d --build
```

האפליקציה תהיה זמינה ב: **http://localhost** (לקוח על פורט 80, שרת על 3001).

פיתוח עם hot-reload:

```bash
docker compose -f docker-compose.dev.yml up --build
```

לפתרון בעיות (למשל Prisma/OpenSSL, healthcheck, ContainerConfig), ראה [DOCKER.md](./DOCKER.md).

## שימוש קצר

- **ממשק ניהול**: הוספת בני משפחה (סיסמה 2014), עריכה/מחיקה/קודי כניסה (סיסמה per-משתמש). הוספת/עריכת/מחיקת מוצרים (סיסמאות לפי פעולה). דוח חלוקה, היסטוריה, פיקדונות והחזרת פיקדון.
- **ממשק משתמש**: בחירת משתמש → סריקת QR מזהה לקוח → הזנת קוד TOTP. לאחר התחברות: צפייה במלאי, קח מוצר, העבר/בקש הקצבה, הפקד פיקדון.

## מבנה הפרויקט

```
├── server/              # Backend (Express + Prisma)
│   ├── prisma/          # Schema, migrations
│   ├── Dockerfile       # Production (node:18-bullseye-slim)
│   └── index.js
├── client/               # Frontend (React + Vite)
│   ├── src/
│   │   ├── components/  # AdminPanel.jsx, UserPanel.jsx
│   │   └── App.jsx
│   ├── Dockerfile       # Multi-stage: Node build → nginx
│   └── nginx.conf
├── docker-compose.yml    # Production
├── docker-compose.dev.yml
├── DOCKER.md             # מדריך Docker ופתרון בעיות
├── cursor.rules          # כללי פרויקט ל-Cursor
└── package.json
```

## קישורים

- [DOCKER.md](./DOCKER.md) — פריסה עם Docker, פקודות שימושיות, ופתרון בעיות.
