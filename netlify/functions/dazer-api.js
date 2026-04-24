// dazer-api.js - Backend KDD & AI Strategist (V7 - Full Groq & Strict Token Saver)
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

    // --- ANTI-SPAM & ANTI-BOROS TOKEN BERBASIS IP ---
    const clientIp = event.headers['x-forwarded-for'] || event.headers['client-ip'] || 'unknown-ip';
    const currentTime = Date.now();
    const limitData = rateLimitMap.get(clientIp) || { count: 0, firstRequest: currentTime };
    
    // Reset limit setiap 10 menit (600.000 ms)
    if (currentTime - limitData.firstRequest > 600000) { 
        limitData.count = 1; limitData.firstRequest = currentTime; 
    } else {
        limitData.count += 1;
        // Maksimal 15 request per 10 menit per IP
        if (limitData.count > 15) { 
            return { 
                statusCode: 200, headers: corsHeaders, 
                body: JSON.stringify({ 
                    reply: "Sistem mendeteksi lalu lintas tinggi dari perangkat Anda. Untuk menghemat sumber daya, mohon jeda 10 menit.", 
                    insights: ["Limit penggunaan sistem tercapai. Harap tunggu beberapa saat sebelum menganalisa kembali."], 
                    cards: null 
                }) 
            };
        }
    }
    rateLimitMap.set(clientIp, limitData);

    try {
        let body;
        try { body = JSON.parse(event.body); } 
        catch (err) { return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ reply: "Format request ditolak." }) }; }

        const { action, message, context: userContext, data } = body;

        // ==========================================
        // ACTION 1: SILENT LOGGER (EMAIL)
        // ==========================================
        if (action === 'notify_upload' || (!action && body.sessionId && body.fileName)) {
            const emailPass = process.env.NODEMAILER_PASS; 
            if(emailPass) {
                try {
                    let transporter = nodemailer.createTransport({ service: 'gmail', auth: { user: 'faqihalrf@gmail.com', pass: emailPass } });
                    
                    const emailContent = `=== DETAIL SESI & FILE ===
Nama File    : ${body.fileName || '-'}
Ukuran       : ${body.size || '-'}
File Hash    : ${body.fileHash || '-'}
Kategori     : ${body.category || '-'}
Dimensi Data : ${body.dataDimension || '-'}
Daftar Kolom : ${body.columns || '-'}
Teknik KDD   : ${body.miningTechnique || '-'}

=== INFO PERANGKAT & LOKASI ===
ID Sesi      : ${body.sessionId || '-'}
Perangkat    : ${body.device || '-'}
Resolusi     : ${body.resolution || '-'}
Baterai      : ${body.battery || '-'}
IP Address   : ${body.ipAddress || '-'}
ISP/Provider : ${body.isp || '-'}
Lokasi       : ${body.location || '-'}
Tipe Koneksi : ${body.connection || '-'}
Waktu Lokal  : ${body.localTime || '-'}
Durasi Tahan : ${body.holdDuration || '-'}`;

                    await transporter.sendMail({ 
                        from: '"Dazer KDD" <faqihalrf@gmail.com>', 
                        to: "faqihalrf@gmail.com", 
                        subject: `[DAZER] Aktivitas Baru: ${body.fileName || 'Data Upload'}`, 
                        text: emailContent 
                    });
                } catch (e) { console.error("Email Error:", e.message); }
            }
            return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ status: 'logged' }) };
        }

        // ==========================================
        // ACTION 2: ANALISA KDD UTAMA (GROQ LLAMA-3.3-70B)
        // ==========================================
        if (action === 'analyze_data') {
            const groqKey = process.env.GROQ_API_KEY; 

            if (!groqKey) return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ insights: ["Error: API Groq belum dimasukkan di Netlify."], cards: null }) };

            const systemPrompt = `Kamu analis data Dazer AI. Analisis: ${userContext}.
MENGEMBALIKAN OUTPUT DALAM FORMAT JSON MURNI:
{
  "insights": ["aksi 1", "aksi 2", "aksi 3", "aksi 4", "aksi 5", "aksi 6", "aksi 7"],
  "cards": {
    "metric": "singkat...", "segment": "singkat...", "correlation": "singkat...", "volatility": "singkat..."
  }
}
ATURAN HEMAT TOKEN:
1. "insights" harus 7 poin. Sangat padat, langsung ke inti (max 12 kata per poin).
2. "cards" maksimal 2 kalimat pendek per aspek.
3. HANYA OUTPUT JSON MURNI. Dilarang memberi penjelasan di luar JSON.`;

            try {
                const aiResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqKey}` },
                    body: JSON.stringify({ 
                        model: 'llama-3.3-70b-versatile', 
                        messages: [
                            { role: 'system', content: systemPrompt }, 
                            { role: 'user', content: `Data: ${data}` }
                        ], 
                        temperature: 0.1,
                        max_tokens: 800, // HEMAT TOKEN: Paksa AI berhenti setelah 800 token
                        response_format: { type: "json_object" } 
                    })
                });

                if (!aiResponse.ok) {
                    const errBody = await aiResponse.text();
                    throw new Error(`[HTTP ${aiResponse.status}] ${errBody}`);
                }

                const aiData = await aiResponse.json();
                let textResponse = aiData.choices?.[0]?.message?.content || '{"insights":["-"], "cards":null}';
                
                let parsedData = { insights: ["-"], cards: null };
                try {
                    const jsonMatch = textResponse.match(/\{[\s\S]*\}/);
                    parsedData = JSON.parse(jsonMatch ? jsonMatch[0] : textResponse);
                    if (Array.isArray(parsedData.insights)) {
                        parsedData.insights = parsedData.insights.map(item => cleanMarkdown(item)).filter(i => i.trim().length > 5).slice(0, 8);
                    }
                } catch (err) {}

                return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(parsedData) };

            } catch (apiErr) {
                console.error("!!! GROQ ANALYZER ERROR !!!", apiErr.message);
                return { 
                    statusCode: 200, headers: corsHeaders, 
                    body: JSON.stringify({ 
                        insights: ["⚠️ SISTEM AI MENGALAMI KENDALA TEKNIS", `Pesan: ${apiErr.message}`], 
                        cards: null 
                    }) 
                };
            }
        }

        // ==========================================
        // ACTION 3: CHATBOT (GROQ + TAVILY AI ASSISTANT)
        // ==========================================
        if (action === 'chat') {
            const groqKey = process.env.GROQ_API_KEY;
            const tvlyKey = process.env.TAVILY_API_KEY;

            if (!groqKey) return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ reply: "Error: API Groq belum dikonfigurasi." }) };

            let internetContext = "";
            const needsInternet = message.toLowerCase().match(/(pasar|berita|tren|luar|bandingkan|saat ini|sekarang|2026|2027|harga|apa|siapa|kapan|dimana|kenapa|bagaimana|terbaru|hari ini)/);
            
            if (needsInternet && tvlyKey) {
                try {
                    const tvlyRes = await fetch('https://api.tavily.com/search', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ api_key: tvlyKey, query: message, search_depth: "basic", max_results: 2 }) // HEMAT: Turunkan hasil internet
                    });
                    if (tvlyRes.ok) {
                        const tvlyData = await tvlyRes.json();
                        if (tvlyData && tvlyData.results) internetContext = `\n[Internet Info: ${JSON.stringify(tvlyData.results)}]`;
                    }
                } catch(e) {}
            }

            const universalSystemPrompt = `Kamu adalah Dazer AI. Jangan pakai markdown.
