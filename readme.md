# eSIM Shopify Integration Service

TalkSim eSIM paketlerini Shopify ile entegre eden ve otomatik satın alma sürecini yöneten servis.

## Özellikler

### 1. Paket Senkronizasyonu
- TalkSim'den paketleri otomatik çeker
- Shopify'da ürünleri günceller/oluşturur
- Her 30 dakikada bir otomatik senkronizasyon
- Manuel senkronizasyon endpoint'i

### 2. Sipariş İşleme
- Shopify webhook ile siparişleri alır
- TalkSim'den eSIM satın alır
- Müşteriye QR kod ve aktivasyon bilgilerini mail atar
- Sipariş durumlarını Supabase'de takip eder

### 3. API Endpoints
- `GET /health` - Servis durumu
- `GET /api/shopify/sync` - Manuel senkronizasyon tetikleme

## Kurulum
1. Repository'yi klonlayın
2. Bağımlılıkları yükleyin: `npm install`
3. `.env` dosyasını oluşturun
4. Başlatın: `npm start`

## Environment Variables

env
NODE_ENV=production
SHOP_NAME=your-shop.myshopify.com
SHOPIFY_ACCESS_TOKEN=your-access-token
API_BASE_URL=your-api-url
SYNC_SCHEDULE="/30 "
PORT=3000

## Deployment
DigitalOcean App Platform üzerinde `app.yaml` konfigürasyonu ile deploy edilir.