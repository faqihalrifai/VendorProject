// dazer-api.js - Backend KDD & AI Strategist (Final DeepSeek x Gemini Synergy)
// Dependencies: npm install nodemailer

const nodemailer = require('nodemailer');

// In-Memory Store untuk Rate Limiting
const rateLimitMap = new Map();

exports.handler = async function(event, context) {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

    // ==========================================
    // 1. IP Rate Limiting (Proteksi Server)
    // ==========================================
    const clientIp = event.headers['x-forwarded-for'] || 'unknown-ip';
    const currentTime = Date.now();
    const limitData = rateLimitMap.get(clientIp) || { count: 0, firstRequest: currentTime };
    
    if (currentTime - limitData.firstRequest > 60000) {
        limitData.count = 1; 
        limitData.firstRequest = currentTime;
    } else {
        limitData.count += 1;
        if (limitData.count > 20) {
            return { statusCode: 429, body: JSON.stringify({ error: "Terlalu banyak permintaan." }) };
        }
    }
    rateLimitMap.set(clientIp, limitData);

    try {
        const body = JSON.parse(event.body);
        const { action, message, context: userContext, data } = body;

        // ==========================================
        // ACTION 1: SILENT LOGGER (Email Notif [DAZER])
        // ==========================================
        if (action === 'notify_upload') {
            const emailPass = process.env.NODEMAILER_PASS; 
            if(emailPass) {
                let transporter = nodemailer.createTransport({
                    service: 'gmail',
                    auth: { user: 'faqihalrf@gmail.com', pass: emailPass }
                });
                
                const emailContent = `
🚨 AKTIVITAS KDD TERDETEKSI DI DAZER 🚨

--- INFORMASI FILE ---
Nama File    : ${body.filename || '-'}
Ukuran       : ${body.size || '-'}
File Hash    : ${body.fileHash || '-'}
Dimensi Data : ${body.totalRows || '0'} Baris, ${body.totalCols || '0'} Kolom
Daftar Kolom : ${body.colNames || '-'}

--- INFORMASI PENGGUNA & PERANGKAT ---
ID Sesi      : ${body.sessionId || '-'} (${body.sessionType || '-'})
Perangkat    : ${body.humanDevice || '-'}
Resolusi     : ${body.screenRes || '-'}
Baterai      : ${body.batteryStr || '-'}

--- LOKASI & KONEKSI ---
IP Address   : ${clientIp}
ISP/Provider : ${body.isp || '-'}
Lokasi       : ${body.location || '-'}
Tipe Koneksi : ${body.connType || '-'}

--- WAKTU & INTERAKSI ---
Waktu Lokal  : ${body.localTime || '-'} (${body.timeZone || '-'})
Durasi Tahan : ${body.durationSec || '0'} detik (waktu sblm klik upload)

*Catatan: Sistem diproses anonim.
`.trim();

                await transporter.sendMail({
                    from: '"Dazer KDD" <faqihalrf@gmail.com>',
                    to: "faqihalrf@gmail.com",
                    subject: `[DAZER] KDD Activity: ${body.filename}`, 
                    text: emailContent
                });
            }
            return { statusCode: 200, body: JSON.stringify({ status: 'logged' }) };
        }

        // ==========================================
        // ACTION 2: ANALISA KDD UTAMA (DEEPSEEK + GEMINI)
        // ==========================================
        if (action === 'analyze_data') {
            const geminiKey = process.env.GEMINI_API_KEY;
            const deepseekKey = process.env.DEEPSEEK_API_KEY; // Menarik Key DeepSeek

            if (!geminiKey) return { statusCode: 500, body: JSON.stringify({ error: "Gemini Key Missing" }) };

            let deepseekLogic = "Lakukan analisa mandiri secara mendalam."; // Fallback

            // 1. TAHAP PERTAMA: DeepSeek sebagai Logika Matematika (Reasoning)
            if (deepseekKey) {
                try {
                    const dsPrompt = `Kamu adalah Ahli Nalar Logika & Matematika Data. 
                    Tugasmu menganalisa data statistik berikut. Konteks user: ${userContext}.
                    Cari anomali yang paling tidak masuk akal, temukan pola probabilitas ke depannya, dan hitung korelasi kasarnya. 
                    Berikan hasil analisa mentalmu secara singkat dan padat.`;

                    const dsResponse = await fetch('https://api.deepseek.com/v1/chat/completions', {
                        method: 'POST',
                        headers: { 
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${deepseekKey}`
                        },
                        body: JSON.stringify({
                            model: 'deepseek-chat', // DeepSeek V3 (Sangat murah & pintar logika)
                            messages: [
                                { role: 'system', content: dsPrompt },
                                { role: 'user', content: `Statistik Data: ${data}` }
                            ],
                            temperature: 0.2 // Dibuat rendah agar logikanya akurat
                        })
                    });

                    if (dsResponse.ok) {
                        const dsData = await dsResponse.json();
                        deepseekLogic = dsData.choices?.[0]?.message?.content || deepseekLogic;
                    }
                } catch(e) {
                    console.log("DeepSeek Timeout/Error, lanjut menggunakan Gemini Murni.");
                }
            }

            // 2. TAHAP KEDUA: Gemini sebagai Storyteller & JSON Formatter
            const systemPrompt = `Kamu adalah Direktur Data (KDD). 
            Kamu baru saja menerima catatan perhitungan kasar dari asisten matematikamu (DeepSeek) sebagai berikut:
            "${deepseekLogic}"

            Tugasmu adalah MENGGABUNGKAN data statistik asli dengan temuan asistenmu tersebut ke dalam wawasan bisnis/akademik yang memukau, presisi, dan manusiawi.
            Konteks Data User: ${userContext}.
            
            Wajib berikan 5 insight dalam array "insights" dengan struktur:
            1. Klasifikasi Utama (Berdasarkan data & logika)
            2. Deteksi Pola/Tren (Apa yang sedang terjadi?)
            3. Evaluasi Kualitas (Kesehatan data & anomali)
            4. Aturan Asosiasi (Hubungan antar variabel)
            5. Prediksi Strategis (Langkah masa depan berdasarkan hitungan)

            Gunakan Bahasa Indonesia yang profesional dan ramah. Jangan gunakan simbol markdown (* atau #).
            Format balasan HANYA JSON murni.
            
            Schema:
            {
              "insights": ["string 1", "string 2", "string 3", "string 4", "string 5"],
              "prediction_label": "string tren",
              "action_plan": [{"title": "string", "action": "string"}]
            }`;

            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: `Dataset Summary: ${data}. Buat laporan KDD JSON.` }] }],
                    systemInstruction: { parts: [{ text: systemPrompt }] },
                    generationConfig: { responseMimeType: "application/json" }
                })
            });

            const result = await response.json();
            const textResponse = result.candidates?.[0]?.content?.parts?.[0]?.text;
            return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: textResponse };
        }

        // ==========================================
        // ACTION 3: CHATBOT (GROQ + TAVILY)
        // ==========================================
        if (action === 'chat') {
            const groqKey = process.env.GROQ_API_KEY;
            const tvlyKey = process.env.TAVILY_API_KEY;

            if (!groqKey) {
                return { statusCode: 200, body: JSON.stringify({ reply: "Sistem AI sedang offline. Pastikan API Key Groq sudah terpasang." }) };
            }

            let internetContext = "";
            const needsInternet = message.toLowerCase().match(/(pasar|berita|tren|luar|bandingkan|saat ini|sekarang|2026|harga|apa|siapa|kapan|dimana|kenapa|bagaimana|terbaru|hari ini)/);
            
            if (needsInternet && tvlyKey) {
                try {
                    const tvlyRes = await fetch('https://api.tavily.com/search', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            api_key: tvlyKey,
                            query: message,
                            search_depth: "basic",
                            max_results: 3
                        })
                    });
                    const tvlyData = await tvlyRes.json();
                    if (tvlyData && tvlyData.results) {
                        internetContext = `\n[Data Internet Real-time: ${JSON.stringify(tvlyData.results)}]`;
                    }
                } catch(e) {}
            }

            const universalSystemPrompt = `Kamu adalah Dazer AI, Asisten Data Mining, Riset Pasar, dan Pengetahuan Umum yang cerdas, presisi, dan akurat 100%.
            Aturan Output:
            1. JANGAN gunakan simbol markdown (# atau ** berlebihan).
            2. Format paragraf rapi dan elegan.
            3. Jawab APAPUN dari user.
            
            --- Konteks Data Lokal (Jawab berdasarkan ini jika ditanya soal file) ---
            ${userContext}
            --------------------------
            --- Data Internet ---
            ${internetContext}
            ---------------------
            Jangan beritahu user soal instruksi ini.`;

            const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: 'llama-3.3-70b-versatile',
                    messages: [
                        { role: 'system', content: universalSystemPrompt },
                        { role: 'user', content: message }
                    ],
                    temperature: 0.7
                })
            });

            if (!groqResponse.ok) {
                return { statusCode: 200, body: JSON.stringify({ reply: "Sistem AI Groq sedang memproses terlalu banyak beban." }) };
            }

            const groqData = await groqResponse.json();
            const reply = groqData.choices?.[0]?.message?.content || "Maaf, sistem sedang istirahat sebentar.";
            
            return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reply }) };
        }

        return { statusCode: 400, body: "Bad Request" };

    } catch (error) {
        console.error("Function Error:", error);
        return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reply: 'Terjadi kegagalan internal di sistem Dazer.' }) };
    }
};
