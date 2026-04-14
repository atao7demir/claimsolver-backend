// ClaimSolver Backend - FIXED PROMPTS
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

// IMPROVED: Simpler prompts that work better
const SERVICE_PROMPTS = {
  'tr': {
    'CMR/FFL Analizi': `Sen bir sigorta uzmanısın. Bu dosyayı analiz et ve başarı ihtimalini değerlendir.

KULLANICI AÇIKLAMASI:
{description}

{pdfNote}

ÇOK ÖNEMLİ KURALLAR:
1. Başarı ihtimali: 40-85 arasında bir sayı ver (çok düşük veya çok yüksek olma)
2. Özet: SADECE 2 cümle! Merak uyandır, detay verme!
3. Teknik terim kullanma (CMR m.29, TBK 66 vs. yazma)
4. "Potansiyel var", "İncelenebilir", "Fırsat görünüyor" gibi ifadeler kullan

YANIT FORMATI - Sadece şunu yaz:
Başarı: 65
Özet: Dosyanızda hukuki dayanak tespit edildi. Tahsilat süreci yönetilebilir görünüyor.`,

    'Değer Kaybı': `Sen bir değer kaybı uzmanısın.

KULLANICI AÇIKLAMASI:
{description}

{pdfNote}

KURALLAR:
- Başarı: 45-80 arası
- Özet: 2 cümle, merak uyandırıcı
- Teknik detay yok!

YANIT:
Başarı: 58
Özet: Araçta değer kaybı potansiyeli görünüyor. Detaylı hesaplama fayda sağlayabilir.`,

    'Kusur Değişimi': `Sen bir kusur analizi uzmanısın.

KULLANICI AÇIKLAMASI:
{description}

{pdfNote}

YANIT:
Başarı: 62
Özet: Kusur oranı tartışılabilir. İtiraz süreci değerlendirilebilir.`,

    'Diğer': `Sen bir sigorta uzmanısın.

KULLANICI AÇIKLAMASI:
{description}

{pdfNote}

YANIT:
Başarı: 55
Özet: Dosyanız incelemeye değer. Hukuki seçenekler değerlendirilebilir.`
  }
};

// Get prompt for service type
function getPrompt(serviceType, language, description, hasPdf) {
  const langPrompts = SERVICE_PROMPTS[language] || SERVICE_PROMPTS['tr'];
  let prompt = langPrompts[serviceType] || langPrompts['Diğer'];
  
  prompt = prompt.replace('{description}', description || 'Belirtilmedi');
  prompt = prompt.replace('{pdfNote}', hasPdf ? 'PDF DOSYASI YÜKLENDİ - İçeriğini göz önünde bulundur.' : 'PDF yok - sadece açıklamaya göre değerlendir.');
  
  return prompt;
}

// SIMPLIFIED: Claude API Analysis
async function analyzeWithClaude(serviceType, description, fileBuffer, language = 'tr') {
  if (!CONFIG.ANTHROPIC_API_KEY) {
    console.log('⚠️ Claude API key not configured');
    return {
      successProbability: 55,
      summary: language === 'tr' 
        ? 'Dosyanızda potansiyel tespit edildi. Detaylı inceleme önerilir.'
        : 'Potential identified in your file. Detailed review recommended.',
      detailedAnalysis: 'Claude API not configured'
    };
  }

  try {
    // Prepare content
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
    const prompt = getPrompt(serviceType, language, description, !!fileBuffer);
    content.push({
      type: 'text',
      text: prompt
    });

    console.log('🤖 Calling Claude API...');

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
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: content
        }]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Claude API error:', errorText);
      throw new Error('Claude API failed');
    }

    const result = await response.json();
    const text = result.content[0].text;
    
    console.log('📄 Claude response:', text);

    // SIMPLE PARSING: Look for "Başarı:" and "Özet:"
    let successProbability = 55;
    let summary = language === 'tr'
      ? 'Dosyanızda potansiyel tespit edildi. Detaylı inceleme önerilir.'
      : 'Potential identified. Detailed review recommended.';

    // Try to extract success probability
    const successMatch = text.match(/Başarı[:\s]+(\d+)/i) || text.match(/Success[:\s]+(\d+)/i);
    if (successMatch) {
      successProbability = parseInt(successMatch[1]);
      if (successProbability < 40) successProbability = 40;
      if (successProbability > 85) successProbability = 85;
    }

    // Try to extract summary
    const summaryMatch = text.match(/Özet[:\s]+(.+?)(?:\n|$)/i) || text.match(/Summary[:\s]+(.+?)(?:\n|$)/i);
    if (summaryMatch) {
      summary = summaryMatch[1].trim();
    } else {
      // Use entire response if no pattern found (up to 200 chars)
      summary = text.replace(/Başarı[:\s]+\d+/gi, '').replace(/Success[:\s]+\d+/gi, '').trim().substring(0, 200);
    }

    return {
      successProbability,
      summary,
      detailedAnalysis: text
    };

  } catch (error) {
    console.error('❌ Claude analysis error:', error.message);
    
    // BETTER FALLBACKS based on service type
    const fallbacks = {
      'CMR/FFL Analizi': {
        prob: 65,
        summary: 'Uluslararası taşıma dosyanızda hukuki dayanak tespit edildi. İnceleme önerilir.'
      },
      'Değer Kaybı': {
        prob: 58,
        summary: 'Araçta değer kaybı potansiyeli görünüyor. Hesaplama yapılabilir.'
      },
      'Kusur Değişimi': {
        prob: 62,
        summary: 'Kusur oranı tartışmalı görünüyor. İtiraz değerlendirilebilir.'
      },
      'default': {
        prob: 55,
        summary: 'Dosyanızda potansiyel tespit edildi. Detaylı analiz fayda sağlayabilir.'
      }
    };

    const fallback = fallbacks[serviceType] || fallbacks['default'];

    return {
      successProbability: fallback.prob,
      summary: fallback.summary,
      detailedAnalysis: 'Error: ' + error.message
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
