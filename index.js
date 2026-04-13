// ClaimSolver Backend - Production Ready
// Railway.app deployment

const express = require('express');
const cors = require('cors');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// File upload configuration
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Sadece PDF dosyaları kabul edilir'));
    }
  }
});

// Environment Variables
const CONFIG = {
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID || '',
  RESEND_API_KEY: process.env.RESEND_API_KEY || ''
};

// Simple in-memory database (temporary)
const submissions = [];

// Telegram notification
async function sendTelegramNotification(data) {
  if (!CONFIG.TELEGRAM_BOT_TOKEN || !CONFIG.TELEGRAM_CHAT_ID) {
    console.log('⚠️ Telegram not configured');
    return;
  }

  const message = `
🔔 YENİ BAŞVURU

👤 ${data.name}
${data.company ? `🏢 ${data.company}` : ''}
📧 ${data.email}
${data.phone ? `📞 ${data.phone}` : ''}

📋 Hizmet: ${data.serviceType}

📝 Açıklama:
${data.description ? data.description.substring(0, 200) + (data.description.length > 200 ? '...' : '') : 'Belirtilmedi'}

${data.hasFile ? '📎 Dosya: ' + data.fileName : '⚠️ Dosya yok'}

━━━━━━━━━━━━━━━━━━━━
⏰ ${new Date().toLocaleString('tr-TR')}
ID: ${data.id}
  `.trim();

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${CONFIG.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: CONFIG.TELEGRAM_CHAT_ID,
          text: message
        })
      }
    );

    if (response.ok) {
      console.log('✅ Telegram notification sent');
    } else {
      console.error('❌ Telegram failed:', await response.text());
    }
  } catch (error) {
    console.error('❌ Telegram error:', error.message);
  }
}

// Email sender using Resend
async function sendEmail(to, subject, html) {
  if (!CONFIG.RESEND_API_KEY) {
    console.log('⚠️ Resend not configured');
    console.log('Email would be sent to:', to);
    console.log('Subject:', subject);
    return;
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CONFIG.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'ClaimSolver <info@claimsolver.co>',
        to: [to],
        subject: subject,
        html: html
      })
    });

    if (response.ok) {
      console.log('✅ Email sent via Resend');
    } else {
      console.error('❌ Resend failed:', await response.text());
    }
  } catch (error) {
    console.error('❌ Email error:', error.message);
  }
}

