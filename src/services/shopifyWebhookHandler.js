const talkSimOrderService = require('./talkSimOrderService');
const { createClient } = require('@supabase/supabase-js');

class ShopifyWebhookHandler {
  constructor() {
    this.supabase = createClient(
      process.env.SUPBASE_URL,
      process.env.SUPBASE_API_KEY
    );
  }

  async handleOrderCreated(order) {
    try {
      console.log('Processing order:', {
        id: order.id,
        items: order.line_items?.length
      });

      // Önce bu sipariş daha önce işlenmiş mi kontrol et
      const { data: existingOrder } = await this.supabase
        .from('orders')
        .select('*')
        .eq('shopify_order_id', order.id)
        .eq('status', 'completed')
        .maybeSingle();

      if (existingOrder) {
        console.log('Order already processed:', order.id);
        return { success: true, alreadyProcessed: true };
      }

      for (const item of order.line_items) {
        // SKU formatı: ESIM-131519
        const packageId = item.sku?.replace('ESIM-', '');
        
        console.log('Processing line item:', {
          sku: item.sku,
          packageId,
          title: item.title
        });

        // Önce bu line item için pending veya completed kayıt var mı kontrol et
        const { data: existingItem } = await this.supabase
          .from('orders')
          .select('*')
          .eq('shopify_order_id', order.id)
          .eq('package_id', packageId)
          .not('status', 'eq', 'error')
          .maybeSingle();

        if (existingItem) {
          console.log('Line item already processed:', packageId);
          continue;
        }

        // Yeni kayıt oluştur
        const { data: orderRecord, error: insertError } = await this.supabase
          .from('orders')
          .insert([{
            shopify_order_id: order.id,
            package_id: packageId,
            customer_email: order.email,
            customer_name: order.customer?.first_name 
              ? `${order.customer.first_name} ${order.customer.last_name}`
              : '',
            status: 'pending',
            created_at: new Date().toISOString()
          }])
          .select()
          .single();

        if (insertError) throw insertError;

        try {
          const purchaseResult = await talkSimOrderService.purchaseESIM(
            packageId,
            order.email,
            orderRecord.customer_name
          );

          // Başarılı satın alma durumunda güncelle
          await this.supabase
            .from('orders')
            .update({
              status: 'completed',
              talksim_transaction_id: purchaseResult.transactionId,
              esim_details: purchaseResult.esimData,
              updated_at: new Date().toISOString()
            })
            .eq('id', orderRecord.id);

          // Mail gönder
          await talkSimOrderService.sendESIMEmail(
            order.email,
            purchaseResult.esimData,
            {
              orderNumber: order.order_number,
              packageName: item.title
            }
          );

        } catch (error) {
          console.error('Purchase failed:', {
            orderId: order.id,
            packageId,
            error: error.message
          });

          await this.supabase
            .from('orders')
            .update({
              status: 'error',
              error_message: error.message,
              updated_at: new Date().toISOString()
            })
            .eq('id', orderRecord.id);

          throw error;
        }
      }

      return { success: true };
    } catch (error) {
      console.error('Order processing error:', error);
      throw error;
    }
  }

  // Sipariş durumunu sorgula
  async getOrderStatus(shopifyOrderId) {
    try {
      const { data, error } = await this.supabase
        .from('orders')
        .select('*')
        .eq('shopify_order_id', shopifyOrderId);

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Order status query error:', error);
      throw error;
    }
  }

  // Son X siparişi getir
  async getRecentOrders(limit = 10) {
    try {
      const { data, error } = await this.supabase
        .from('orders')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Recent orders query error:', error);
      throw error;
    }
  }
}

module.exports = new ShopifyWebhookHandler(); 