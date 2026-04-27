// dazer-api.js - Backend KDD (V15 Final - Quad-Cloud + Auth Automation)
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
        if (limitData.count > 30) { 
            return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ reply: "Lalu lintas tinggi. Mohon jeda sejenak." }) };
        }
    }
    rateLimitMap.set(clientIp, limitData);

    try {
        let body;
        try { body = JSON.parse(event.body); } 
        catch (err) { return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ reply: "Format request ditolak." }) }; }

        const { action, message, context: userContext, data, modelType, algorithm, email, name, metadata } = body;
        
        const groqKey = process.env.GROQ_API_KEY;
        const cerebrasKey = process.env.CEREBRAS_API_KEY;
        const geminiKey = process.env.GEMINI_API_KEY;
        const openRouterKey = process.env.OPENROUTER_API_KEY;
        const emailPass = process.env.NODEMAILER_PASS;

        // ==========================================
        // ACTION 1: NOTIFIKASI REGISTRASI & UPLOAD (NODEMAILER)
        // ==========================================
        if (action === 'notify_register' || action === 'notify_upload') {
            if(emailPass) {
                try {
                    let transporter = nodemailer.createTransport({ service: 'gmail', auth: { user: 'dazer.help@gmail.com', pass: emailPass } });
                    
                    let subject = action === 'notify_register' ? `[DAZER] User Baru Terdaftar: ${name || email}` : `[DAZER] Aktivitas KDD Baru: ${body.fileName}`;
                    
                    let emailContent = `=== DETAIL DATA ===\n`;
                    if (name) emailContent += `Nama: ${name}\n`;
                    if (email) emailContent += `Email: ${email}\n`;
                    if (body.fileName) emailContent += `File: ${body.fileName}\n`;
                    
                    emailContent += `\n=== METADATA PERANGKAT & LOKASI ===\n`;
                    if (metadata) {
                        emailContent += `IP Address : ${metadata.ip || '-'}\n`;
                        emailContent += `Lokasi     : ${metadata.location || '-'}\n`;
                        emailContent += `Perangkat  : ${metadata.device || '-'}\n`;
                        emailContent += `ISP/Org    : ${metadata.isp || '-'}\n`;
                        emailContent += `Waktu      : ${metadata.time || '-'}\n`;
                    }

                    await transporter.sendMail({ 
                        from: '"Dazer Intelligence" <dazer.help@gmail.com>', 
                        to: "dazer.help@gmail.com", 
                        subject: subject, 
                        text: emailContent 
                    });
                } catch (e) { console.error("Mail Error:", e.message); }
            }
            return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ status: 'success' }) };
        }

        // ==========================================
        // ACTION 2: LUPA KATA SANDI (OTOMATIS)
        // ==========================================
        if (action === 'forgot_password') {
            if(emailPass && email) {
                try {
                    let transporter = nodemailer.createTransport({ service: 'gmail', auth: { user: 'dazer.help@gmail.com', pass: emailPass } });
                    const resetLink = `https://dazer-premium.netlify.app/auth.html?reset=true&email=${encodeURIComponent(email)}`;
                    
                    await transporter.sendMail({ 
                        from: '"Dazer Support" <dazer.help@gmail.com>', 
                        to: email, 
                        subject: `[DAZER] Instruksi Pemulihan Kata Sandi`, 
                        html: `<div style="font-family:sans-serif; padding:20px; color:#1e293b;">
                                <h2>Halo,</h2>
                                <p>Kami menerima permintaan untuk mereset kata sandi akun Dazer Anda.</p>
                                <p>Silakan klik tautan di bawah ini untuk masuk kembali dan memperbarui keamanan Anda:</p>
                                <a href="${resetLink}" style="display:inline-block; padding:10px 20px; background:#0ea5e9; color:#fff; text-decoration:none; border-radius:5px;">Masuk & Reset Password</a>
                                <p style="margin-top:20px; font-size:12px; color:#94a3b8;">Jika Anda tidak merasa melakukan permintaan ini, abaikan email ini.</p>
                               </div>`
                    });
                    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ message: "Link pemulihan telah dikirim ke email Anda." }) };
                } catch (e) { return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ error: "Gagal mengirim email pemulihan." }) }; }
            }
            return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ error: "Email atau konfigurasi server tidak lengkap." }) };
        }

        // ==========================================
        // ACTION 3: ANALISA DASHBOARD (CEREBRAS -> GROQ)
        // ==========================================
        if (action === 'analyze_data') {
            const systemPrompt = `Kamu adalah AI Dazer Analytics. Konteks: ${userContext}.
Berdasarkan data statistik lokal, buat laporan untuk Dasbor Eksekutif HANYA dalam JSON valid:
{
  "insights": ["Tindakan eksekutif 1.", "Tindakan eksekutif 2."],
  "cards": {"metric": "...", "segment": "...", "correlation": "...", "volatility": "..."}
}`;

            try {
                let textResponse = "";
                try {
                    if (!cerebrasKey) throw new Error("Cerebras Key kosong");
                    const res1 = await fetch('https://api.cerebras.ai/v1/chat/completions', {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${cerebrasKey}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ 
                            model: 'llama3.1-70b', 
                            messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: `Statistik:\n${data}` }], 
                            temperature: 0.2
                        })
                    });
                    const data1 = await res1.json();
                    if (!res1.ok) throw new Error(data1.error?.message);
                    textResponse = data1.choices?.[0]?.message?.content;
                } catch (fallbackErr) {
                    const res2 = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ 
                            model: 'llama-3.3-70b-versatile', 
                            messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: `Statistik:\n${data}` }], 
                            temperature: 0.2, response_format: { type: "json_object" }
                        })
                    });
                    const data2 = await res2.json();
                    textResponse = data2.choices?.[0]?.message?.content;
                }

                if (!textResponse) textResponse = '{"insights":["-"], "cards":null}';
                let parsedData = { insights: ["-"], cards: null };
                try {
                    const jsonMatch = textResponse.match(/\{[\s\S]*\}/);
                    parsedData = JSON.parse(jsonMatch ? jsonMatch[0] : textResponse);
                    if (Array.isArray(parsedData.insights)) parsedData.insights = parsedData.insights.map(item => cleanMarkdown(item)).slice(0, 7);
                } catch (err) {}

                return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(parsedData) };
            } catch (apiErr) {
                return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ insights: ["⚠️ ERROR DASBOR", apiErr.message], cards: null }) };
            }
        }

        // ==========================================
        // ACTION 4: CHATBOT (GROQ + TAVILY)
        // ==========================================
        if (action === 'chat') {
            const tvlyKey = process.env.TAVILY_API_KEY;
            let internetContext = "";
            const needsInternet = message.toLowerCase().match(/(pasar|berita|tren|luar|bandingkan|sekarang|2026|harga|apa|siapa|terbaru|hari ini)/);
            
            if (needsInternet && tvlyKey) {
                try {
                    const tvlyRes = await fetch('https://api.tavily.com/search', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ api_key: tvlyKey, query: message, search_depth: "basic", max_results: 1 })
                    });
                    if (tvlyRes.ok) {
                        const tvlyData = await tvlyRes.json();
                        if (tvlyData && tvlyData.results) internetContext = `[NetInfo: ${JSON.stringify(tvlyData.results)}]`;
                    }
                } catch(e) {}
            }

            const universalSystemPrompt = `Kamu adalah Dazer AI. Jawab maks 3 kalimat padat. Tanpa markdown bintang.
Konteks: ${userContext} ${internetContext}`;

            try {
                const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                    method: 'POST', headers: { 'Authorization': `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        model: 'llama-3.3-70b-versatile', 
                        messages: [{ role: 'system', content: universalSystemPrompt }, { role: 'user', content: message }], 
                        temperature: 0.4, max_tokens: 300 
                    })
                });

                const groqData = await groqResponse.json();
                let reply = cleanMarkdown(groqData.choices?.[0]?.message?.content || "Sistem memproses instruksi.");
                return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ reply }) };
            } catch (chatErr) {
                return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ reply: `⚠️ Error Chat: ${chatErr.message}` }) };
            }
        }

        // ==========================================
        // ACTION 5: MODELING LAB (GEMINI -> OPENROUTER)
        // ==========================================
        if (action === 'run_model') {
            const wolframId = process.env.WOLFRAM_APP_ID;
            let mathValidation = "";
            
            if (wolframId && modelType === 'Clustering') {
                try {
                    const wolframQ = encodeURIComponent(`k-means clustering formula`);
                    const wRes = await fetch(`http://api.wolframalpha.com/v1/result?appid=${wolframId}&i=${wolframQ}`);
                    if (wRes.ok) mathValidation = await wRes.text();
                } catch(e) {}
            }

            const prompt = `Lakukan evaluasi Data Mining saintifik.
Teknik: ${modelType} | Algoritma: ${algorithm} | Hitungan Tambahan: ${mathValidation}
Sampel Data User: ${data}

Berikan output narasi eksekutif tentang pola yang berhasil ditambang, probabilitas anomali, dan akurasi data. Gunakan bahasa Indonesia baku.`;

            try {
                let modelResult = "";
                try {
                    if (!geminiKey) throw new Error("Gemini Key kosong");
                    const urlFlash = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`;
                    const res1 = await fetch(urlFlash, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }] })
                    });
                    const data1 = await res1.json();
                    if (!res1.ok) throw new Error(data1.error?.message);
                    modelResult = data1.candidates?.[0]?.content?.parts?.[0]?.text;
                } catch (err1) {
                    if (!openRouterKey) throw new Error("OpenRouter Key kosong");
                    const res2 = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${openRouterKey}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            model: 'google/gemini-1.5-flash',
                            messages: [{ role: 'user', content: prompt }],
                            temperature: 0.3
                        })
                    });
                    const data2 = await res2.json();
                    modelResult = data2.choices?.[0]?.message?.content;
                }
                return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ result: cleanMarkdown(modelResult) }) };
            } catch (apiErr) {
                return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ error: apiErr.message }) };
            }
        }

        return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ reply: "Aksi ditolak." }) };

    } catch (error) {
        return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ reply: `Interupsi sistem: ${error.message}`, insights: ["-"], cards: null }) };
    }
};
