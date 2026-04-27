// dazer-api.js - Backend KDD (V12 - 100% Pure Groq AI Architecture)
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
        
        // Kunci Groq Utama yang digunakan di seluruh aksi
        const groqKey = process.env.GROQ_API_KEY;

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
        // ACTION 2: ANALISA DASHBOARD (PURE GROQ)
        // Mengerjakan Kartu Eksekutif & Ceklis Tindakan
        // ==========================================
        if (action === 'analyze_data') {
            if (!groqKey) { 
                return { 
                    statusCode: 200, 
                    headers: corsHeaders, 
                    body: JSON.stringify({ insights: ["⚠️ API Key Groq Kosong! Harap isi di Netlify."], cards: null }) 
                }; 
            }

            // System prompt dioptimalkan dengan kata "JSON" agar Groq mengerti format strict
            const systemPrompt = `Kamu adalah AI Dazer Analytics. Konteks: ${userContext}.
Berdasarkan data statistik lokal, buat laporan untuk Dasbor Eksekutif.
Keluarkan HANYA format JSON valid. Wajib kembalikan format JSON persis seperti ini:
{
  "insights": [
    "Tindakan eksekutif 1 (Maksimal 3 kalimat padat).",
    "Tindakan eksekutif 2 (Maksimal 3 kalimat padat).",
    "Tindakan eksekutif 3 (Maksimal 3 kalimat padat)."
  ],
  "cards": {
    "metric": "Evaluasi performa metrik (2 kalimat padat)",
    "segment": "Evaluasi segmen prioritas (2 kalimat padat)",
    "correlation": "Evaluasi korelasi variabel (2 kalimat padat)",
    "volatility": "Evaluasi risiko dan anomali (2 kalimat padat)"
  }
}`;

            try {
                const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        model: 'llama-3.3-70b-versatile', 
                        messages: [
                            { role: 'system', content: systemPrompt }, 
                            { role: 'user', content: `Statistik Data Mentah:\n${data}` }
                        ], 
                        temperature: 0.2,
                        response_format: { type: "json_object" } // GARANSI 100% JSON GROQ
                    })
                });

                const aiData = await groqResponse.json();
                
                if (!groqResponse.ok) throw new Error(aiData.error?.message || "Unknown Groq Error");

                let textResponse = aiData.choices?.[0]?.message?.content || '{"insights":["-"], "cards":null}';
                
                let parsedData = { insights: ["-"], cards: null };
                try {
                    parsedData = JSON.parse(textResponse);
                    if (Array.isArray(parsedData.insights)) {
                        parsedData.insights = parsedData.insights.map(item => cleanMarkdown(item)).filter(i => i.trim().length > 5).slice(0, 7);
                    }
                } catch (err) {
                    console.error("Gagal parse JSON Groq");
                }

                return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(parsedData) };

            } catch (apiErr) {
                console.error("!!! GROQ ANALYZER ERROR !!!", apiErr.message);
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
            const universalSystemPrompt = `Kamu adalah Dazer AI. Jawab maks 3 kalimat padat. Jangan gunakan markdown bintang.
Konteks Data: ${userContext} 
Info Internet Tambahan: ${internetContext}`;

            try {
                const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        model: 'llama-3.3-70b-versatile', 
                        messages: [{ role: 'system', content: universalSystemPrompt }, { role: 'user', content: message }], 
                        temperature: 0.4,
                        max_tokens: 300 
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
        // ACTION 4: MODELING LAB (PURE GROQ + WOLFRAM)
        // Mengevaluasi hasil KDD dari model.html
        // ==========================================
        if (action === 'run_model') {
            const wolframId = process.env.WOLFRAM_APP_ID;

            if (!groqKey) { 
                return { 
                    statusCode: 200, 
                    headers: corsHeaders, 
                    body: JSON.stringify({ error: "API Key Groq Kosong!" }) 
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

            // Prompt untuk Groq
            const prompt = `Lakukan evaluasi Data Mining saintifik.
Teknik: ${modelType}
Algoritma: ${algorithm}
Hitungan Tambahan: ${mathValidation}
Sampel Data User: ${data}

Berikan output narasi eksekutif tentang pola yang berhasil ditambang, hubungannya dengan probabilitas anomali, dan akurasi data. Gunakan bahasa Indonesia baku dan terstruktur. Hindari penggunaan karakter bintang (*).`;

            try {
                const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        model: 'llama-3.3-70b-versatile', 
                        messages: [
                            { role: 'system', content: "Kamu adalah Data Scientist ahili di Dazer." }, 
                            { role: 'user', content: prompt }
                        ], 
                        temperature: 0.3
                    })
                });

                const groqData = await groqResponse.json();
                if (!groqResponse.ok) throw new Error(groqData.error?.message || "Unknown Groq Model Error");

                let modelResult = groqData.choices?.[0]?.message?.content;

                if (!modelResult) modelResult = "Model gagal dikalkulasi karena keterbatasan sampel data.";

                return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ result: cleanMarkdown(modelResult) }) };
            } catch (apiErr) {
                return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ error: apiErr.message }) };
            }
        }

        return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ reply: "Aksi ditolak." }) };

    } catch (error) {
        console.error("Global Server Error:", error);
        return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ reply: `Interupsi sistem: ${error.message}`, insights: ["-"], cards: null }) };
    }
};
