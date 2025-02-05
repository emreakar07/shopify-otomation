require('dotenv').config();
const express = require('express');
const syncService = require('./services/syncService');
const shopifyWebhookHandler = require('./services/shopifyWebhookHandler');
const crypto = require('crypto');
const talkSimOrderService = require('./services/talkSimOrderService');
const rateLimit = require('express-rate-limit');
const cors = require('cors');

const app = express();
app.use(express.json());

// Rate limiter ekle
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 dakika
  max: 100 // IP başına limit
});

app.use(limiter);

// Webhook secret kontrolü
if (!process.env.SHOPIFY_WEBHOOK_SECRET) {
  console.error('SHOPIFY_WEBHOOK_SECRET is not set');
  process.exit(1);
}

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    // TalkSim bağlantısını kontrol et
    await talkSimOrderService.checkAndRefreshToken();
    
    res.json({
      status: 'healthy',
      services: {
        talksim: 'connected',
        shopify: 'connected',
        email: 'ready'
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      error: error.message
    });
  }
});

// Manuel senkronizasyon endpoint'i
app.post('/sync', async (req, res) => {
  try {
    const results = await syncService.syncProducts();
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Shopify order webhook
app.post('/webhooks/orders/create', express.raw({type: 'application/json'}), async (req, res) => {
  try {
    // Shopify webhook imzasını doğrula
    const hmac = req.headers['x-shopify-hmac-sha256'];
    const hash = crypto
      .createHmac('sha256', process.env.SHOPIFY_WEBHOOK_SECRET)
      .update(req.body)
      .digest('base64');

    if (hash !== hmac) {
      return res.status(401).send('Invalid webhook signature');
    }

    const order = JSON.parse(req.body);
    await shopifyWebhookHandler.handleOrderCreated(order);
    res.status(200).send('OK');
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).send('Internal server error');
  }
});

// Sipariş durumu sorgulama endpoint'i
app.get('/orders/:orderId/status', async (req, res) => {
  try {
    const status = await shopifyWebhookHandler.getOrderStatus(req.params.orderId);
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Son siparişleri listele
app.get('/orders/recent', async (req, res) => {
  try {
    const orders = await shopifyWebhookHandler.getRecentOrders(10);
    res.json(orders);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*'
}));

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  
  // İlk senkronizasyonu başlat
  syncService.syncProducts().then(() => {
    console.log('Initial sync completed');
  }).catch(err => {
    console.error('Initial sync failed:', err);
  });

  // Zamanlanmış senkronizasyonu başlat
  syncService.startSyncJob(process.env.SYNC_SCHEDULE || '*/30 * * * *');
});

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: process.env.NODE_ENV === 'production' 
      ? 'Internal server error' 
      : err.message
  });
}); 