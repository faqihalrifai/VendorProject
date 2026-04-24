// dazer-api.js - Backend KDD & AI Strategist (V5 Netlify Functions Optimized)
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
    
    if (currentTime - limitData.firstRequest > 60000) { limitData.count = 1; limitData.firstRequest = currentTime; } 
    else {
        limitData.count += 1;
        if (limitData.count > 30) return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ reply: "Lalu lintas tinggi. Mohon jeda sesaat.", insights: ["-"], cards: null }) };
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
                    
                    // Format email tingkat lanjut sesuai permintaan
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
        // ACTION 2: ANALISA KDD UTAMA (FULL DEEPSEEK API)
        // ==========================================
        if (action === 'analyze_data') {
            const deepseekKey = process.env.DEEPSEEK_API_KEY; 

            if (!deepseekKey) return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ insights: ["Error: API DeepSeek belum dimasukkan di Environment Variables Netlify."], cards: null }) };

            const dsPrompt = `Kamu adalah analis data inti Dazer AI. Analisis statistik berikut secara komprehensif. Konteks: ${userContext}.
            Tugasmu adalah MENGANALISIS data dan MENGEMBALIKAN OUTPUT DALAM FORMAT JSON MURNI dengan struktur berikut:
            {
              "insights": ["aksi tajam 1", "aksi tajam 2", "aksi tajam 3", "aksi tajam 4", "aksi tajam 5", "aksi tajam 6", "aksi tajam 7"],
              "cards": {
                "metric": "Rangkuman performa...",
                "segment": "Rangkuman segmen...",
                "correlation": "Rangkuman korelasi...",
                "volatility": "Rangkuman volatilitas..."
              }
            }
            ATURAN PENTING:
            1. "insights" harus berisi TEPAT 7 hingga 8 poin tindakan eksekutif murni (langsung ke intinya, tanpa basa-basi).
            2. "cards" harus berisi analisis singkat (maks 2 kalimat) untuk tiap aspek.
            3. WAJIB HANYA MENGEMBALIKAN JSON MURNI menggunakan mode respons JSON.`;

            try {
                const dsResponse = await fetch('https://api.deepseek.com/chat/completions', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${deepseekKey}` },
                    body: JSON.stringify({ 
                        model: 'deepseek-chat', 
                        messages: [
                            { role: 'system', content: dsPrompt }, 
                            { role: 'user', content: `Statistik Data: ${data}` }
                        ], 
                        temperature: 0.1,
                        response_format: { type: "json_object" } // Deepseek akan merespon langsung dengan JSON utuh
                    })
                });

                if (!dsResponse.ok) {
                    const errBody = await dsResponse.text();
                    throw new Error(`[HTTP ${dsResponse.status}] ${errBody}`);
                }

                const dsData = await dsResponse.json();
                let textResponse = dsData.choices?.[0]?.message?.content || '{"insights":["-"], "cards":null}';
                
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
                console.error("!!! DEEPSEEK ERROR !!!", apiErr.message);
                return { 
                    statusCode: 200, 
                    headers: corsHeaders, 
                    body: JSON.stringify({ 
                        insights: [
                            "⚠️ SISTEM AI MENGALAMI KENDALA TEKNIS KONEKSI ⚠️",
                            `Pesan Error: ${apiErr.message}`,
                            "Silakan cek ulang pengaturan koneksi DeepSeek atau coba sesaat lagi."
                        ], 
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
                        body: JSON.stringify({ api_key: tvlyKey, query: message, search_depth: "basic", max_results: 3 })
                    });
                    if (tvlyRes.ok) {
                        const tvlyData = await tvlyRes.json();
                        if (tvlyData && tvlyData.results) internetContext = `\n[Internet: ${JSON.stringify(tvlyData.results)}]`;
                    }
                } catch(e) {}
            }

            const universalSystemPrompt = `Kamu adalah Dazer AI. Jangan pakai markdown.
            Konteks File: ${userContext}
            ${internetContext}`;

            try {
                const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        model: 'llama-3.3-70b-versatile', 
                        messages: [{ role: 'system', content: universalSystemPrompt }, { role: 'user', content: message }], 
                        temperature: 0.6 
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
                console.error("!!! GROQ ERROR !!!", chatErr.message);
                return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ reply: `⚠️ Error Chatbot: ${chatErr.message}` }) };
            }
        }

        return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ reply: "Aksi ditolak." }) };

    } catch (error) {
        console.error("Global Server Error:", error);
        return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ reply: `Interupsi sistem: ${error.message}`, insights: ["-"], cards: null }) };
    }
};
