// dazer-api.js - Backend KDD (V20 Final - Quad-Cloud + Ultra-Clean Auth)
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
        if (limitData.count > 100) {
            return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ reply: "Sistem sibuk. Mohon tunggu 5 menit." }) };
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
        // ACTION 1: LOG AKTIVITAS (ADMIN)
        // ============================================================
        if (action === 'notify_register' || action === 'notify_upload') {
            if (emailPass) {
                try {
                    let transporter = nodemailer.createTransport({ service: 'gmail', auth: { user: 'dazer.help@gmail.com', pass: emailPass } });
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
                } catch (e) {}
            }
            return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ status: 'success' }) };
        }

        // ============================================================
        // ACTION 2: RESET PASSWORD (SIMPLE & CLEAN EMAIL)
        // ============================================================
        if (action === 'forgot_password') {
            if (emailPass && email) {
                try {
                    let transporter = nodemailer.createTransport({ service: 'gmail', auth: { user: 'dazer.help@gmail.com', pass: emailPass } });
                    
                    const host = event.headers.host || "dazer-premium.netlify.app";
                    const protocol = (host.includes("localhost") || host.includes("127.0.0.1")) ? "http" : "https";
                    const link = `${protocol}://${host}/auth.html?reset=true&email=${encodeURIComponent(email)}`;
                    
                    await transporter.sendMail({ 
                        from: '"Dazer" <dazer.help@gmail.com>', 
                        to: email, 
                        subject: `Pulihkan Akun Dazer Anda`, 
                        html: `
                            <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; max-width:480px; margin:0 auto; padding:40px 20px; color:#334155;">
                                <h1 style="font-size:24px; font-weight:800; color:#0f172a; margin-bottom:16px;">Pulihkan Akun</h1>
                                <p style="font-size:15px; line-height:1.6; color:#64748b; margin-bottom:32px;">Klik tombol di bawah untuk mengatur ulang kata sandi Anda. Tautan ini akan segera membawa Anda ke halaman pemulihan aman.</p>
                                <a href="${link}" style="display:inline-block; background-color:#0ea5e9; color:#ffffff; padding:14px 28px; border-radius:12px; font-weight:700; text-decoration:none; font-size:14px;">Atur Ulang Kata Sandi</a>
                                <p style="font-size:12px; color:#94a3b8; margin-top:40px; border-top:1px solid #f1f5f9; padding-top:20px;">
                                    Abaikan jika Anda tidak meminta ini.<br/>
                                    Diterbitkan oleh Dazer Analytics untuk <b>${email}</b>
                                </p>
                            </div>
                        `
                    });
                    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ message: "Tautan pemulihan telah dikirim ke email." }) };
                } catch (e) { return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ error: "Gagal mengirim email." }) }; }
            }
            return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ error: "Email tidak valid." }) };
        }

        // ============================================================
        // ACTION 3: ANALISA DASHBOARD
        // ============================================================
        if (action === 'analyze_data') {
            const systemPrompt = `Role: Senior Data Analyst. Output: JSON.Padat & eksekutif.
JSON Structure:
{
  "insights": ["Point 1", "Point 2", "Point 3", "Point 4"],
  "cards": {"metric": "...", "segment": "...", "correlation": "...", "volatility": "..."}
}`;

            let response;
            try {
                const res = await fetch('https://api.cerebras.ai/v1/chat/completions', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${cerebrasKey}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ model: 'llama3.1-70b', messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: `Statistik: ${data}` }], temperature: 0.1 })
                });
                response = await res.json();
            } catch (err) {
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
        // ACTION 4: CHATBOT (TAVILY GROUNDING)
        // ============================================================
        if (action === 'chat') {
            let webInfo = "";
            if (message.toLowerCase().match(/(berita|pasar|tren|terbaru|harga|2026|sekarang)/) && tvlyKey) {
                try {
                    const tvRes = await fetch('https://api.tavily.com/search', { 
                        method: 'POST', 
                        headers: { 'Content-Type': 'application/json' }, 
                        body: JSON.stringify({ api_key: tvlyKey, query: message, max_results: 1 }) 
                    });
                    const tvData = await tvRes.json();
                    if (tvData.results) webInfo = `[Web Ref: ${tvData.results[0].content.slice(0, 500)}]`;
                } catch(e) {}
            }

            const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    model: 'llama-3.3-70b-versatile', 
                    messages: [{ role: 'system', content: "Dazer AI Analyst. Jawab maks 3 kalimat Indonesia." }, { role: 'user', content: `Context: ${userContext} ${webInfo}\nQ: ${message}` }], 
                    temperature: 0.5, max_tokens: 350 
                })
            });
            const d = await res.json();
            return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ reply: cleanMarkdown(d.choices[0].message.content) }) };
        }

        // ============================================================
        // ACTION 5: MODELING LAB (GEMINI FLASH)
        // ============================================================
        if (action === 'run_model') {
            let wInfo = "";
            if (wolframId && modelType === 'Clustering') {
                try {
                    const wRes = await fetch(`http://api.wolframalpha.com/v1/result?appid=${wolframId}&i=kmeans+algorithm`);
                    if (wRes.ok) wInfo = await wRes.text();
                } catch(e) {}
            }

            const promptModel = `Task: KDD Evaluation. Method: ${modelType} | Algo: ${algorithm} | MathRef: ${wInfo}
Data Sample: ${smartDataTruncate(data, 5000)}
Berikan narasi profesional (Pola, Confidence, Akurasi, Rekomendasi). Indonesia.`;

            let finalRes = "";
            try {
                const gRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`, { 
                    method: 'POST', 
                    headers: { 'Content-Type': 'application/json' }, 
                    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: promptModel }] }] }) 
                });
                const gData = await gRes.json();
                finalRes = gData.candidates[0].content.parts[0].text;
            } catch (e) {
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

        return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ reply: "Aksi tidak dikenal." }) };

    } catch (err) {
        return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ reply: "Interupsi sistem.", error: err.message }) };
    }
};
