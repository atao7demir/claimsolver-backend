// ClaimSolver Backend
const express = require('express');
const cors = require('cors');
const multer = require('multer');

const cloudinary = require('cloudinary').v2;

const { MongoClient } = require('mongodb');

const mongoClient = new MongoClient(process.env.MONGODB_URI);
let db;

async function connectDB() {
  try {
    await mongoClient.connect();
    db = mongoClient.db(process.env.MONGODB_DB || 'claimsolver');
    console.log('✅ MongoDB connected');
  } catch (err) {
    console.error('❌ MongoDB connection error:', err.message);
  }
}
connectDB();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Dosya türü: PDF, JPG, PNG, Word kabul et
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = [
      'application/pdf',
      'image/jpeg',
      'image/jpg',
      'image/png',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Desteklenmeyen dosya türü. PDF, JPG, PNG veya Word dosyası yükleyin.'));
    }
  }
});

const CONFIG = {
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID || '',
  RESEND_API_KEY: process.env.RESEND_API_KEY || ''
};

const submissions = [];

// IP bazlı sorgu limiti (ücretsiz kullanıcı max 1 sorgu)
const queryLog = {};
function checkQueryLimit(ip) {
  if (!queryLog[ip]) {
    queryLog[ip] = 0;
  }
  queryLog[ip]++;
  return queryLog[ip] <= 1;
}

