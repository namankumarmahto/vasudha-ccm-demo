# Vasudha backend (Supabase registration)

1. Copy `server/.env.example` to `.env` and fill:
   - SUPABASE_URL=https://yourproject.supabase.co
   - SUPABASE_SERVICE_ROLE=your-service-role-key
   - CORS_ORIGIN=http://localhost:8000
   - PORT=8787

2. Start server:
   cd server
   npm start

3. When deployed, host this server (Heroku/Vercel serverless/Render). The frontend will POST to /api/register.
