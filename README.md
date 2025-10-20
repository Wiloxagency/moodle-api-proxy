# Moodle API Proxy

A TypeScript/Express.js API proxy server that interfaces with Moodle Web Services, providing a clean and secure way to access Moodle data from frontend applications.

## Features

- 🚀 **TypeScript**: Full TypeScript support with strict type checking
- 🛡️ **Security**: Helmet.js for security headers, CORS configuration
- 🔥 **Error Handling**: Comprehensive error handling with detailed logging
- 📊 **Health Monitoring**: Built-in health check endpoints
- 🌍 **Environment Configuration**: Flexible environment-based configuration
- 📝 **API Documentation**: Self-documenting endpoints

## Quick Start

### Prerequisites

- Node.js (v16 or higher)
- npm or yarn
- Access to a Moodle instance with Web Services enabled

### Installation

1. **Clone/Navigate to the project directory**
   ```bash
   cd moodle-api-proxy
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment variables**
   ```bash
   cp .env.example .env
   ```
   
   Edit the `.env` file with your Moodle configuration:
   ```env
   MOODLE_BASE_URL=https://your-moodle-site.com
   MOODLE_WS_TOKEN=your-webservice-token
   PORT=3000
   NODE_ENV=development
   ```

4. **Start the development server**
   ```bash
   npm run dev
   ```

5. **Build for production**
   ```bash
   npm run build
   npm start
   ```

## API Endpoints

### Base URL
```
http://localhost:3000
```

### Available Endpoints

#### 1. Health Check
```http
GET /api/health
```
Tests connectivity to Moodle and returns server status.

#### 2. Get All Categories
```http
GET /api/categorias
```
Retrieves all categories or filters by parent ID.

**Examples:**
```bash
# Get all categories
curl http://localhost:3000/api/categorias

# Get root categories (parent = 0)
curl http://localhost:3000/api/categorias?parent=0

# Get subcategories of category 5
curl http://localhost:3000/api/categorias?parent=5
```

#### 3. Get Root Categories
```http
GET /api/categorias/raiz
```
Retrieves only root categories (parent = 0).

**Example:**
```bash
curl http://localhost:3000/api/categorias/raiz
```

**Response:**
```json
{
  "success": true,
  "data": {
    "parentId": 0,
    "categories": [
      {
        "id": 1,
        "name": "Category Name",
        "parent": 0,
        "coursecount": 10,
        "visible": 1,
        "description": "Category description",
        ...
      }
    ],
    "total": 3,
    "warnings": []
  }
}
```

#### 4. Get Courses by Category
```http
GET /api/cursos/categoria/:id
```
Retrieves all courses from a specific category.

**Example:**
```bash
curl http://localhost:3000/api/cursos/categoria/57
```

**Response:**
```json
{
  "success": true,
  "data": {
    "categoryId": 57,
    "courses": [...],
    "total": 5,
    "warnings": []
  }
}
```

#### 5. Get Courses by Field
```http
GET /api/cursos/field/:field/:value
```
Retrieves courses filtered by any supported field.

**Supported fields:** `category`, `id`, `shortname`, `idnumber`, `visible`

**Example:**
```bash
curl http://localhost:3000/api/cursos/field/category/57
```

#### 6. API Documentation
```http
GET /api
```
Returns API documentation and available endpoints.

## Project Structure

```
src/
├── config/
│   └── environment.ts      # Environment configuration
├── controllers/
│   └── coursesController.ts # Route handlers
├── middleware/
│   └── errorHandler.ts     # Error handling middleware
├── services/
│   └── moodleService.ts    # Moodle API integration
├── types/
│   └── moodle.ts          # TypeScript interfaces
├── routes/
│   └── index.ts           # API routes
├── app.ts                 # Express app configuration
└── index.ts              # Server entry point
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `MOODLE_BASE_URL` | Your Moodle site URL | Required |
| `MOODLE_WS_TOKEN` | Moodle Web Service token | Required |
| `PORT` | Server port | 3000 |
| `NODE_ENV` | Environment mode | development |
| `ALLOWED_ORIGINS` | CORS allowed origins | localhost:3000,localhost:3001 |

## Scripts

- `npm run dev` - Start development server with auto-reload
- `npm run build` - Build for production
- `npm start` - Start production server
- `npm run lint` - Run ESLint
- `npm test` - Run tests

## Moodle Configuration

To use this proxy, you need:

1. **Web Services enabled** in your Moodle instance
2. **A valid web service token** with appropriate permissions
3. **Access to the following Moodle functions:**
   - `core_course_get_courses_by_field`
   - `core_course_get_categories`
   - `core_webservice_get_site_info`

### Getting a Moodle Web Service Token

1. Log in to your Moodle site as an administrator
2. Go to **Site Administration > Server > Web services**
3. Enable web services and create a token
4. Assign the token to a user with appropriate permissions

## Error Handling

The API returns consistent error responses:

```json
{
  "success": false,
  "error": {
    "message": "Error description",
    "code": "error_code",
    "details": {...}
  }
}
```

Common HTTP status codes:
- `400` - Bad Request (invalid parameters)
- `401` - Unauthorized (invalid token)
- `404` - Not Found (endpoint not found)
- `500` - Internal Server Error
- `503` - Service Unavailable (Moodle connection failed)

## Security Features

- **Helmet.js** for security headers
- **CORS** configuration with origin validation
- **Request size limits** (10MB max)
- **Input validation** and sanitization
- **Error message sanitization** in production

## Development

### Adding New Endpoints

1. Define types in `src/types/moodle.ts`
2. Add service methods in `src/services/moodleService.ts`
3. Create controller methods in `src/controllers/`
4. Add routes in `src/routes/index.ts`

### Testing

```bash
# Test the health endpoint
curl http://localhost:3000/api/health

# Test courses by category
curl http://localhost:3000/api/cursos/categoria/57

# Test with error handling
curl http://localhost:3000/api/cursos/categoria/invalid
```

## License

MIT License

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## Support

For issues and questions:
1. Check the logs for detailed error messages
2. Verify Moodle connectivity and token permissions
3. Review the API documentation at `/api`
