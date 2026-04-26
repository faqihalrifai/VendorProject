// dazer-api.js - Backend V10 (Migrasi Full ke Groq untuk Analisis & Chat)
const nodemailer = require('nodemailer');
const rateLimitMap = new Map();

function cleanMarkdown(text) {
    if (!text || typeof text !== 'string') return text;
    return text.replace(/[\*`]/g, '').replace(/(^|\n)#+\s/g, '$1').trim();
}

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-forwarded-for, client-ip",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json"
};

exports.handler = async (event, context) => {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ message: "CORS Preflight OK" }) };
    if (event.httpMethod !== 'POST') return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: 'Method Not Allowed' }) };

    const clientIp = event.headers['x-forwarded-for'] || event.headers['client-ip'] || 'unknown-ip';
    const currentTime = Date.now();
    const limitData = rateLimitMap.get(clientIp) || { count: 0, firstRequest: currentTime };
    
    if (currentTime - limitData.firstRequest > 600000) { 
        limitData.count = 1; limitData.firstRequest = currentTime; 
    } else {
        limitData.count += 1;
        if (limitData.count > 30) { // Limit lebih longgar
            return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ reply: "Jeda sistem 10 menit aktif.", insights: ["Limit tercapai."], cards: null }) };
        }
    }
    rateLimitMap.set(clientIp, limitData);

    try {
        const body = JSON.parse(event.body);
        const { action, message, context: userContext, data, modelType, algorithm } = body;
        const groqKey = process.env.GROQ_API_KEY;

        // ==========================================
        // ACTION: LOGGER (EMAIL)
        // ==========================================
        if (action === 'notify_upload' || (!action && body.sessionId)) {
            const emailPass = process.env.NODEMAILER_PASS; 
            if(emailPass) {
                try {
                    let transporter = nodemailer.createTransport({ service: 'gmail', auth: { user: 'dazer.help@gmail.com', pass: emailPass } });
                    await transporter.sendMail({ 
                        from: '"Dazer Intelligence" <dazer.help@gmail.com>', 
                        to: "dazer.help@gmail.com", 
                        subject: `[LOG] Aktivitas Dazer: ${body.fileName || 'Sesi Baru'}`, 
                        text: `File: ${body.fileName}\nUkuran: ${body.size}\nDimensi: ${body.dataDimension}\nIP: ${body.ipAddress}`
                    });
                } catch (e) {}
            }
            return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ status: 'logged' }) };
        }

        // ==========================================
        // ACTION: ANALISA UTAMA (MIGRASI KE GROQ)
        // ==========================================
        if (action === 'analyze_data') {
            if (!groqKey) return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ insights: ["Error: API Key Groq hilang."], cards: null }) };

            const systemPrompt = `Kamu analis Dazer. Konteks: ${userContext}. Jawab HANYA JSON MURNI:
{"insights":["3 kalimat tindakan strategis.","3 kalimat... (total 7 poin)"],"cards":{"metric":"2 kalimat","segment":"2 kalimat","correlation":"2 kalimat","volatility":"2 kalimat"}}`;

            try {
                const aiResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqKey}` },
                    body: JSON.stringify({ 
                        model: 'llama-3.3-70b-versatile', 
                        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: `Statistik: ${data}` }], 
                        temperature: 0.1, 
                        response_format: { type: "json_object" } 
                    })
                });

                const aiData = await aiResponse.json();
                const content = aiData.choices?.[0]?.message?.content || '{}';
                return { statusCode: 200, headers: corsHeaders, body: content };
            } catch (err) {
                return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ insights: ["⚠️ Gagal memuat analisis AI."], cards: null }) };
            }
        }

        // ==========================================
        // ACTION: CHATBOT (GROQ)
        // ==========================================
        if (action === 'chat') {
            const systemPrompt = `Kamu Dazer AI. Jawab maks 3 kalimat. Konteks: ${userContext}`;
            try {
                const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        model: 'llama-3.3-70b-versatile', 
                        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: message }], 
                        temperature: 0.5, max_tokens: 250
                    })
                });
                const chatData = await response.json();
                return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ reply: chatData.choices[0].message.content }) };
            } catch (e) { return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ reply: "Maaf, asisten sedang sibuk." }) }; }
        }

        return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ status: "Aksi tidak dikenal" }) };

    } catch (error) {
        return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: error.message }) };
    }
};
