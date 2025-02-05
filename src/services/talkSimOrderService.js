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
    this.headers = {
      'Content-Type': 'application/json'
    };
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

  // Auth token al
  async authenticate() {
    try {
      console.log('TalkSim auth başlatılıyor...');
      console.log('Base URL:', this.baseURL);
      
      if (!process.env.TALKSIM_IDENTIFIER || !process.env.TALKSIM_PASSWORD) {
        throw new Error('TalkSim credentials not found in environment variables');
      }

      console.log('Auth isteği yapılıyor:', {
        url: `${this.baseURL}/auth/local`,
        credentials: {
          identifier: process.env.TALKSIM_IDENTIFIER,
          // password'ü güvenlik için maskeliyoruz
          password: '********'
        }
      });
      
      const response = await axios.post(
        `${this.baseURL}/auth/local`,
        {
          identifier: process.env.TALKSIM_IDENTIFIER,
          password: process.env.TALKSIM_PASSWORD
        },
        {
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );

      console.log('Auth response:', {
        status: response.status,
        hasJWT: !!response.data?.jwt,
        data: response.data // JWT hariç diğer bilgiler
      });

      if (response.data && response.data.jwt) {
        console.log('TalkSim auth başarılı');
        this.token = response.data.jwt;
        this.headers.Authorization = `Bearer ${this.token}`;
        
        // Token'ın geçerlilik süresini ayarla (örn: 1 saat)
        this.tokenExpireTime = new Date().getTime() + (60 * 60 * 1000);
        
        return true;
      }

      throw new Error('Authentication failed: Invalid response');
    } catch (error) {
      console.error('TalkSim auth hatası:', {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status,
        url: `${this.baseURL}/auth/local`,
        headers: error.response?.headers
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
  async purchaseESIM(packageId, customerEmail, customerName = '', retryCount = 0) {
    await this.checkAndRefreshToken();

    try {
      const response = await axios.post(
        `${this.baseURL}/purchaseb2b`,
        {
          prepaidpackagetemplateid: packageId,
          email: customerEmail,
          customername: customerName || customerEmail.split('@')[0],
          notifyByEmail: true
        },
        { headers: this.headers }
      );

      if (!response.data || response.data.status?.code !== 0) {
        if (response.status === 401) {
          await this.authenticate();
          return this.purchaseESIM(packageId, customerEmail, customerName);
        }
        throw new TalkSimError(
          response.data?.status?.message || 'Satın alma işlemi başarısız',
          response.data?.status?.code,
          response.data
        );
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
      if (retryCount < 3 && error.code === 'NETWORK_ERROR') {
        await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
        return this.purchaseESIM(packageId, customerEmail, customerName, retryCount + 1);
      }
      console.error('eSIM satın alma hatası:', error.response?.data || error.message);
      if (error.response?.data?.status) {
        throw new TalkSimError(
          error.response.data.status.message,
          error.response.data.status.code,
          error.response.data
        );
      }
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