import 'dotenv/config';
import app from './src/app.js';
import connectDB from './src/config/db.js';
import startPromotionCleaner from './src/utils/promotionCleaner.js';
import { initCronJobs } from './src/utils/cronJobs.js';
import { connectRedis } from './src/config/redis.js';
import { migratePromotionState } from './src/utils/migratePromotionState.js';
import { startTranslationQueuePoller } from './src/services/translation/translationQueuePoller.js';
import { seedLanguageConfigurations } from './src/services/translation/languageConfigurationService.js';

const port = process.env.PORT || 5000;

const startServer = async () => {
  await connectDB();
  await seedLanguageConfigurations();
  await migratePromotionState();
  await connectRedis();

  app.listen(port, () => {
    console.log(`Server is running on PORT: ${port}`);
    startPromotionCleaner();
    initCronJobs();
    startTranslationQueuePoller();
  });
};

startServer().catch((error) => {
  console.error('Server startup failed:', error);
  process.exit(1);
});
