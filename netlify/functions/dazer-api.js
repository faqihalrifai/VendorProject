// dazer-api.js - Backend KDD (V18 Final - Quad-Cloud + Token-Saver Logic)
const nodemailer = require('nodemailer');
const rateLimitMap = new Map();

/**
 * Membersihkan output markdown dari AI agar rapi saat ditampilkan di UI.
 */
function cleanMarkdown(text) {
    if (!text || typeof text !== 'string') return text;
    return text.replace(/[\*`]/g, '').replace(/(^|\n)#+\s/g, '$1').trim();
}

/**
 * Token-Saver Logic: Memastikan data yang dikirim ke AI tidak membengkak
 * namun tetap memberikan konteks yang kuat.
 */
function smartDataTruncate(dataStr, limit = 4000) {
    if (!dataStr) return "";
    if (dataStr.length <= limit) return dataStr;
    // Ambil bagian awal dan akhir data untuk mempertahankan struktur
    const half = Math.floor(limit / 2);
    return dataStr.slice(0, half) + "\n...[Data dipangkas demi efisiensi token]...\n" + dataStr.slice(-half);
}

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-forwarded-for, client-ip",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json"
};

exports.handler = async (event, context) => {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ message: "CORS OK" }) };
    }

    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }

    const clientIp = event.headers['x-forwarded-for'] || event.headers['client-ip'] || 'unknown';
    const currentTime = Date.now();
    const limitData = rateLimitMap.get(clientIp) || { count: 0, firstRequest: currentTime };
    
    if (currentTime - limitData.firstRequest > 600000) { 
        limitData.count = 1; limitData.firstRequest = currentTime; 
    } else {
        limitData.count += 1;
        if (limitData.count > 100) { // Limit ditingkatkan untuk efisiensi tinggi
            return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ reply: "Sistem mendeteksi aktivitas sangat padat. Mohon jeda 5 menit." }) };
        }
    }
    rateLimitMap.set(clientIp, limitData);

    try {
        const body = JSON.parse(event.body);
        const { action, message, context: userContext, data, modelType, algorithm, email, name, metadata } = body;
        
        const groqKey = process.env.GROQ_API_KEY;
        const cerebrasKey = process.env.CEREBRAS_API_KEY;
        const geminiKey = process.env.GEMINI_API_KEY;
        const openRouterKey = process.env.OPENROUTER_API_KEY;
        const emailPass = process.env.NODEMAILER_PASS;
        const tvlyKey = process.env.TAVILY_API_KEY;
        const wolframId = process.env.WOLFRAM_APP_ID;

        // ============================================================
        // ACTION 1: NOTIFIKASI REGISTRASI & AUDIT LOG (ADMIN)
        // ============================================================
        if (action === 'notify_register' || action === 'notify_upload') {
            if (emailPass) {
                try {
                    let transporter = nodemailer.createTransport({ service: 'gmail', auth: { user: 'dazer.help@gmail.com', pass: emailPass } });
                    const isReg = action === 'notify_register';
                    
                    const logContent = `
AUDIT LOG DAZER [${new Date().toISOString()}]
--------------------------------------------
USER    : ${name || 'User'} (${email || 'Google Auth'})
AKSI    : ${action.toUpperCase()}
DEVICE  : ${metadata?.device || 'N/A'}
IP      : ${metadata?.ip || 'Hidden'}
LOKASI  : ${metadata?.location || 'Unknown'}
ISP     : ${metadata?.isp || 'N/A'}
FILE    : ${body.fileName || '-'} (${body.size || '-'})
                    `;

                    await transporter.sendMail({ 
                        from: '"Dazer Audit" <dazer.help@gmail.com>', 
                        to: "dazer.help@gmail.com", 
                        subject: `[${action.toUpperCase()}] ${name || email}`, 
                        text: logContent 
                    });
                } catch (e) { console.error("Mail Log Error"); }
            }
            return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ status: 'success' }) };
        }

        // ============================================================
        // ACTION 2: RESET PASSWORD OTOMATIS (PREMIUM HTML EMAIL)
        // ============================================================
        if (action === 'forgot_password') {
            if (emailPass && email) {
                try {
                    let transporter = nodemailer.createTransport({ service: 'gmail', auth: { user: 'dazer.help@gmail.com', pass: emailPass } });
                    const link = `https://dazer-premium.netlify.app/auth.html?reset=true&email=${encodeURIComponent(email)}`;
                    
                    await transporter.sendMail({ 
                        from: '"Dazer Support" <dazer.help@gmail.com>', 
                        to: email, 
                        subject: `Instruksi Pemulihan Akun Dazer`, 
                        html: `<div style="font-family:sans-serif; max-width:500px; padding:30px; border:1px solid #e2e8f0; border-radius:15px; color:#1e293b;">
                                <h2 style="color:#0ea5e9;">Halo Pengguna,</h2>
                                <p>Klik tombol di bawah untuk mengatur ulang kata sandi Anda. Sesi ini hanya berlaku untuk perangkat Anda saat ini.</p>
                                <div style="text-align:center; margin:30px 0;">
                                    <a href="${link}" style="background:#0ea5e9; color:#fff; padding:12px 25px; text-decoration:none; border-radius:10px; font-weight:bold;">Atur Ulang Sandi</a>
                                </div>
                                <p style="font-size:11px; color:#94a3b8;">Abaikan jika Anda tidak meminta ini.</p>
                               </div>`
                    });
                    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ message: "Link pemulihan terkirim." }) };
                } catch (e) { return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ error: "Gagal mengirim email." }) }; }
            }
            return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ error: "Email tidak ditemukan." }) };
        }

        // ============================================================
        // ACTION 3: ANALISA DASHBOARD (TOKEN-SAVER PROMPT)
        // ============================================================
        if (action === 'analyze_data') {
            const systemPrompt = `Role: Senior Data Analyst. Output: JSON. 
Goal: Berikan sintesis eksekutif dari statistik. Irit kata, padat info.
JSON Structure:
{
  "insights": ["Point 1 (Tindakan)", "Point 2 (Tindakan)", "Point 3 (Tindakan)", "Point 4 (Tindakan)"],
  "cards": {"metric": "...", "segment": "...", "correlation": "...", "volatility": "..."}
}`;

            let response;
            try {
                // Priority 1: Cerebras (Kilat & Murah)
                const res = await fetch('https://api.cerebras.ai/v1/chat/completions', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${cerebrasKey}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ model: 'llama3.1-70b', messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: `Statistik: ${data}` }], temperature: 0.1 })
                });
                response = await res.json();
            } catch (err) {
                // Fallback 1: Groq
                const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ model: 'llama-3.3-70b-versatile', messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: `Statistik: ${data}` }], temperature: 0.1, response_format: { type: "json_object" } })
                });
                response = await res.json();
            }

            const rawText = response.choices[0].message.content;
            let parsed = { insights: ["Data tidak dapat dianalisis."], cards: null };
            try { parsed = JSON.parse(rawText.match(/\{[\s\S]*\}/)[0]); } catch (e) {}
            return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(parsed) };
        }

        // ============================================================
        // ACTION 4: CHATBOT (GROUNDING TAVILY + SMART TRUNCATE)
        // ============================================================
        if (action === 'chat') {
            let webInfo = "";
            // Cek apakah pertanyaan user butuh data internet
            if (message.toLowerCase().match(/(berita|pasar|tren|terbaru|harga|update|2026|sekarang)/) && tvlyKey) {
                try {
                    const tvRes = await fetch('https://api.tavily.com/search', { 
                        method: 'POST', 
                        headers: { 'Content-Type': 'application/json' }, 
                        body: JSON.stringify({ api_key: tvlyKey, query: message, search_depth: "basic", max_results: 1 }) 
                    });
                    const tvData = await tvRes.json();
                    if (tvData.results) webInfo = `[Web: ${tvData.results[0].content.slice(0, 500)}]`;
                } catch(e) {}
            }

            const sysChat = `Dazer AI Analyst. Jawab maks 3 kalimat. Bahasa Indonesia. Tanpa markdown. Gunakan konteks data & web jika relevan.`;
            const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    model: 'llama-3.3-70b-versatile', 
                    messages: [{ role: 'system', content: sysChat }, { role: 'user', content: `Context: ${userContext} ${webInfo}\nQ: ${message}` }], 
                    temperature: 0.5, max_tokens: 300 
                })
            });
            const d = await res.json();
            return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ reply: cleanMarkdown(d.choices[0].message.content) }) };
        }

        // ============================================================
        // ACTION 5: MODELING LAB (GEMINI ADVANCED + MATH VALIDATION)
        // ============================================================
        if (action === 'run_model') {
            let wInfo = "";
            if (wolframId && modelType === 'Clustering') {
                try {
                    const wRes = await fetch(`http://api.wolframalpha.com/v1/result?appid=${wolframId}&i=kmeans+math+theory`);
                    if (wRes.ok) wInfo = await wRes.text();
                } catch(e) {}
            }

            // Gunakan smart sampling untuk data besar agar hemat token di Gemini
            const sampledData = smartDataTruncate(data, 6000);

            const promptModel = `Task: Scientific KDD Evaluation. 
Method: ${modelType} | Algo: ${algorithm} | MathRef: ${wInfo}
Data Sample: ${sampledData}

Berikan narasi profesional (Pola, Confidence, Akurasi, Rekomendasi). Indonesia.`;

            let finalRes = "";
            try {
                // Primary: Gemini 1.5 Flash (Sangat murah & Konteks besar)
                const gRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`, { 
                    method: 'POST', 
                    headers: { 'Content-Type': 'application/json' }, 
                    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: promptModel }] }] }) 
                });
                const gData = await gRes.json();
                finalRes = gData.candidates[0].content.parts[0].text;
            } catch (e) {
                // Fallback: OpenRouter
                const oRes = await fetch('https://openrouter.ai/api/v1/chat/completions', { 
                    method: 'POST', 
                    headers: { 'Authorization': `Bearer ${openRouterKey}`, 'Content-Type': 'application/json' }, 
                    body: JSON.stringify({ model: 'google/gemini-1.5-flash', messages: [{ role: 'user', content: promptModel }] }) 
                });
                const oData = await oRes.json();
                finalRes = oData.choices[0].message.content;
            }
            return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ result: cleanMarkdown(finalRes) }) };
        }

        return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ reply: "Bad Request" }) };

    } catch (err) {
        return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ reply: "Interupsi Mesin.", error: err.message }) };
    }
};
