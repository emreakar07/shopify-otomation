const cron = require('node-cron');
const esimService = require('./esimService');
const shopifyService = require('./shopifyService');
const { createClient } = require('@supabase/supabase-js');

class SyncService {
  constructor() {
    this.syncJob = null;
    this.isSyncing = false;
    this.lastSync = new Map();

    // Supabase client'ı başlat
    this.supabase = createClient(
      process.env.SUPBASE_URL,
      process.env.SUPBASE_API_KEY
    );
  }

  hasPackageChanged(oldPkg, newPkg) {
    if (!oldPkg) return true;

    return (
      oldPkg.cost !== newPkg.cost ||
      oldPkg.databyte !== newPkg.databyte ||
      oldPkg.perioddays !== newPkg.perioddays ||
      oldPkg.prepaidpackagetemplatename !== newPkg.prepaidpackagetemplatename ||
      oldPkg.userUiName !== newPkg.userUiName ||
      oldPkg.sponsors?.sponsorname !== newPkg.sponsors?.sponsorname ||
      oldPkg.deleted !== newPkg.deleted
    );
  }

  // Senkronizasyon loglarını Supabase'e kaydet
  async logSyncResults(results, error = null) {
    try {
      const logData = {
        sync_time: new Date().toISOString(),
        total_packages: results.total || 0,
        updated_packages: results.success?.length || 0,
        deleted_packages: results.deleted?.length || 0,
        error_count: (results.errors?.length || 0) + (results.deleteErrors?.length || 0),
        unchanged_packages: results.unchanged || 0,
        details: {
          success: results.success || [],
          errors: results.errors || [],
          deleted: results.deleted || [],
          deleteErrors: results.deleteErrors || []
        },
        status: error ? 'error' : 'success',
        error_message: error ? error.message : null
      };

      console.log('Supabase log kaydı yapılıyor:', logData);

      const { data, error: dbError } = await this.supabase
        .from('shopify_sync_logs')
        .insert([logData]);

      if (dbError) {
        console.error('Supabase log hatası:', dbError);
      } else {
        console.log('Senkronizasyon logu başarıyla kaydedildi');
      }
    } catch (err) {
      console.error('Log kaydetme hatası:', err.message);
    }
  }

  async syncProducts() {
    if (this.isSyncing) {
      console.log('Senkronizasyon zaten devam ediyor...');
      return;
    }

    this.isSyncing = true;
    let syncResults = {
      total: 0,
      success: [],
      errors: [],
      deleted: [],
      deleteErrors: [],
      unchanged: 0
    };

    try {
      console.log('Paket senkronizasyonu başlatılıyor...');
      
      // Aktif paketleri al
      const currentPackages = await esimService.getPackages();
      console.log(`${currentPackages.length} aktif paket bulundu`);

      // Shopify'daki mevcut ürünleri al
      const shopifyProducts = await shopifyService.getAllProducts();
      console.log(`Shopify'da ${shopifyProducts.length} ürün bulundu`);

      // Silinecek ürünleri bul (eSIM'de olmayan ama Shopify'da olan)
      const productsToDelete = shopifyProducts.filter(product => {
        // SKU kontrolü ekleyelim
        const productSku = product.variants?.[0]?.sku || '';
        return !currentPackages.some(pkg => 
          pkg.prepaidpackagetemplateid.toString() === productSku.replace('ESIM-', '')
        );
      });

      // Güncellenecek paketleri bul
      const packagesToUpdate = currentPackages.filter(pkg => 
        this.hasPackageChanged(this.lastSync.get(pkg.prepaidpackagetemplateid), pkg)
      );

      console.log(`${packagesToUpdate.length} yeni/değişen paket, ${productsToDelete.length} silinecek ürün bulundu`);

      const results = {
        success: [],
        errors: [],
        deleted: [],
        deleteErrors: [],
        total: packagesToUpdate.length,
        unchanged: currentPackages.length - packagesToUpdate.length
      };

      // Silinecek ürünleri işle
      for (const product of productsToDelete) {
        try {
          await shopifyService.deleteProduct(product.id);
          results.deleted.push(product.id);
          console.log(`Ürün silindi: ${product.title} (${product.id})`);
        } catch (error) {
          results.deleteErrors.push({ id: product.id, error: error.message });
          console.error(`Ürün silinemedi: ${product.title}`, error);
        }
      }

      // Daha küçük batch'ler halinde işle
      const batchSize = 5;
      for (let i = 0; i < packagesToUpdate.length; i += batchSize) {
        const batch = packagesToUpdate.slice(i, i + batchSize);
        console.log(`${i + 1} - ${i + batch.length} arası paketler işleniyor...`);
        
        try {
          const batchResult = await shopifyService.createBulkProducts(batch);
          results.success.push(...batchResult.success);
          results.errors.push(...batchResult.errors);

          // Her batch arasında 2 saniye bekle
          if (i + batchSize < packagesToUpdate.length) {
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        } catch (error) {
          console.error(`Batch ${i}-${i+batchSize} error:`, error);
          results.errors.push(error);
        }
      }

      // Başarılı işlemleri cache'e kaydet
      results.success.forEach(result => {
        const pkg = packagesToUpdate.find(p => p.prepaidpackagetemplateid === result.packageId);
        if (pkg) {
          this.lastSync.set(pkg.prepaidpackagetemplateid, pkg);
        }
      });

      console.log('Senkronizasyon tamamlandı:', {
        total: currentPackages.length,
        updated: results.success.length,
        errors: results.errors.length,
        deleted: results.deleted.length,
        deleteErrors: results.deleteErrors.length,
        unchanged: results.unchanged,
        timestamp: new Date().toISOString()
      });

      if (results.errors.length > 0 || results.deleteErrors.length > 0) {
        console.log('Hatalar:', {
          updateErrors: results.errors,
          deleteErrors: results.deleteErrors
        });
      }

      // Sonuçları logla
      await this.logSyncResults(results);

      return results;

    } catch (error) {
      console.error('Senkronizasyon hatası:', error);
      // Hata durumunu da logla
      await this.logSyncResults(syncResults, error);
      throw error;
    } finally {
      this.isSyncing = false;
    }
  }

  startSyncJob(schedule) {
    if (this.syncJob) {
      this.syncJob.stop();
    }

    console.log('Otomatik senkronizasyon başlatıldı. Schedule:', schedule);

    this.syncJob = cron.schedule(schedule, async () => {
      try {
        await this.syncProducts();
      } catch (error) {
        console.error('Zamanlanmış senkronizasyon hatası:', error);
      }
    });
  }

  stopSyncJob() {
    if (this.syncJob) {
      this.syncJob.stop();
      this.syncJob = null;
      console.log('Senkronizasyon durduruldu');
    }
  }
}

module.exports = new SyncService(); 