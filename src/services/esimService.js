const axios = require('axios');
require('dotenv').config();

class EsimService {
  constructor() {
    if (!process.env.API_BASE_URL) {
      throw new Error('API_BASE_URL is not defined in environment variables');
    }
    this.baseURL = process.env.API_BASE_URL;
  }

  async getPackages() {
    try {
      const url = `${this.baseURL}/package`;
      const response = await axios.get(url, {
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (response.data && response.data.status && response.data.status.code === 0) {
        const packages = response.data.listPrepaidPackageTemplate.template;
        // Sadece aktif (silinmemiş) paketleri döndür
        const activePackages = packages.filter(pkg => !pkg.deleted);
        console.log(`Fetched ${packages.length} packages (${activePackages.length} active)`);
        return activePackages;
      } else {
        throw new Error('Invalid API response structure');
      }
    } catch (error) {
      console.error('Error fetching packages:', {
        message: error.message,
        status: error.response?.status,
        data: error.response?.data
      });
      throw error;
    }
  }
}

module.exports = new EsimService(); 