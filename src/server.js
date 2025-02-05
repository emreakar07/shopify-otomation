require('dotenv').config();
const express = require('express');
const syncService = require('./services/syncService');
const shopifyWebhookHandler = require('./services/shopifyWebhookHandler');
const crypto = require('crypto');
const talkSimOrderService = require('./services/talkSimOrderService');
const rateLimit = require('express-rate-limit');
const cors = require('cors');

const app = express();

// CORS ayarlarını en üste al
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*'
}));

// Webhook için raw body parser
app.use('/webhooks/orders/create', express.raw({type: 'application/json'}));

// Diğer routelar için JSON parser
app.use(express.json());

// Rate limiter
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100
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
app.post('/webhooks/orders/create', async (req, res) => {
  console.log('🔔 Webhook received:', {
    headers: req.headers,
    body: req.body.toString()
  });
  
  try {
    const hmac = req.headers['x-shopify-hmac-sha256'];
    const body = req.body; // Buffer olarak gelecek
    
    const hash = crypto
      .createHmac('sha256', process.env.SHOPIFY_WEBHOOK_SECRET)
      .update(body)
      .digest('base64');

    if (hash !== hmac) {
      console.log('❌ Invalid signature:', { received: hmac, calculated: hash });
      return res.status(401).send('Invalid signature');
    }

    const order = JSON.parse(body);
    console.log('📦 Processing order:', order.id);

    await shopifyWebhookHandler.handleOrderCreated(order);
    console.log('✅ Order processed successfully');
    
    res.status(200).send('OK');
  } catch (error) {
    console.log('❌ Error:', error);
    res.status(500).send(error.message);
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

// Root endpoint
app.get('/', (req, res) => {
  console.log('Root endpoint hit at:', new Date().toISOString());
  res.json({
    message: 'NeteSIM API is running',
    version: '1.0.0',
    endpoints: {
      health: '/health',
      sync: '/sync',
      webhook: '/webhooks/orders/create',
      orderStatus: '/orders/:orderId/status',
      recentOrders: '/orders/recent'
    }
  });
});

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