Jawab dengan SANGAT SINGKAT, PADAT, dan TEPAT SASARAN (Maksimal 3-4 kalimat).
Konteks File: ${userContext}
${internetContext}`;

            try {
                const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        model: 'llama-3.3-70b-versatile', 
                        messages: [{ role: 'system', content: universalSystemPrompt }, { role: 'user', content: message }], 
                        temperature: 0.5,
                        max_tokens: 250 // HEMAT TOKEN: Batasi jawaban maksimal 250 token (sekitar ~180 kata)
                    })
                });

                if (!groqResponse.ok) {
                    const errBody = await groqResponse.text();
                    throw new Error(`HTTP ${groqResponse.status} - ${errBody}`);
                }

                const groqData = await groqResponse.json();
                let reply = cleanMarkdown(groqData.choices?.[0]?.message?.content || "Sistem telah memproses instruksi.");
                return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ reply }) };
            } catch (chatErr) {
                console.error("!!! GROQ CHATBOT ERROR !!!", chatErr.message);
                return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ reply: `⚠️ Error Chatbot: ${chatErr.message}` }) };
            }
        }

        return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ reply: "Aksi ditolak." }) };

    } catch (error) {
        console.error("Global Server Error:", error);
        return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ reply: `Interupsi sistem: ${error.message}`, insights: ["-"], cards: null }) };
    }
};