const SERVICE_PROMPTS = {
  'tr': {
    'CMR/FFL Analizi': `Sen bir sigorta hasar uzmanısın. Kullanıcının açıklamasını oku ve değerlendir.

KULLANICI AÇIKLAMASI:
{description}

{pdfNote}

KURALLAR (KESINLIKLE UYULMALI):
- SADECE 2 satır yaz, başka hiçbir şey yazma
- Soru sorma, madde madde yazma, açıklama isteme
- Teknik terim kullanma (CMR m.29, TBK vs. yazma)
- "Potansiyel var", "incelenebilir", "fırsat görünüyor" gibi merak uyandırıcı ifadeler kullan

YANIT FORMATI (sadece bu 2 satırı yaz):
Başarı: 65
Özet: Uluslararası taşıma dosyanızda hukuki dayanak tespit edildi. Tahsilat süreci yönetilebilir görünüyor.`,

    'Değer Kaybı': `Sen bir değer kaybı uzmanısın. Kullanıcının açıklamasını oku ve değerlendir.

KULLANICI AÇIKLAMASI:
{description}

{pdfNote}

KURALLAR (KESINLIKLE UYULMALI):
- SADECE 2 satır yaz, başka hiçbir şey yazma
- Soru sorma, madde madde yazma, açıklama isteme
- Teknik terim kullanma

YANIT FORMATI (sadece bu 2 satırı yaz):
Başarı: 62
Özet: Araçta değer kaybı potansiyeli tespit edildi. Detaylı hesaplama fayda sağlayabilir.`,

    'Kusur Değişimi': `Sen bir kusur analizi uzmanısın. Kullanıcının açıklamasını oku ve değerlendir.

KULLANICI AÇIKLAMASI:
{description}

{pdfNote}

KURALLAR (KESINLIKLE UYULMALI):
- SADECE 2 satır yaz, başka hiçbir şey yazma
- Soru sorma, madde madde yazma, açıklama isteme
- Teknik terim kullanma

YANIT FORMATI (sadece bu 2 satırı yaz):
Başarı: 60
Özet: Kusur oranı tartışmaya açık görünüyor. İtiraz süreci değerlendirilebilir.`,

    'Uluslararası Rücu': `Sen bir uluslararası rücu uzmanısın. Kullanıcının açıklamasını oku ve değerlendir.

KULLANICI AÇIKLAMASI:
{description}

{pdfNote}

KURALLAR (KESINLIKLE UYULMALI):
- SADECE 2 satır yaz, başka hiçbir şey yazma
- Soru sorma, madde madde yazma, açıklama isteme
- Teknik terim kullanma

YANIT FORMATI (sadece bu 2 satırı yaz):
Başarı: 63
Özet: Rücu dosyanızda tahsilat potansiyeli görünüyor. Süreç yönetilebilir.`,

    'Poliçe/Teminat Analizi': `Sen bir sigorta poliçe uzmanısın. Kullanıcının poliçe veya durumunu oku ve değerlendir.

KULLANICI AÇIKLAMASI:
{description}

{pdfNote}

KURALLAR (KESINLIKLE UYULMALI):
- SADECE 2 satır yaz, başka hiçbir şey yazma
- Soru sorma, madde madde yazma, açıklama isteme
- Teknik terim kullanma

YANIT FORMATI (sadece bu 2 satırı yaz):
Başarı: 58
Özet: Poliçenizde teminat potansiyeli incelenebilir. Detaylı analiz fayda sağlayabilir.`,

    'Diğer': `Sen bir sigorta uzmanısın. Kullanıcının açıklamasını oku ve değerlendir.

KULLANICI AÇIKLAMASI:
{description}

{pdfNote}

KURALLAR (KESINLIKLE UYULMALI):
- SADECE 2 satır yaz, başka hiçbir şey yazma
- Soru sorma, madde madde yazma, açıklama isteme
- Teknik terim kullanma

YANIT FORMATI (sadece bu 2 satırı yaz):
Başarı: 55
Özet: Dosyanız incelemeye değer görünüyor. Hukuki seçenekler değerlendirilebilir.`
  },

  'en': {
    'CMR/FFL Analysis': `You are an insurance claims expert. Read the user's description and evaluate.

USER DESCRIPTION:
{description}

{pdfNote}

RULES (STRICTLY FOLLOW):
- Write ONLY 2 lines, nothing else
- Do not ask questions, do not use bullet points
- No technical terms
- Use phrases like "potential identified", "worth investigating", "opportunity found"

RESPONSE FORMAT (write only these 2 lines):
Success: 65
Summary: Legal grounds have been identified in your international transport file. Recovery process appears manageable.`,

    'Diminution of Value': `You are a vehicle value loss expert. Read the user's description and evaluate.

USER DESCRIPTION:
{description}

{pdfNote}

RULES (STRICTLY FOLLOW):
- Write ONLY 2 lines, nothing else
- Do not ask questions, do not use bullet points

RESPONSE FORMAT:
Success: 62
Summary: Value loss potential has been identified in your vehicle. A detailed calculation could be beneficial.`,

    'Liability Assessment': `You are a liability analysis expert. Read the user's description and evaluate.

USER DESCRIPTION:
{description}

{pdfNote}

RULES (STRICTLY FOLLOW):
- Write ONLY 2 lines, nothing else
- Do not ask questions

RESPONSE FORMAT:
Success: 60
Summary: Liability ratio appears open to dispute. An appeal process could be considered.`,

    'International Subrogation': `You are an international subrogation expert. Read the user's description and evaluate.

USER DESCRIPTION:
{description}

{pdfNote}

RULES (STRICTLY FOLLOW):
- Write ONLY 2 lines, nothing else
- Do not ask questions

RESPONSE FORMAT:
Success: 63
Summary: Recovery potential identified in your subrogation file. Process appears manageable.`,

    'Policy/Coverage Analysis': `You are an insurance policy expert. Read the user's description and evaluate.

USER DESCRIPTION:
{description}

{pdfNote}

RULES (STRICTLY FOLLOW):
- Write ONLY 2 lines, nothing else
- Do not ask questions

RESPONSE FORMAT:
Success: 58
Summary: Coverage potential in your policy can be examined. Detailed analysis may be beneficial.`,

    'Other': `You are an insurance expert. Read the user's description and evaluate.

USER DESCRIPTION:
{description}

{pdfNote}

RULES (STRICTLY FOLLOW):
- Write ONLY 2 lines, nothing else
- Do not ask questions

RESPONSE FORMAT:
Success: 55
Summary: Your file appears worth examining. Legal options could be evaluated.`
  }
};

