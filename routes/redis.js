import express from 'express';
import redisClient from '../utils/redisClient.js';

const router = express.Router();

router.get('/ping-redis', async (req, res) => {
  await redisClient.set('testkey', 'Hello Redis!');
  const val = await redisClient.get('testkey');
  res.send(`Redis says: ${val}`);
});

export default router;
