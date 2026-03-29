/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  env: {
    GROQ_API_KEY: process.env.GROQ_API_KEY,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    NIM_API_KEY: process.env.NIM_API_KEY,
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,
    BUFFER_ACCESS_TOKEN: process.env.BUFFER_ACCESS_TOKEN,
    BUFFER_PROFILE_ID_INSTAGRAM: process.env.BUFFER_PROFILE_ID_INSTAGRAM,
    BUFFER_PROFILE_ID_TIKTOK: process.env.BUFFER_PROFILE_ID_TIKTOK,
    BUFFER_PROFILE_ID_FACEBOOK: process.env.BUFFER_PROFILE_ID_FACEBOOK,
    REPLICATE_API_TOKEN: process.env.REPLICATE_API_TOKEN,
    VERCEL_TOKEN: process.env.VERCEL_TOKEN,
    VERCEL_ORG_ID: process.env.VERCEL_ORG_ID,
    VERCEL_PROJECT_ID: process.env.VERCEL_PROJECT_ID,
    ROG_WORKER_URL: process.env.ROG_WORKER_URL,
    REDDIT_USER_AGENT: process.env.REDDIT_USER_AGENT,
    GHOSTMARKET_DB: process.env.GHOSTMARKET_DB,
    USE_LOCAL_MODEL: process.env.USE_LOCAL_MODEL,
    PROJECT_ROOT: process.env.PROJECT_ROOT || process.cwd().replace('/src/dashboard', ''),
  },
};
module.exports = nextConfig;