function getPrompt(serviceType, language, description, hasPdf) {
  const langPrompts = SERVICE_PROMPTS[language] || SERVICE_PROMPTS['tr'];
  const fallbackKey = language === 'en' ? 'Other' : 'Diğer';
  let prompt = langPrompts[serviceType] || langPrompts[fallbackKey];
  prompt = prompt.replace('{description}', description || 'Belirtilmedi');
  prompt = prompt.replace('{pdfNote}', hasPdf ? 'DOSYA YÜKLENDİ - İçeriğini göz önünde bulundur.' : 'Dosya yok - sadece açıklamaya göre değerlendir.');
  return prompt;
}

async function analyzeWithClaude(serviceType, description, fileBuffer, fileMime, language = 'tr') {
  if (!CONFIG.ANTHROPIC_API_KEY) {
    return { successProbability: 55, summary: 'Dosyanızda potansiyel tespit edildi.', detailedAnalysis: 'API not configured' };
  }

  try {
    const content = [];

    if (fileBuffer) {
      // Sadece PDF ve görsel dosyaları Claude'a gönder
      if (fileMime === 'application/pdf') {
        content.push({
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: fileBuffer.toString('base64') }
        });
      } else if (['image/jpeg', 'image/jpg', 'image/png'].includes(fileMime)) {
        content.push({
          type: 'image',
          source: { type: 'base64', media_type: fileMime, data: fileBuffer.toString('base64') }
        });
      }
      // Word dosyaları için sadece metin açıklamasını kullan
    }

    const prompt = getPrompt(serviceType, language, description, !!fileBuffer);
    content.push({ type: 'text', text: prompt });

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CONFIG.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 200,
        messages: [{ role: 'user', content: content }]
      })
    });

    if (!response.ok) throw new Error('Claude API failed');

    const result = await response.json();
    const text = result.content[0].text;
    console.log('📄 Claude response:', text);

    let successProbability = 55;
    let summary = language === 'tr' ? 'Dosyanızda potansiyel tespit edildi.' : 'Potential identified in your file.';

    const successMatch = text.match(/Başarı[:\s]+(\d+)/i) || text.match(/Success[:\s]+(\d+)/i);
    if (successMatch) {
      successProbability = Math.min(85, Math.max(40, parseInt(successMatch[1])));
    }

    const summaryMatch = text.match(/Özet[:\s]+(.+?)(?:\n|$)/i) || text.match(/Summary[:\s]+(.+?)(?:\n|$)/i);
    if (summaryMatch) {
      summary = summaryMatch[1].trim();
    }

    return { successProbability, summary, detailedAnalysis: text };

  } catch (error) {
    console.error('❌ Claude error:', error.message);
    const fallbacks = {
      'CMR/FFL Analizi': { prob: 65, summary: 'Uluslararası taşıma dosyanızda hukuki dayanak tespit edildi.' },
      'Değer Kaybı': { prob: 58, summary: 'Araçta değer kaybı potansiyeli görünüyor.' },
      'Kusur Değişimi': { prob: 62, summary: 'Kusur oranı tartışmalı görünüyor.' },
      'Uluslararası Rücu': { prob: 63, summary: 'Rücu dosyanızda tahsilat potansiyeli görünüyor.' },
      'Poliçe/Teminat Analizi': { prob: 58, summary: 'Poliçenizde teminat potansiyeli incelenebilir.' },
      'CMR/FFL Analysis': { prob: 65, summary: 'Legal grounds identified in your transport file.' },
      'Diminution of Value': { prob: 58, summary: 'Value loss potential identified in your vehicle.' },
      'Liability Assessment': { prob: 62, summary: 'Liability ratio appears open to dispute.' },
      'International Subrogation': { prob: 63, summary: 'Recovery potential identified in your file.' },
      'Policy/Coverage Analysis': { prob: 58, summary: 'Coverage potential in your policy can be examined.' },
      'default': { prob: 55, summary: 'Dosyanızda potansiyel tespit edildi.' }
    };
    const f = fallbacks[serviceType] || fallbacks['default'];
    return { successProbability: f.prob, summary: f.summary, detailedAnalysis: 'Fallback used' };
  }
}

