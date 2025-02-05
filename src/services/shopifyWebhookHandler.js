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
      for (const item of order.line_items) {
        const packageId = item.sku.replace('ESIM-', '');
        const customerName = order.customer?.first_name 
          ? `${order.customer.first_name} ${order.customer.last_name}`
          : '';

        // Önce pending durumunda kayıt oluştur
        const { data: orderRecord, error: insertError } = await this.supabase
          .from('orders')
          .insert([{
            shopify_order_id: order.id,
            package_id: packageId,
            customer_email: order.email,
            customer_name: customerName,
            status: 'pending',
            created_at: new Date().toISOString()
          }])
          .select()
          .single();

        if (insertError) throw insertError;
        
        try {
          // TalkSim'den satın al
          const purchaseResult = await talkSimOrderService.purchaseESIM(
            packageId,
            order.email,
            customerName
          );

          // Başarılı satın alma durumunda kaydı güncelle
          const { error: updateError } = await this.supabase
            .from('orders')
            .update({
              status: 'completed',
              talksim_transaction_id: purchaseResult.transactionId,
              esim_details: purchaseResult.esimData,
              updated_at: new Date().toISOString()
            })
            .eq('id', orderRecord.id);

          if (updateError) throw updateError;

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
          // Hata durumunda kaydı güncelle
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
      console.error(`Order ${order.id} processing failed:`, error);
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