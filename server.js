import 'dotenv/config';
import app from './src/app.js';
import connectDB from './src/config/db.js';
import startPromotionCleaner from './src/utils/promotionCleaner.js';
import { initCronJobs } from './src/utils/cronJobs.js';

connectDB();

const port = process.env.PORT || 5000;

app.listen(port, () => {
  console.log(`Server is running on PORT: ${port}`);
  startPromotionCleaner();
  initCronJobs();
});