// Email template
function getConfirmationEmailHTML(data, lang = 'tr') {
  if (lang === 'tr') {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #1e3a8a 0%, #0f172a 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f8fafc; padding: 30px; border-radius: 0 0 10px 10px; }
          .footer { text-align: center; margin-top: 30px; color: #64748b; font-size: 14px; }
          .highlight { background: #dbeafe; padding: 15px; border-left: 4px solid #1e3a8a; border-radius: 4px; margin: 20px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Başvurunuz Alındı 🎯</h1>
          </div>
          <div class="content">
            <p>Sayın <strong>${data.name}</strong>,</p>
            
            <p>ClaimSolver'a başvurunuz için teşekkür ederiz. Dosyanız uzman ekibimize ulaştı ve inceleme sürecine alındı.</p>
            
            <h3>📋 Başvuru Detayları:</h3>
            <ul>
              <li><strong>Hizmet Türü:</strong> ${data.serviceType}</li>
              ${data.company ? `<li><strong>Şirket:</strong> ${data.company}</li>` : ''}
              <li><strong>Email:</strong> ${data.email}</li>
              ${data.phone ? `<li><strong>Telefon:</strong> ${data.phone}</li>` : ''}
            </ul>

            <div class="highlight">
              <h3>⏰ Sonraki Adımlar:</h3>
              <ol>
                <li>Uzman ekibimiz dosyanızı 24 saat içinde detaylı olarak inceleyecek</li>
                <li>Size kapsamlı analiz raporu göndereceğiz</li>
                <li>Sorularınız için info@claimsolver.co adresinden bize ulaşabilirsiniz</li>
              </ol>
            </div>

            <p style="margin-top: 30px;">
              <strong>💡 İlk analiz tamamen ücretsizdir.</strong> Detaylı raporlar ve hukuki destek için fiyatlandırma durumunuza göre belirlenecektir.
            </p>

            <div class="footer">
              <p><strong>ClaimSolver</strong><br>
              AI Destekli Sigorta Hukuku Danışmanlığı</p>
              <p>📧 info@claimsolver.co | 🌐 claimsolver.co</p>
            </div>
          </div>
        </div>
      </body>
      </html>
    `;
  } else {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #1e3a8a 0%, #0f172a 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f8fafc; padding: 30px; border-radius: 0 0 10px 10px; }
          .footer { text-align: center; margin-top: 30px; color: #64748b; font-size: 14px; }
          .highlight { background: #dbeafe; padding: 15px; border-left: 4px solid #1e3a8a; border-radius: 4px; margin: 20px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Application Received 🎯</h1>
          </div>
          <div class="content">
            <p>Dear <strong>${data.name}</strong>,</p>
            
            <p>Thank you for your application to ClaimSolver. Your file has been received and is under review.</p>
            
            <h3>📋 Application Details:</h3>
            <ul>
              <li><strong>Service Type:</strong> ${data.serviceType}</li>
              ${data.company ? `<li><strong>Company:</strong> ${data.company}</li>` : ''}
              <li><strong>Email:</strong> ${data.email}</li>
              ${data.phone ? `<li><strong>Phone:</strong> ${data.phone}</li>` : ''}
            </ul>

            <div class="highlight">
              <h3>⏰ Next Steps:</h3>
              <ol>
                <li>Our expert team will review your file within 24 hours</li>
                <li>We will send you a comprehensive analysis report</li>
                <li>Contact us at info@claimsolver.co for questions</li>
              </ol>
            </div>

            <p style="margin-top: 30px;">
              <strong>💡 Initial analysis is completely free.</strong> Pricing for detailed reports will be determined based on your case.
            </p>

            <div class="footer">
              <p><strong>ClaimSolver</strong><br>
              AI-Powered Insurance Law Consulting</p>
              <p>📧 info@claimsolver.co | 🌐 claimsolver.co</p>
            </div>
          </div>
        </div>
      </body>
      </html>
    `;
  }
}

// Main endpoint: Form submission
app.post('/api/submit-claim', upload.single('file'), async (req, res) => {
  try {
    const { name, company, email, phone, serviceType, description, language } = req.body;
    const file = req.file;

    console.log('📝 New submission:', { name, email, serviceType });

    // Validate
    if (!name || !email || !serviceType) {
  console.log('Validation failed:', { name, email, serviceType, description });
  return res.status(400).json({
    success: false,
    error: 'Zorunlu alanlar eksik'
  });
}

    // Create submission
    const submission = {
      id: Date.now().toString(),
      name,
      company: company || '',
      email,
      phone: phone || '',
      serviceType,
      description,
      hasFile: !!file,
      fileName: file ? file.originalname : null,
      fileSize: file ? file.size : null,
      language: language || 'tr',
      timestamp: new Date().toISOString(),
      status: 'pending'
    };

    submissions.push(submission);

    // Send notifications (non-blocking)
    Promise.all([
      sendTelegramNotification(submission),
      sendEmail(
        email,
        language === 'en' ? 'Application Received - ClaimSolver' : 'Başvurunuz Alındı - ClaimSolver',
        getConfirmationEmailHTML(submission, language || 'tr')
      )
    ]).catch(err => console.error('Notification error:', err));

    console.log('✅ Submission processed:', submission.id);

    res.json({
      success: true,
      message: language === 'en' 
        ? 'Your application has been received. We will contact you within 24 hours.'
        : 'Başvurunuz alındı. 24 saat içinde size dönüş yapacağız.',
      submissionId: submission.id
    });

  } catch (error) {
    console.error('❌ Error:', error);
    res.status(500).json({
      success: false,
      error: 'Bir hata oluştu. Lütfen info@claimsolver.co adresine email gönderin.'
    });
  }
});

// Admin endpoints
app.get('/api/submissions', (req, res) => {
  res.json({
    success: true,
    count: submissions.length,
    submissions: submissions
  });
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    submissions: submissions.length,
    config: {
      telegram: !!(CONFIG.TELEGRAM_BOT_TOKEN && CONFIG.TELEGRAM_CHAT_ID),
      email: !!CONFIG.RESEND_API_KEY,
      claude: !!CONFIG.ANTHROPIC_API_KEY
    }
  });
});

// Error handling
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({
    success: false,
    error: err.message || 'Internal server error'
  });
});

// Start
app.listen(PORT, () => {
  console.log(`\n🚀 ClaimSolver Backend`);
  console.log(`📍 Port: ${PORT}`);
  console.log(`🤖 Telegram: ${CONFIG.TELEGRAM_BOT_TOKEN ? '✅' : '❌'}`);
  console.log(`📨 Email: ${CONFIG.RESEND_API_KEY ? '✅' : '❌'}`);
  console.log(`🤖 Claude: ${CONFIG.ANTHROPIC_API_KEY ? '✅' : '❌'}\n`);
});

module.exports = app;
