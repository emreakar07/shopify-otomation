const axios = require('axios');
require('dotenv').config();

class ShopifyService {
  constructor() {
    if (!process.env.SHOP_NAME || !process.env.SHOPIFY_ACCESS_TOKEN) {
      throw new Error('Missing required environment variables: SHOP_NAME or SHOPIFY_ACCESS_TOKEN');
    }

    this.baseURL = `https://${process.env.SHOP_NAME.replace('.myshopify.com', '')}.myshopify.com/admin/api/2024-01`;
    this.headers = {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN
    };

    console.log('Shop Name:', process.env.SHOP_NAME);
    console.log('Shopify API URL:', `${this.baseURL}/products.json`);
    console.log('Headers:', {
      ...this.headers,
      'X-Shopify-Access-Token': 'shpat_****'
    });
  }

  async createProduct(packageData) {
    try {
      const countryName = packageData.userUiName ? packageData.userUiName.replace('_LZ', '') : 'Unknown';
      const dataGB = packageData.databyte ? (packageData.databyte / (1024 * 1024 * 1024)).toFixed(2) : '0';
      const sponsorName = packageData.sponsors?.sponsorname || 'Unknown';

      const response = await axios.post(
        `${this.baseURL}/products.json`,
        {
          product: {
            title: `${countryName} eSIM Package`,
            body_html: `
              <strong>Ülke:</strong> ${countryName}<br>
              <strong>Sponsor:</strong> ${sponsorName}<br>
              <p>Farklı data paketleri için seçenekleri kontrol edin.</p>
            `,
            vendor: sponsorName,
            product_type: 'eSIM',
            status: 'active',
            options: [
              {
                name: "Data Package",
                values: [`${dataGB}GB / ${packageData.perioddays} Days`]
              }
            ],
            variants: [{
              option1: `${dataGB}GB / ${packageData.perioddays} Days`,
              price: packageData.cost || 0,
              sku: `ESIM-${packageData.prepaidpackagetemplateid}`,
              inventory_management: 'shopify',
              inventory_policy: 'continue',
              inventory_quantity: 999,
              requires_shipping: false
            }],
            tags: [
              'eSIM',
              countryName
            ]
          }
        },
        { headers: this.headers }
      );

      return response.data.product;
    } catch (error) {
      console.error('Error creating product:', error.response?.data || error.message);
      throw error;
    }
  }

  async createBulkProducts(packages) {
    try {
      const results = [];
      const errors = [];

      // Paketleri ülkeye göre grupla
      const groupedPackages = packages.reduce((acc, pkg) => {
        const country = pkg.userUiName ? pkg.userUiName.replace('_LZ', '') : 'Unknown';
        if (!acc[country]) {
          acc[country] = [];
        }
        acc[country].push(pkg);
        return acc;
      }, {});

      // Her ülke için tek ürün oluştur
      for (const [country, countryPackages] of Object.entries(groupedPackages)) {
        try {
          // Varyantları oluştur
          const variants = countryPackages.map(pkg => {
            const dataGB = pkg.databyte ? (pkg.databyte / (1024 * 1024 * 1024)).toFixed(2) : '0';
            return {
              option1: `${dataGB}GB / ${pkg.perioddays} Days`,
              price: pkg.cost || 0,
              sku: `ESIM-${pkg.prepaidpackagetemplateid}`,
              inventory_management: 'shopify',
              inventory_policy: 'continue',
              inventory_quantity: 999,
              requires_shipping: false
            };
          });

          // Sponsor bilgisini al (hepsi aynı sponsor olmalı)
          const sponsorName = countryPackages[0].sponsors?.sponsorname || 'Unknown';

          // Ürünü oluştur
          const response = await axios.post(
            `${this.baseURL}/products.json`,
            {
              product: {
                title: `${country} eSIM Package`,
                body_html: `
                  <strong>Ülke:</strong> ${country}<br>
                  <strong>Sponsor:</strong> ${sponsorName}<br>
                  <p>Farklı data paketleri için seçenekleri kontrol edin.</p>
                `,
                vendor: sponsorName,
                product_type: 'eSIM',
                status: 'active',
                options: [
                  {
                    name: "Data Package",
                    values: variants.map(v => v.option1)
                  }
                ],
                variants: variants,
                tags: [
                  'eSIM',
                  country,
                  sponsorName,
                  'auto-sync'
                ]
              }
            },
            { headers: this.headers }
          );

          results.push({
            country,
            productId: response.data.product.id,
            variantCount: variants.length,
            status: 'success'
          });

        } catch (error) {
          errors.push({
            country,
            error: error.response?.data || error.message,
            status: 'error'
          });
        }
      }

      return {
        success: results,
        errors: errors,
        total: Object.keys(groupedPackages).length,
        successCount: results.length,
        errorCount: errors.length
      };

    } catch (error) {
      console.error('Bulk product creation error:', error);
      throw error;
    }
  }

  async getAllProducts() {
    try {
      const response = await axios.get(`${this.baseURL}/products.json`, {
        headers: this.headers
      });
      return response.data.products;
    } catch (error) {
      console.error('Error fetching products:', error);
      throw error;
    }
  }

  async deleteProduct(productId) {
    try {
      await axios.delete(`${this.baseURL}/products/${productId}.json`, {
        headers: this.headers
      });
    } catch (error) {
      console.error('Error deleting product:', error);
      throw error;
    }
  }
}

module.exports = new ShopifyService(); 