// ClaimSolver Backend - With Claude API
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

// Simple in-memory database
const submissions = [];

// Service-specific prompts
const SERVICE_PROMPTS = {
  'tr': {
    'CMR/FFL Analizi': `Sen ClaimSolver AI'sın - uluslararası taşımacılık ve CMR/FFL uzmanısın.

KULLANICI AÇIKLAMASI:
{description}

{pdfContent}

GÖREV:
1. Başarı ihtimali hesapla (0-100%)
2. ÖN DEĞERLENDİRME yaz (MERAK UYANDIRICI, detay verme!)

ÖNEMLİ KURALLAR:
- Spesifik madde numarası belirtme (CMR m.29, TBK 66 gibi)
- Teknik terim kullanma
- "Hukuki dayanak var", "Potansiyel görünüyor" gibi genel ifadeler kullan
- Maksimum 2-3 cümle
- Kullanıcı detayları PREMIUM RAPORDA görmeli

ÇIKTI FORMATI (JSON):
{
  "successProbability": 75,
  "summary": "Dosyanızda güçlü hukuki dayanak tespit edildi. Rücu süreci yönetilebilir görünüyor.",
  "detailedAnalysis": "Detaylı analiz (sadece Telegram'a gidecek)"
}`,

    'Değer Kaybı': `Sen ClaimSolver AI'sın - araç değer kaybı uzmanısın.

KULLANICI AÇIKLAMASI:
{description}

{pdfContent}

GÖREV:
Değer kaybı talebini değerlendir. ÖN DEĞERLENDİRME merak uyandırıcı olmalı!

KURALLAR:
- Spesifik hesaplama gösterme
- "Değer kaybı potansiyeli var", "İnceleme değer kazandırabilir" gibi ifadeler
- Maksimum 2-3 cümle

ÇIKTI FORMATI (JSON):
{
  "successProbability": 65,
  "summary": "Aracınızda değer kaybı potansiyeli görünüyor. Detaylı hesaplama önerilir.",
  "detailedAnalysis": "..."
}`,

    'Kusur Değişimi': `Sen ClaimSolver AI'sın - trafik hukuku ve kusur analizi uzmanısın.

KULLANICI AÇIKLAMASI:
{description}

{pdfContent}

GÖREV:
Kusur oranını değerlendir. Merak uyandır, detay verme!

ÇIKTI FORMATI (JSON):
{
  "successProbability": 70,
  "summary": "Kusur oranı tartışılabilir. İtiraz süreci değerlendirilebilir.",
  "detailedAnalysis": "..."
}`,

    'Ret Dosyası Danışmanlığı': `Sen ClaimSolver AI'sın - ret dosyası uzmanısın.

KULLANICI AÇIKLAMASI:
{description}

{pdfContent}

ÇIKTI FORMATI (JSON):
{
  "successProbability": 60,
  "summary": "Ret gerekçeleri incelenebilir. Yeniden değerlendirme fırsatı olabilir.",
  "detailedAnalysis": "..."
}`,

    'Diğer': `Sen ClaimSolver AI'sın - sigorta hukuku uzmanısın.

KULLANICI AÇIKLAMASI:
{description}

{pdfContent}

ÇIKTI FORMATI (JSON):
{
  "successProbability": 50,
  "summary": "Dosyanız incelemeye değer. Hukuki seçenekler değerlendirilebilir.",
  "detailedAnalysis": "..."
}`
  },
  'en': {
    'CMR/FFL Analysis': `You are ClaimSolver AI - international transport and CMR/FFL expert.

USER DESCRIPTION:
{description}

{pdfContent}

TASK:
Calculate success probability (0-100%) and write PRELIMINARY assessment (create curiosity, don't reveal details!)

RULES:
- Don't mention specific article numbers
- Use general terms: "legal basis found", "potential identified"
- Maximum 2-3 sentences
- User should see details in PREMIUM REPORT

OUTPUT FORMAT (JSON):
{
  "successProbability": 75,
  "summary": "Strong legal basis identified in your file. Recovery process appears manageable.",
  "detailedAnalysis": "..."
}`,

    'Diminished Value': `You are ClaimSolver AI - vehicle diminished value expert.

USER DESCRIPTION:
{description}

{pdfContent}

OUTPUT FORMAT (JSON):
{
  "successProbability": 65,
  "summary": "Diminished value potential identified. Detailed calculation recommended.",
  "detailedAnalysis": "..."
}`
  }
};

