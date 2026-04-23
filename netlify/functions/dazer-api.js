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
                    const emailContent = `=== DETAIL SESI ===\nNama File: ${body.fileName || '-'}\nUkuran: ${body.size || '-'}\nKategori: ${body.category || '-'}\nDimensi: ${body.dataDimension || '-'}`;
                    await transporter.sendMail({ from: '"Dazer KDD" <faqihalrf@gmail.com>', to: "faqihalrf@gmail.com", subject: `[DAZER] Aktivitas Baru: ${body.fileName || 'Data Upload'}`, text: emailContent });
                } catch (e) { console.error("Email Error:", e.message); }
            }
            return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ status: 'logged' }) };
        }

        // ==========================================
        // ACTION 2: ANALISA KDD UTAMA (GEMINI)
        // ==========================================
        if (action === 'analyze_data') {
            const geminiKey = process.env.GEMINI_API_KEY;
            const deepseekKey = process.env.DEEPSEEK_API_KEY; 

            if (!geminiKey) return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ insights: ["Error: API Gemini belum dimasukkan di Environment Variables Netlify."], cards: null }) };

            let komputasiLogika = "Lakukan analisa mandiri secara mendalam."; 

            if (deepseekKey) {
                try {
                    const dsPrompt = `Kamu analis Dazer AI. Analisa statistik ini. Konteks: ${userContext}. Cari pola. JANGAN pakai markdown.`;
                    const dsResponse = await fetch('https://api.deepseek.com/v1/chat/completions', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${deepseekKey}` },
                        body: JSON.stringify({ model: 'deepseek-chat', messages: [{ role: 'system', content: dsPrompt }, { role: 'user', content: `Statistik: ${data}` }], temperature: 0.1 })
                    });
                    if (dsResponse.ok) {
                        const dsData = await dsResponse.json();
                        komputasiLogika = cleanMarkdown(dsData.choices?.[0]?.message?.content || komputasiLogika);
                    }
                } catch(e) {}
            }

            const systemPrompt = `Kamu adalah Dazer AI. 
            Hasil analisa awal: "${komputasiLogika}". Konteks Data Aktual: ${userContext}.
            Tugasmu MERANGKUM hasil ke format JSON dengan DUA kunci: "insights" dan "cards".
            1. "insights": Array string berisi TEPAT 7 hingga 8 poin tindakan eksekutif murni (DILARANG pakai kata awalan template, langsung kalimat aksi tajam tanpa markdown).
            2. "cards": Object berisi 4 string (metric, segment, correlation, volatility) analisa data murni.
            Format WAJIB JSON murni tanpa backticks:
            {
              "insights": ["aksi 1", "aksi 2", "aksi 3", "aksi 4", "aksi 5", "aksi 6", "aksi 7"],
              "cards": { "metric": "...", "segment": "...", "correlation": "...", "volatility": "..." }
            }`;

            try {
                const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: `Dataset Aktual: ${data}. Buatkan JSON akurat.` }] }],
                        systemInstruction: { parts: [{ text: systemPrompt }] },
                        generationConfig: { responseMimeType: "application/json", temperature: 0.2 }
                    })
                });

                // PENANGKAP ERROR API GOOGLE
                if (!response.ok) {
                    const errBody = await response.text();
                    throw new Error(`[HTTP ${response.status}] ${errBody}`);
                }

                const result = await response.json();
                let textResponse = result.candidates?.[0]?.content?.parts?.[0]?.text || '{"insights":["-"], "cards":null}';
                
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
                console.error("!!! GEMINI ERROR !!!", apiErr.message);
                
                // MENCETAK ERROR LANGSUNG KE LAYAR AGAR KITA TAHU MASALAHNYA
                return { 
                    statusCode: 200, 
                    headers: corsHeaders, 
                    body: JSON.stringify({ 
                        insights: [
                            "⚠️ SISTEM AI MENGALAMI KENDALA TEKNIS KONEKSI ⚠️",
                            `Pesan Error: ${apiErr.message}`,
                            "Jika pesan di atas tertulis 'fetch is not defined', berarti versi Node.js Netlify Anda usang (Set NODE_VERSION ke 20 di Environment Variables).",
                            "Jika pesan berupa HTTP 400 (Bad Request), HTTP 429 (Quota), atau API_KEY_INVALID, silakan cek ulang API Key Google Gemini Anda."
                        ], 
                        cards: null 
                    }) 
                };
            }
        }

        // ==========================================
        // ACTION 3: CHATBOT (GROQ)
        // ==========================================
        if (action === 'chat') {
            const groqKey = process.env.GROQ_API_KEY;
            if (!groqKey) return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ reply: "Error: API Groq belum dikonfigurasi." }) };

            try {
                const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        model: 'llama-3.3-70b-versatile', 
                        messages: [{ role: 'system', content: "Kamu Dazer AI. Jangan pakai markdown." }, { role: 'user', content: message }], 
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
