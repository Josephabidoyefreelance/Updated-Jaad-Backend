# Jaad Logistics Backend API

## Deploy to Railway

1. Push this folder to a GitHub repo
2. Connect repo to Railway
3. Add these environment variables in Railway dashboard:

MONGO_URI=mongodb+srv://Iamawinner:Iamawinner@cluster0.exrfvsr.mongodb.net/jaadlogistics?retryWrites=true&w=majority&authSource=admin
JWT_SECRET=jaad_super_secret_key_2026_joseph
ADMIN_PASS=jaad2026
EMAIL_USER=info@jaadlogistics.com
EMAIL_PASS=your_gmail_app_password

## API Endpoints
- POST /api/auth/register
- POST /api/auth/login
- GET  /api/auth/me
- POST /api/orders
- GET  /api/orders
- GET  /api/orders/track/:tn
- GET  /api/trucks
- POST /api/trucks
- GET  /api/jobs
- POST /api/topups
- GET  /api/health