async function sendEmailNotification(data, analysis) {
  if (!CONFIG.RESEND_API_KEY) return;

  const html = data.language === 'tr' ? `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 2rem;">
      <h2 style="color: #1e3a8a;">Başvurunuz Alındı!</h2>
      <p>Merhaba ${data.name},</p>
      <p>ClaimSolver'a başvurunuz için teşekkür ederiz.</p>
      <div style="background: #eff6ff; padding: 1.5rem; border-radius: 0.5rem; margin: 1.5rem 0;">
        <h3 style="color: #1e3a8a; margin-top: 0;">📊 Ön Analiz Sonucu</h3>
        <p><strong>Başarı İhtimali:</strong> %${analysis.successProbability}</p>
        <p>${analysis.summary}</p>
      </div>
      <p>Uzman ekibimiz dosyanızı <strong>24 saat içinde</strong> detaylı olarak inceleyecek ve size geri dönüş yapacaktır.</p>
      <p>Sorularınız için: <a href="mailto:info@claimsolver.co">info@claimsolver.co</a></p>
      <hr style="margin: 2rem 0; border: none; border-top: 1px solid #e2e8f0;">
      <p style="color: #64748b; font-size: 0.875rem;">Bu otomatik bir emaildir.</p>
    </div>
  ` : `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 2rem;">
      <h2 style="color: #1e3a8a;">Application Received!</h2>
      <p>Hello ${data.name},</p>
      <p>Thank you for your application to ClaimSolver.</p>
      <div style="background: #eff6ff; padding: 1.5rem; border-radius: 0.5rem; margin: 1.5rem 0;">
        <h3 style="color: #1e3a8a; margin-top: 0;">📊 Preliminary Analysis</h3>
        <p><strong>Success Probability:</strong> ${analysis.successProbability}%</p>
        <p>${analysis.summary}</p>
      </div>
      <p>Our expert team will review your file within <strong>24 hours</strong>.</p>
      <p>Questions: <a href="mailto:info@claimsolver.co">info@claimsolver.co</a></p>
      <hr style="margin: 2rem 0; border: none; border-top: 1px solid #e2e8f0;">
      <p style="color: #64748b; font-size: 0.875rem;">This is an automated email.</p>
    </div>
  `;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${CONFIG.RESEND_API_KEY}` },
      body: JSON.stringify({
        from: 'ClaimSolver <info@claimsolver.co>',
        to: data.email,
        subject: data.language === 'tr' ? 'ClaimSolver - Başvurunuz Alındı ✅' : 'ClaimSolver - Application Received ✅',
        html
      })
    });
    if (response.ok) console.log('✅ Email sent');
    else console.error('❌ Email failed:', await response.text());
  } catch (e) {
    console.error('❌ Email error:', e.message);
  }
}

async function sendTelegramNotification(data, analysis) {
  if (!CONFIG.TELEGRAM_BOT_TOKEN || !CONFIG.TELEGRAM_CHAT_ID) return;

  const message = `
🔔 YENİ BAŞVURU

👤 ${data.name}
${data.company ? `🏢 ${data.company}` : ''}
📧 ${data.email}
${data.phone ? `📞 ${data.phone}` : ''}

📋 Hizmet: ${data.serviceType}
📝 Açıklama: ${data.description ? data.description.substring(0, 300) : 'Belirtilmedi'}
${data.hasFile ? `📎 Dosya: ${data.fileName}${data.fileUrl ? '\n🔗 Link: ' + data.fileUrl : ''}` : '⚠️ Dosya yok'}

━━━━━━━━━━━━━━━━━━━━
🤖 AI ANALİZİ:
📊 Başarı: %${analysis.successProbability}
📝 Özet: ${analysis.summary}

⏰ ${new Date().toLocaleString('tr-TR')}
ID: ${data.id}
  `.trim();

  try {
    await fetch(`https://api.telegram.org/bot${CONFIG.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: CONFIG.TELEGRAM_CHAT_ID, text: message })
    });
    console.log('✅ Telegram sent');
  } catch (e) {
    console.error('❌ Telegram error:', e.message);
  }
}

