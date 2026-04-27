// dazer-api.js - Backend KDD (V14 Final - Quad-Cloud: Cerebras, Groq, Gemini, OpenRouter)
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

    // --- ANTI-SPAM BERBASIS IP ---
    const clientIp = event.headers['x-forwarded-for'] || event.headers['client-ip'] || 'unknown-ip';
    const currentTime = Date.now();
    const limitData = rateLimitMap.get(clientIp) || { count: 0, firstRequest: currentTime };
    
    if (currentTime - limitData.firstRequest > 600000) { 
        limitData.count = 1; limitData.firstRequest = currentTime; 
    } else {
        limitData.count += 1;
        if (limitData.count > 20) { 
            return { 
                statusCode: 200, headers: corsHeaders, 
                body: JSON.stringify({ 
                    reply: "Sistem mendeteksi lalu lintas tinggi. Mohon jeda 10 menit.", 
                    insights: ["Limit sistem tercapai. Harap tunggu beberapa saat."], 
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

        const { action, message, context: userContext, data, modelType, algorithm } = body;
        
        // Kunci-kunci Dewa dari Netlify
        const groqKey = process.env.GROQ_API_KEY;
        const cerebrasKey = process.env.CEREBRAS_API_KEY;
        const geminiKey = process.env.GEMINI_API_KEY;
        const openRouterKey = process.env.OPENROUTER_API_KEY;

        // ==========================================
        // ACTION 1: SILENT LOGGER (NODEMAILER)
        // ==========================================
        if (action === 'notify_upload' || (!action && body.sessionId && body.fileName)) {
            const emailPass = process.env.NODEMAILER_PASS; 
            if(emailPass) {
                try {
                    let transporter = nodemailer.createTransport({ 
                        service: 'gmail', 
                        auth: { user: 'dazer.help@gmail.com', pass: emailPass } 
                    });
                    
                    const emailContent = `=== DETAIL SESI KDD ===\nFile: ${body.fileName}\nUkuran: ${body.size}\nDimensi: ${body.dataDimension}`;

                    await transporter.sendMail({ 
                        from: '"Dazer Intelligence" <dazer.help@gmail.com>', 
                        to: "dazer.help@gmail.com", 
                        subject: `[DAZER] Aktivitas KDD Baru: ${body.fileName}`, 
                        text: emailContent 
                    });
                } catch (e) {}
            }
            return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ status: 'logged' }) };
        }

        // ==========================================
        // ACTION 2: ANALISA DASHBOARD (CEREBRAS -> GROQ)
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
                    // Coba 1: Cerebras (Super Kilat)
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
                    console.warn("Cerebras gagal, Fallback ke Groq...");
                    // Coba 2: Groq Llama 3
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
        // ACTION 3: CHATBOT (GROQ + TAVILY)
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
        // ACTION 4: MODELING LAB (GEMINI -> OPENROUTER)
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
                    // Truk Tronton 1: Gemini Native HTTP (Kapasitas 1 Juta Token)
                    if (!geminiKey) throw new Error("Gemini Key kosong");
                    const urlFlash = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`;
                    const res1 = await fetch(urlFlash, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }] })
                    });
                    
                    const data1 = await res1.json();
                    if (!res1.ok) throw new Error(data1.error?.message || "Unknown Flash Error");
                    modelResult = data1.candidates?.[0]?.content?.parts?.[0]?.text;

                } catch (err1) {
                    console.warn("Gemini gagal, memanggil bala bantuan OpenRouter...", err1.message);
                    
                    // Truk Tronton 2 (Penyelamat Anti-Mati): OpenRouter AI
                    if (!openRouterKey) throw new Error("OpenRouter Key juga kosong");
                    const res2 = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                        method: 'POST',
                        headers: { 
                            'Authorization': `Bearer ${openRouterKey}`, 
                            'Content-Type': 'application/json',
                            'HTTP-Referer': 'https://dazer-premium.netlify.app',
                            'X-Title': 'Dazer Analytics'
                        },
                        body: JSON.stringify({
                            model: 'google/gemini-1.5-flash', // Menembak Gemini 1.5 Flash via jalur OpenRouter (Bypass Google Network)
                            messages: [{ role: 'user', content: prompt }],
                            temperature: 0.3
                        })
                    });
                    
                    const data2 = await res2.json();
                    if (!res2.ok) throw new Error(data2.error?.message || "Unknown OpenRouter Error");
                    modelResult = data2.choices?.[0]?.message?.content;
                }

                if (!modelResult) modelResult = "Model gagal dikalkulasi karena keterbatasan sampel data.";

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
