// dazer-api.js - Backend KDD & AI Strategist (Final Version)
// Dependencies: npm install nodemailer @tavily/core

const nodemailer = require('nodemailer');
const { tavily } = require('@tavily/core');

// In-Memory Store untuk Rate Limiting
const rateLimitMap = new Map();

exports.handler = async function(event, context) {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

    // 1. IP Rate Limiting (Proteksi Server)
    const clientIp = event.headers['x-forwarded-for'] || 'unknown-ip';
    const currentTime = Date.now();
    const limitData = rateLimitMap.get(clientIp) || { count: 0, firstRequest: currentTime };
    
    if (currentTime - limitData.firstRequest > 60000) {
        limitData.count = 1; limitData.firstRequest = currentTime;
    } else {
        limitData.count += 1;
        if (limitData.count > 20) { // Limit dinaikkan sedikit agar user nyaman
            return { statusCode: 429, body: JSON.stringify({ error: "Terlalu banyak permintaan." }) };
        }
    }
    rateLimitMap.set(clientIp, limitData);

    try {
        const body = JSON.parse(event.body);
        const { action, message, context: userContext, data } = body;

        // ==========================================
        // ACTION 1: SILENT LOGGER (Email Notif)
        // ==========================================
        if (action === 'notify_upload') {
            const emailPass = process.env.NODEMAILER_PASS; 
            if(emailPass) {
                let transporter = nodemailer.createTransport({
                    service: 'gmail',
                    auth: { user: 'faqihalrf@gmail.com', pass: emailPass }
                });
                await transporter.sendMail({
                    from: '"Dazer KDD" <faqihalrf@gmail.com>',
                    to: "faqihalrf@gmail.com",
                    subject: `🚨 KDD Activity: ${body.filename}`,
                    text: `Aktivitas KDD Terdeteksi.\n\nFile: ${body.filename}\nUkuran: ${body.size}\nWaktu: ${body.time}`
                });
            }
            return { statusCode: 200, body: JSON.stringify({ status: 'logged' }) };
        }

        // ==========================================
        // ACTION 2: ANALISA KDD UTAMA (GEMINI)
        // ==========================================
        if (action === 'analyze_data') {
            const apiKey = process.env.GEMINI_API_KEY;
            if (!apiKey) return { statusCode: 500, body: JSON.stringify({ error: "Gemini Key Missing" }) };

            // Prompt yang dioptimasi berdasarkan buku DATA MINING (KDD)
            const systemPrompt = `Kamu adalah Ahli KDD (Knowledge Discovery in Database). 
            Tugasmu mengevaluasi ringkasan statistik dan memberikan wawasan strategi bisnis/akademik.
            
            Wajib berikan 5 insight dalam array "insights" dengan struktur:
            1. Klasifikasi Utama (Apa kategori dominan?)
            2. Deteksi Pola/Tren (Apa yang sedang terjadi?)
            3. Evaluasi Kualitas (Kesehatan data & anomali)
            4. Aturan Asosiasi (Hubungan antar variabel)
            5. Prediksi Strategis (Langkah masa depan)

            Gunakan Bahasa Indonesia yang profesional, ramah, dan tanpa simbol markdown kotor (** atau #).
            Format balasan HANYA JSON murni.
            
            Schema:
            {
              "insights": ["string 1", "string 2", "string 3", "string 4", "string 5"],
              "prediction_label": "string tren",
              "action_plan": [{"title": "string", "action": "string"}]
            }`;

            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: `Dataset Summary: ${data}. Berikan analisa mendalam.` }] }],
                    systemInstruction: { parts: [{ text: systemPrompt }] },
                    generationConfig: { responseMimeType: "application/json" }
                })
            });

            const result = await response.json();
            const textResponse = result.candidates?.[0]?.content?.parts?.[0]?.text;
            return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: textResponse };
        }

        // ==========================================
        // ACTION 3: CHATBOT (GROQ + TAVILY WORLD BRAIN)
        // ==========================================
        if (action === 'chat') {
            const groqKey = process.env.GROQ_API_KEY;
            const tvlyKey = process.env.TAVILY_API_KEY;

            let internetContext = "";
            // Cek apakah pertanyaan butuh riset internet (harga pasar, berita, perbandingan luar)
            if (message.toLowerCase().match(/(pasar|berita|tren|luar|bandingkan|saat ini|sekarang|2026|harga)/)) {
                try {
                    const tvlyClient = tavily({ apiKey: tvlyKey });
                    const tvlyRes = await tvlyClient.search(message, { searchDepth: "basic", maxResults: 3 });
                    internetContext = `\n[Data Internet Real-time: ${JSON.stringify(tvlyRes.results)}]`;
                } catch(e) { console.log("Tavily offline"); }
            }

            const universalSystemPrompt = `Kamu adalah Dazer AI. Ahli Data Mining & Riset Pasar.
            Aturan Output (Wajib):
            1. JANGAN gunakan simbol markdown jelek seperti #, ##, atau asterisk berlebihan (**).
            2. Gunakan format paragraf yang rapi dan elegan.
            3. Jawab pertanyaan umum atau spesifik data dengan gaya konsultan elit.
            4. Gunakan konteks data lokal ini jika relevan: ${userContext}.
            5. Gunakan data internet ini jika tersedia: ${internetContext}.
            6. Jika user tanya hal random, jawab dengan cerdas dan edukatif.`;

            const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: 'llama-3.3-70b-versatile', // Menggunakan model tertinggi untuk akurasi maksimal
                    messages: [
                        { role: 'system', content: universalSystemPrompt },
                        { role: 'user', content: message }
                    ],
                    temperature: 0.7
                })
            });

            const groqData = await groqResponse.json();
            const reply = groqData.choices?.[0]?.message?.content || "Maaf, sistem sedang istirahat sebentar.";
            
            return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reply }) };
        }

        return { statusCode: 400, body: "Bad Request" };

    } catch (error) {
        console.error("Function Error:", error);
        return { statusCode: 500, body: JSON.stringify({ error: 'Terjadi kegagalan sistem.' }) };
    }
};
