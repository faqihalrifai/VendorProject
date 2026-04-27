// dazer-api.js - Backend KDD (V11 - Native Fetch API, Final Fix 1.5 Series)
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
        // ACTION 2: ANALISA DASHBOARD (GEMINI NATIVE HTTP)
        // Mengerjakan Kartu Eksekutif & Ceklis Tindakan
        // ==========================================
        if (action === 'analyze_data') {
            // Menggunakan Fallback Default Key sesuai instruksi
            const geminiKey = (process.env.GEMINI_API_KEY || "gen-lang-client-0971690214").trim();
            
            if (!geminiKey) { 
                return { 
                    statusCode: 200, 
                    headers: corsHeaders, 
                    body: JSON.stringify({ 
                        insights: ["⚠️ API Key Gemini Kosong!"], 
                        cards: null 
                    }) 
                }; 
            }

            const systemPrompt = `Kamu adalah AI Dazer Analytics. Konteks: ${userContext}.
Berdasarkan data statistik lokal, buat laporan untuk Dasbor Eksekutif.
Keluarkan HANYA format JSON valid tanpa markdown tambahan:
{
  "insights": [
    "Tindakan eksekutif 1 (Maksimal 3 kalimat).",
    "Tindakan eksekutif 2...",
    "Tindakan eksekutif 3..."
  ],
  "cards": {
    "metric": "Evaluasi performa metrik (2 kalimat padat)",
    "segment": "Evaluasi segmen prioritas (2 kalimat padat)",
    "correlation": "Evaluasi korelasi variabel (2 kalimat padat)",
    "volatility": "Evaluasi risiko dan anomali (2 kalimat padat)"
  }
}`;

            try {
                let textResponse = "";

                try {
                    // PERCOBAAN 1: Tembakan Langsung HTTP Native ke Gemini 1.5 Flash
                    const urlFlash = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`;
                    const res1 = await fetch(urlFlash, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            systemInstruction: { parts: [{ text: systemPrompt }] },
                            contents: [{ role: 'user', parts: [{ text: `Statistik Data Mentah:\n${data}` }] }],
                            generationConfig: { temperature: 0.2, responseMimeType: "application/json" }
                        })
                    });
                    
                    const data1 = await res1.json();
                    if (!res1.ok) throw new Error(data1.error?.message || "Unknown Flash Error");
                    textResponse = data1.candidates?.[0]?.content?.parts?.[0]?.text;

                } catch (err1) {
                    console.warn("Flash HTTP gagal, beralih ke gemini-1.5-pro (Native)...", err1.message);
                    
                    // PERCOBAAN 2: Tembakan Langsung HTTP Native ke Gemini 1.5 Pro
                    const urlPro = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${geminiKey}`;
                    const res2 = await fetch(urlPro, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            systemInstruction: { parts: [{ text: systemPrompt }] },
                            contents: [{ role: 'user', parts: [{ text: `Statistik Data Mentah:\n${data}` }] }],
                            generationConfig: { temperature: 0.2, responseMimeType: "application/json" }
                        })
                    });
                    
                    const data2 = await res2.json();
                    if (!res2.ok) throw new Error(data2.error?.message || "Unknown Fallback Error");
                    textResponse = data2.candidates?.[0]?.content?.parts?.[0]?.text;
                }

                if (!textResponse) textResponse = '{"insights":["-"], "cards":null}';
                
                let parsedData = { insights: ["-"], cards: null };
                try {
                    const jsonMatch = textResponse.match(/\{[\s\S]*\}/);
                    parsedData = JSON.parse(jsonMatch ? jsonMatch[0] : textResponse);
                    if (Array.isArray(parsedData.insights)) {
                        parsedData.insights = parsedData.insights.map(item => cleanMarkdown(item)).filter(i => i.trim().length > 5).slice(0, 7);
                    }
                } catch (err) {
                    console.error("Gagal parse JSON Gemini");
                }

                return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(parsedData) };

            } catch (apiErr) {
                console.error("!!! GEMINI ANALYZER ERROR !!!", apiErr.message);
                return { 
                    statusCode: 200, headers: corsHeaders, 
                    body: JSON.stringify({ 
                        insights: ["⚠️ MESIN ANALISIS MENGALAMI KENDALA", `Pesan: ${apiErr.message}`], cards: null 
                    }) 
                };
            }
        }

        // ==========================================
        // ACTION 3: CHATBOT (GROQ + TAVILY)
        // Otak interaktif yang super cepat
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
        // Mengevaluasi hasil KDD dari model.html
        // ==========================================
        if (action === 'run_model') {
            const geminiKey = (process.env.GEMINI_API_KEY || "gen-lang-client-0971690214").trim();
            const wolframId = process.env.WOLFRAM_APP_ID;

            if (!geminiKey) { 
                return { 
                    statusCode: 200, 
                    headers: corsHeaders, 
                    body: JSON.stringify({ error: "API Key Gemini Kosong!" }) 
                }; 
            }

            let mathValidation = "";
            // Simulasi Perhitungan Matematis Presisi via Wolfram Alpha jika APP ID tersedia
            if (wolframId && modelType === 'Clustering') {
                try {
                    const wolframQ = encodeURIComponent(`k-means clustering definition and formula`);
                    const wRes = await fetch(`http://api.wolframalpha.com/v1/result?appid=${wolframId}&i=${wolframQ}`);
                    if (wRes.ok) mathValidation = await wRes.text();
                } catch(e) {}
            }

            // Prompt untuk Gemini
            const prompt = `Lakukan evaluasi Data Mining saintifik.
Teknik: ${modelType}
Algoritma: ${algorithm}
Hitungan Tambahan: ${mathValidation}
Sampel Data User: ${data}

Berikan output narasi eksekutif tentang pola yang berhasil ditambang, hubungannya dengan probabilitas anomali, dan akurasi data. Gunakan bahasa Indonesia baku dan terstruktur.`;

            try {
                let modelResult = "";

                try {
                    // Percobaan 1 HTTP Native (Flash)
                    const urlFlash = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`;
                    const res1 = await fetch(urlFlash, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            contents: [{ role: 'user', parts: [{ text: prompt }] }]
                        })
                    });
                    
                    const data1 = await res1.json();
                    if (!res1.ok) throw new Error(data1.error?.message || "Unknown Flash Error");
                    modelResult = data1.candidates?.[0]?.content?.parts?.[0]?.text;

                } catch (err1) {
                    console.warn("Flash (Model) gagal, beralih ke gemini-1.5-pro (Native)...", err1.message);
                    
                    // Percobaan 2 HTTP Native (Fallback 1.5 Pro)
                    const urlPro = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${geminiKey}`;
                    const res2 = await fetch(urlPro, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            contents: [{ role: 'user', parts: [{ text: prompt }] }]
                        })
                    });
                    
                    const data2 = await res2.json();
                    if (!res2.ok) throw new Error(data2.error?.message || "Unknown Fallback Error");
                    modelResult = data2.candidates?.[0]?.content?.parts?.[0]?.text;
                }

                if (!modelResult) modelResult = "Model gagal dikalkulasi karena keterbatasan sampel data.";

                return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ result: cleanMarkdown(modelResult) }) };
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
