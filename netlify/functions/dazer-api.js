// dazer-api.js - Backend KDD (V9 - Multi-API: DeepSeek, Groq, Gemini, Wolfram, Tavily)
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
                    
                    const emailContent = `=== DETAIL SESI KDD ===
File         : ${body.fileName || '-'}
Ukuran       : ${body.size || '-'}
Dimensi Data : ${body.dataDimension || '-'}
Sektor       : ${body.category || '-'}

=== INFO PERANGKAT & LOKASI ===
ID Sesi      : ${body.sessionId || '-'}
Perangkat    : ${body.device || '-'}
IP Address   : ${body.ipAddress || '-'}
Lokasi       : ${body.location || '-'}
Waktu Lokal  : ${body.localTime || '-'}`;

                    await transporter.sendMail({ 
                        from: '"Dazer Intelligence" <dazer.help@gmail.com>', 
                        to: "dazer.help@gmail.com", 
                        subject: `[DAZER] Aktivitas KDD Baru: ${body.fileName || 'Data Upload'}`, 
                        text: emailContent 
                    });
                } catch (e) { console.error("Email Error:", e.message); }
            }
            return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ status: 'logged' }) };
        }

        // ==========================================
        // ACTION 2: ANALISA DASHBOARD (DEEPSEEK API)
        // ==========================================
        if (action === 'analyze_data') {
            const dsKey = process.env.DEEPSEEK_API_KEY; 
            if (!dsKey) return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ insights: ["Error: API DeepSeek belum dikonfigurasi."], cards: null }) };

            // SYSTEM PROMPT SANGAT RINGKAS (HEMAT TOKEN)
            const systemPrompt = `Kamu AI Dazer. Konteks: ${userContext}. Jawab HANYA format JSON valid tanpa markdown teks luar:
{"insights":["3 kalimat tindakan eksekutif.","3 kalimat... (total 7 poin)"],"cards":{"metric":"2 kalimat padat","segment":"2 kalimat padat","correlation":"2 kalimat padat","volatility":"2 kalimat padat"}}`;

            try {
                // Memanggil DeepSeek Chat API
                const aiResponse = await fetch('https://api.deepseek.com/chat/completions', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${dsKey}` },
                    body: JSON.stringify({ 
                        model: 'deepseek-chat', 
                        messages: [
                            { role: 'system', content: systemPrompt }, 
                            { role: 'user', content: `Statistik Data Lokal: ${data}` }
                        ], 
                        temperature: 0.2, 
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
                        parsedData.insights = parsedData.insights.map(item => cleanMarkdown(item)).filter(i => i.trim().length > 5).slice(0, 7);
                    }
                } catch (err) {}

                return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(parsedData) };

            } catch (apiErr) {
                console.error("!!! DEEPSEEK ANALYZER ERROR !!!", apiErr.message);
                return { 
                    statusCode: 200, headers: corsHeaders, 
                    body: JSON.stringify({ 
                        insights: ["⚠️ SISTEM AI MENGALAMI KENDALA", `Pesan: ${apiErr.message}`], cards: null 
                    }) 
                };
            }
        }

        // ==========================================
        // ACTION 3: CHATBOT (GROQ + TAVILY)
        // ==========================================
        if (action === 'chat') {
            const groqKey = process.env.GROQ_API_KEY;
            const tvlyKey = process.env.TAVILY_API_KEY;

            if (!groqKey) return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ reply: "Error: API Groq belum dikonfigurasi." }) };

            let internetContext = "";
            const needsInternet = message.toLowerCase().match(/(pasar|berita|tren|luar|bandingkan|sekarang|2026|harga|apa|siapa|terbaru|hari ini)/);
            
            if (needsInternet && tvlyKey) {
                try {
                    const tvlyRes = await fetch('https://api.tavily.com/search', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ api_key: tvlyKey, query: message, search_depth: "basic", max_results: 1 }) // HEMAT: Max 1 hasil
                    });
                    if (tvlyRes.ok) {
                        const tvlyData = await tvlyRes.json();
                        if (tvlyData && tvlyData.results) internetContext = `[NetInfo: ${JSON.stringify(tvlyData.results)}]`;
                    }
                } catch(e) {}
            }

            // PROMPT RINGKAS
            const universalSystemPrompt = `Dazer AI. Jawab maks 3 kalimat padat. Tanpa markdown bintang.
Konteks: ${userContext} ${internetContext}`;

            try {
                const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        model: 'llama-3.3-70b-versatile', 
                        messages: [{ role: 'system', content: universalSystemPrompt }, { role: 'user', content: message }], 
                        temperature: 0.4,
                        max_tokens: 200 // Hemat Token Chat
                    })
                });

                const groqData = await groqResponse.json();
                let reply = cleanMarkdown(groqData.choices?.[0]?.message?.content || "Sistem telah memproses instruksi.");
                return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ reply }) };
            } catch (chatErr) {
                return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ reply: `⚠️ Error Chat: ${chatErr.message}` }) };
            }
        }

        // ==========================================
        // ACTION 4: MODELING LAB (GEMINI + WOLFRAM)
        // Disiapkan untuk halaman model.html
        // ==========================================
        if (action === 'run_model') {
            const geminiKey = process.env.GEMINI_API_KEY;
            const wolframId = process.env.WOLFRAM_APP_ID;

            if (!geminiKey) return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ error: "API Gemini belum dikonfigurasi." }) };

            let mathValidation = "";
            // Simulasi Perhitungan Matematis Presisi via Wolfram Alpha jika APP ID tersedia
            if (wolframId && modelType === 'Clustering') {
                try {
                    const wolframQ = encodeURIComponent(`k-means clustering definition and formula`);
                    const wRes = await fetch(`http://api.wolframalpha.com/v1/result?appid=${wolframId}&i=${wolframQ}`);
                    if (wRes.ok) mathValidation = await wRes.text();
                } catch(e) {}
            }

            // Prompt untuk Gemini 1.5 Flash
            const prompt = `Lakukan simulasi Data Mining.
Teknik: ${modelType}
Algoritma: ${algorithm}
Hitungan Wolfram: ${mathValidation}
Data User: ${data}
Evaluasi pola ini dan berikan output narasi hasil evaluasi akurasi/pembagian datanya secara saintifik.`;

            try {
                const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: prompt }] }]
                    })
                });

                const geminiData = await geminiRes.json();
                const modelResult = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "Model gagal dikalkulasi.";

                return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ result: modelResult }) };
            } catch (geminiErr) {
                return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ error: geminiErr.message }) };
            }
        }

        return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ reply: "Aksi ditolak." }) };

    } catch (error) {
        console.error("Global Server Error:", error);
        return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ reply: `Interupsi sistem: ${error.message}`, insights: ["-"], cards: null }) };
    }
};