// Get prompt for service type and language
function getPrompt(serviceType, language, description, pdfContent) {
  const langPrompts = SERVICE_PROMPTS[language] || SERVICE_PROMPTS['tr'];
  let prompt = langPrompts[serviceType] || langPrompts['Diğer'];
  
  prompt = prompt.replace('{description}', description || 'Belirtilmedi');
  prompt = prompt.replace('{pdfContent}', pdfContent || '');
  
  return prompt;
}

// Claude API Analysis
async function analyzeWithClaude(serviceType, description, fileBuffer, language = 'tr') {
  if (!CONFIG.ANTHROPIC_API_KEY) {
    console.log('⚠️ Claude API key not configured');
    return {
      successProbability: 50,
      summary: language === 'tr' 
        ? 'Dosyanız uzman ekibimiz tarafından değerlendirilecektir.'
        : 'Your file will be reviewed by our expert team.',
      detailedAnalysis: 'Manual review required'
    };
  }

  try {
    // Prepare content array
    const content = [];
    
    // Add PDF if exists
    if (fileBuffer) {
      content.push({
        type: 'document',
        source: {
          type: 'base64',
          media_type: 'application/pdf',
          data: fileBuffer.toString('base64')
        }
      });
    }
    
    // Add prompt
    const prompt = getPrompt(serviceType, language, description, fileBuffer ? 'PDF DOKÜMANI YÜKLENDİ - İçeriğini oku ve analiz et.' : '');
    content.push({
      type: 'text',
      text: prompt
    });

    // Call Claude API
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CONFIG.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 2000,
        messages: [{
          role: 'user',
          content: content
        }]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Claude API error:', errorText);
      throw new Error('Claude API failed');
    }

    const result = await response.json();
    const text = result.content[0].text;
    
    // Parse JSON response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const analysis = JSON.parse(jsonMatch[0]);
      return analysis;
    }
    
    // Fallback if no JSON
    return {
      successProbability: 60,
      summary: text.substring(0, 200),
      detailedAnalysis: text
    };

  } catch (error) {
    console.error('❌ Claude analysis error:', error);
    return {
      successProbability: 50,
      summary: language === 'tr'
        ? 'Dosyanız uzman ekibimiz tarafından değerlendirilecektir.'
        : 'Your file will be reviewed by our expert team.',
      detailedAnalysis: 'Error during analysis'
    };
  }
}

// Telegram notification
async function sendTelegramNotification(data, analysis) {
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
${data.description ? data.description.substring(0, 300) + (data.description.length > 300 ? '...' : '') : 'Belirtilmedi'}

${data.hasFile ? '📎 Dosya: ' + data.fileName : '⚠️ Dosya yok'}

━━━━━━━━━━━━━━━━━━━━
🤖 CLAIMSOLVER AI ANALİZİ:

📊 Başarı İhtimali: %${analysis.successProbability}

📝 Ön Değerlendirme:
${analysis.summary}

📄 Detaylı Analiz:
${analysis.detailedAnalysis || 'Tam analiz premium raporda'}

━━━━━━━━━━━━━━━━━━━━
💰 DURUM: ${data.paymentStatus || 'Ödeme bekliyor'}

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

// Email sender
async function sendEmail(to, subject, html) {
  if (!CONFIG.RESEND_API_KEY) {
    console.log('⚠️ Resend not configured');
    console.log('Email would be sent to:', to);
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
      console.log('✅ Email sent');
    } else {
      console.error('❌ Email failed:', await response.text());
    }
  } catch (error) {
    console.error('❌ Email error:', error.message);
  }
}

// Main endpoint: Form submission
app.post('/api/submit-claim', upload.single('file'), async (req, res) => {
  try {
    const { name, company, email, phone, serviceType, description, language } = req.body;
    const file = req.file;

    console.log('📝 New submission:', { name, email, serviceType, hasFile: !!file });

    // Validate
    if (!name || !email || !serviceType) {
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
      description: description || '',
      hasFile: !!file,
      fileName: file ? file.originalname : null,
      fileSize: file ? file.size : null,
      language: language || 'tr',
      timestamp: new Date().toISOString(),
      status: 'pending',
      paymentStatus: 'Ödeme bekliyor'
    };

    submissions.push(submission);

    // Analyze with Claude API
    console.log('🤖 Analyzing with Claude...');
    const analysis = await analyzeWithClaude(
      serviceType,
      description,
      file ? file.buffer : null,
      language || 'tr'
    );

    console.log('✅ Analysis complete:', analysis);

    // Send notifications (non-blocking)
    Promise.all([
      sendTelegramNotification(submission, analysis)
    ]).catch(err => console.error('Notification error:', err));

    // Return analysis to frontend
    res.json({
      success: true,
      submissionId: submission.id,
      analysis: {
        successProbability: analysis.successProbability,
        summary: analysis.summary
      }
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
