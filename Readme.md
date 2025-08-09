# CrowdRepair Backend

This is the backend for the **CrowdRepair** platform, built with Node.js, Express, MongoDB, and Redis.  
It provides APIs for authentication, report management, comments, upvotes, admin dashboards, and a heatmap feed.

## Features
- User registration, login, email verification, and password reset
- JWT-based authentication
- Create, view, update, and delete reports
- Add/delete comments and upvote reports
- Admin dashboard with stats and report management
- Heatmap data for frontend map display
- Image upload with `multer`
- Caching with Redis

## Tech Stack
- Node.js + Express
- MongoDB + Mongoose
- Redis
- Multer for uploads
- JWT for authentication

## Setup
1. **Clone the repo**
   ```bash
   git clone <repo-url>
   cd backend
