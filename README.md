# H.A. Overseas — Backend REST API

Express.js and MongoDB backend powering the H.A. Overseas B2B Order Creator platform.

---

## 🛠️ Tech Stack
- **Runtime:** Node.js (ES Modules)
- **Framework:** Express.js 4.x
- **Database:** MongoDB & Mongoose ODM
- **Authentication:** JWT (JSON Web Tokens) with bcrypt password hashing
- **Document Generation:** PDFKit with dynamic row height scaling
- **Security:** Helmet, CORS, and Express-Rate-Limit

---

## ⚙️ Environment Variables

Copy `.env.example` to `.env` and configure your credentials:

```bash
cp .env.example .env
```

| Variable | Description | Example / Default |
| :--- | :--- | :--- |
| `PORT` | API Server Port | `5000` |
| `NODE_ENV` | Environment mode | `development` / `production` |
| `MONGODB_URI` | MongoDB Connection String | `mongodb+srv://...` |
| `JWT_SECRET` | Secret key for signing tokens | `your_secret_key` |
| `JWT_EXPIRES_IN` | Token expiration period | `7d` |
| `ADMIN_USERNAME`| Seeded administrator username | `admin` |
| `ADMIN_PASSWORD`| Seeded administrator password | `YourSecurePassword!` |
| `ADMIN_EMAIL`   | Seeded administrator email | `admin@haoverseas.com` |
| `CLIENT_URL`    | Frontend client origin | `http://localhost:5173` |

---

## 🚀 Available Scripts

- **`npm run dev`**: Starts the server using Node's native file watcher (`node --watch src/server.js`) for automatic reloading on changes.
- **`npm start`**: Runs the server in production mode.
- **`node src/seed/importFromLiveWebsite.js`**: Crawls [haoverseas.com](https://haoverseas.com/) and synchronizes live product catalog images and specs into MongoDB.

---

## 📡 REST API Summary

### Authentication (`/api/auth`)
- `POST /api/auth/signup`: Register new buyer company
- `POST /api/auth/login`: Authenticate and receive JWT token
- `GET /api/auth/me`: Fetch authenticated user profile
- `PUT /api/auth/profile`: Update contact and business details

### Attributes (`/api/attributes`)
- `GET /api/attributes`: Retrieve master bundle of finishes, colors, brands, sizes, categories
- CRUD endpoints for `/finishes`, `/colors`, `/brands`, `/sizes`, `/categories` (Admin only)

### Product Catalog (`/api/products`)
- `GET /api/products`: Filterable, paginated product list
- `GET /api/products/:id`: Detailed product profile
- `POST /api/products`: Create new product (Admin)
- `PUT /api/products/:id`: Update product (Admin)
- `DELETE /api/products/:id`: Remove product (Admin)

### B2B Orders (`/api/orders`)
- `POST /api/orders`: Submit custom tool manufacturing order
- `GET /api/orders/my-orders`: Retrieve logged-in buyer's orders
- `GET /api/orders`: Retrieve all global orders with status filter (Admin)
- `GET /api/orders/:id`: Detailed order summary & item breakdown
- `GET /api/orders/:id/pdf`: Download formatted export purchase order PDF
- `PATCH /api/orders/:id/status`: Update production & shipping status (Admin)
- `GET /api/orders/stats/summary`: Executive revenue & quantity metrics (Admin)
