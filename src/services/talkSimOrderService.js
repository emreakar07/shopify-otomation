const axios = require('axios');
const nodemailer = require('nodemailer');

class TalkSimError extends Error {
  constructor(message, code, details) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

class TalkSimOrderService {
  constructor() {
    this.baseURL = process.env.APP_URL;
    this.endpoints = {
      auth: '/api/auth/local',
      purchase: '/api/purchaseb2b'
    };

    // Credentials kontrolü
    if (!process.env.TALKSIM_IDENTIFIER || !process.env.TALKSIM_PASSWORD) {
      throw new Error('TalkSim credentials not found');
    }

    // Axios instance
    this.axiosInstance = axios.create({
      baseURL: this.baseURL,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });

    // Debug için request interceptor
    this.axiosInstance.interceptors.request.use(config => {
      console.log('Request:', {
        method: config.method?.toUpperCase(),
        url: `${config.baseURL}${config.url}`,
        headers: config.headers,
        data: config.data
      });
      return config;
    });

    this.token = null;
    this.tokenExpireTime = null;

    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT,
      secure: true,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });
  }

  async authenticate() {
    try {
      // Auth endpoint'ini tam URL ile kullanalım
      const response = await this.axiosInstance.post(this.endpoints.auth, {
        identifier: process.env.TALKSIM_IDENTIFIER,
        password: process.env.TALKSIM_PASSWORD
      });

      console.log('Auth response:', {
        status: response.status,
        data: response.data
      });

      if (response.data?.jwt) {
        this.token = response.data.jwt;
        this.axiosInstance.defaults.headers['Authorization'] = `Bearer ${this.token}`;
        this.tokenExpireTime = new Date().getTime() + (60 * 60 * 1000);
        return true;
      }

      throw new Error('No JWT in response');
    } catch (error) {
      console.error('Auth failed:', {
        message: error.message,
        status: error.response?.status,
        data: error.response?.data,
        url: `${this.baseURL}${this.endpoints.auth}`
      });
      throw error;
    }
  }

  // Token'ın geçerliliğini kontrol et
  async checkAndRefreshToken() {
    const now = new Date().getTime();
    
    // Token yoksa veya süresi dolmuşsa yenile
    if (!this.token || !this.tokenExpireTime || now >= this.tokenExpireTime) {
      await this.authenticate();
    }
  }

  // eSIM satın al
  async purchaseESIM(packageId, customerEmail, customerName = '') {
    try {
      await this.checkAndRefreshToken();

      console.log('Purchasing eSIM:', {
        packageId,
        customerEmail,
        customerName
      });

      // API'nin beklediği formatta data
      const requestData = {
        data: {
          packageId: packageId.toString(), // String olarak gönder
          price: 0,
          dealerId: process.env.TALKSIM_DEALER_ID || "",
          packageName: "",  // API doldurur
          status: "",       // API doldurur
          customerName: customerName || customerEmail.split('@')[0]
        }
      };

      console.log('Purchase request:', requestData);

      const response = await this.axiosInstance.post(this.endpoints.purchase, requestData);

      console.log('Purchase response:', {
        status: response.status,
        data: response.data
      });

      if (!response.data || response.data.status?.code !== 0) {
        throw new Error(response.data?.status?.message || 'Purchase failed');
      }

      return {
        success: true,
        esimData: {
          qrCode: response.data.qrcode,
          activationCode: response.data.activationcode,
          iccid: response.data.iccid,
          packageDetails: {
            name: response.data.packagename,
            data: response.data.databyte,
            validity: response.data.validitydays,
            network: response.data.networkname
          }
        },
        transactionId: response.data.transactionid
      };

    } catch (error) {
      console.error('Purchase error:', {
        message: error.message,
        response: error.response?.data,
        packageId,
        customerEmail
      });
      throw error;
    }
  }

  // Müşteriye eSIM bilgilerini mail at
  async sendESIMEmail(customerEmail, esimData, orderDetails) {
    const template = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; }
          .qr-code { max-width: 300px; }
          .details { background: #f5f5f5; padding: 15px; }
          .instructions { margin-top: 20px; }
        </style>
      </head>
      <body>
        <h2>eSIM Paketiniz Hazır!</h2>
        
        <div class="qr-code">
          <img src="data:image/png;base64,${esimData.qrCode}" alt="eSIM QR Code" style="width: 100%"/>
        </div>

        <div class="details">
          <h3>📱 eSIM Bilgileri</h3>
          <p><strong>Aktivasyon Kodu:</strong> ${esimData.activationCode}</p>
          <p><strong>ICCID:</strong> ${esimData.iccid}</p>
        </div>

        <div class="package-info">
          <h3>📦 Paket Detayları</h3>
          <p><strong>Paket:</strong> ${esimData.packageDetails.name}</p>
          <p><strong>Data:</strong> ${(esimData.packageDetails.data / (1024 * 1024 * 1024)).toFixed(2)} GB</p>
          <p><strong>Süre:</strong> ${esimData.packageDetails.validity} gün</p>
          <p><strong>Operatör:</strong> ${esimData.packageDetails.network}</p>
        </div>

        <div class="instructions">
          <h3>📝 Kurulum Adımları</h3>
          <ol>
            <li>Ayarlar > Hücresel'e gidin</li>
            <li>eSIM Ekle'yi seçin</li>
            <li>QR kodu tarayın veya kodu girin</li>
            <li>Aktivasyonu onaylayın</li>
          </ol>
        </div>

        <p style="color: #666;">Referans No: ${esimData.transactionId}</p>
        <p style="color: #666;">Destek için: support@netesim.com</p>
      </body>
      </html>
    `;

    await this.transporter.sendMail({
      from: `"${process.env.EMAIL_FROM_NAME}" <${process.env.EMAIL_FROM_ADDRESS}>`,
      to: customerEmail,
      subject: '🌍 eSIM Paketiniz Hazır!',
      html: template
    });
  }
}

module.exports = new TalkSimOrderService(); 