// Ana endpoint
app.post('/api/submit-claim', upload.single('file'), async (req, res) => {
  try {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const { name, company, email, phone, serviceType, description, language } = req.body;
    const file = req.file;

    if (!name || !email || !serviceType) {
      return res.status(400).json({ success: false, error: 'Zorunlu alanlar eksik' });
    }

    // Sorgu limiti kontrolü
    if (!checkQueryLimit(ip)) {
      return res.status(429).json({
        success: false,
        error: language === 'tr'
          ? 'Ücretsiz sorgu hakkınızı kullandınız. Premium rapor için info@claimsolver.co adresine yazın.'
          : 'You have used your free query. Contact info@claimsolver.co for premium report.'
      });
    }

    const submission = {
      id: Date.now().toString(),
      name, company: company || '', email, phone: phone || '',
      serviceType, description: description || '',
      hasFile: !!file,
      fileName: file ? file.originalname : null,
      fileMime: file ? file.mimetype : null,
      language: language || 'tr',
      timestamp: new Date().toISOString(),
      status: 'pending'
    };

    submissions.push(submission);

    // Cloudinary'e dosya yükle
let fileUrl = null;
if (file) {
  try {
    const b64 = file.buffer.toString('base64');
    const dataUri = `data:${file.mimetype};base64,${b64}`;
    const uploadResult = await cloudinary.uploader.upload(dataUri, {
      folder: 'claimsolver',
      resource_type: 'auto',
      public_id: `${submission.id}_${file.originalname}`
    });
    fileUrl = uploadResult.secure_url;
    submission.fileUrl = fileUrl;
    console.log('✅ File uploaded to Cloudinary:', fileUrl);
  } catch (err) {
    console.error('❌ Cloudinary upload error:', err.message);
  }
}

    const analysis = await analyzeWithClaude(
      serviceType, description,
      file ? file.buffer : null,
      file ? file.mimetype : null,
      language || 'tr'
    );

    Promise.all([
      sendTelegramNotification(submission, analysis),
      sendEmailNotification(submission, analysis)
    ]).catch(err => console.error('Notification error:', err));

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
    res.status(500).json({ success: false, error: 'Bir hata oluştu. Lütfen info@claimsolver.co adresine email gönderin.' });
  }
});

// Admin panel
app.get('/admin', (req, res) => {
  res.sendFile(__dirname + '/admin.html');
});

app.get('/api/submissions', (req, res) => {
  res.json({ success: true, count: submissions.length, submissions });
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

app.use((err, req, res, next) => {
  res.status(500).json({ success: false, error: err.message || 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`\n🚀 ClaimSolver Backend`);
  console.log(`📍 Port: ${PORT}`);
  console.log(`🤖 Telegram: ${CONFIG.TELEGRAM_BOT_TOKEN ? '✅' : '❌'}`);
  console.log(`📨 Email: ${CONFIG.RESEND_API_KEY ? '✅' : '❌'}`);
  console.log(`🤖 Claude: ${CONFIG.ANTHROPIC_API_KEY ? '✅' : '❌'}\n`);
});

module.exports = app;
