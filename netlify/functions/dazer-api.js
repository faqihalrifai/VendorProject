// Untuk menggunakan fungsi ini di Netlify, pastikan Anda telah menjalankan:
// npm install nodemailer @tavily/core

const nodemailer = require('nodemailer');
const { tavily } = require('@tavily/core');

// In-Memory Store untuk Rate Limiting Sederhana (Mencegah Spam Token)
const rateLimitMap = new Map();

exports.handler = async function(event, context) {
    // 1. CORS & Proteksi Method
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

    // 2. IP Rate Limiting (Maks 15 Request per menit per IP)
    const clientIp = event.headers['x-forwarded-for'] || 'unknown-ip';
    const currentTime = Date.now();
    const limitData = rateLimitMap.get(clientIp) || { count: 0, firstRequest: currentTime };
    
    if (currentTime - limitData.firstRequest > 60000) {
        limitData.count = 1; limitData.firstRequest = currentTime; // Reset setelah 1 menit
    } else {
        limitData.count += 1;
        if (limitData.count > 15) {
            return { statusCode: 429, body: JSON.stringify({ error: "Terlalu banyak permintaan (Rate Limit). Coba lagi nanti." }) };
        }
    }
    rateLimitMap.set(clientIp, limitData);

    try {
        const body = JSON.parse(event.body);
        const { action } = body;

        // ==========================================
        // ACTION 1: NOTIFIKASI EMAIL RAHASIA
        // ==========================================
        if (action === 'notify_upload') {
            const emailPass = process.env.NODEMAILER_PASS; 
            if(emailPass) {
                let transporter = nodemailer.createTransport({
                    service: 'gmail',
                    auth: { user: 'faqihalrf@gmail.com', pass: emailPass }
                });

                await transporter.sendMail({
                    from: '"Dazer System" <faqihalrf@gmail.com>',
                    to: "faqihalrf@gmail.com",
                    subject: "🚨 Aktivitas Upload Baru Terdeteksi",
                    text: `Ada pengguna yang mengunggah file di platform Dazer.\n\nNama File: ${body.filename}\nUkuran: ${body.size}\nWaktu: ${body.time}`
                });
            }
            return { statusCode: 200, body: JSON.stringify({ status: 'logged' }) };
        }

        // ==========================================
        // ACTION 2: ANALISA DATA UTAMA (GEMINI)
        // ==========================================
        if (action === 'analyze_data') {
            const apiKey = process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY.trim() : null;
            if (!apiKey) return { statusCode: 500, body: JSON.stringify({ error: "Gemini API Key hilang." }) };

            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: `Analisa data terstruktur berikut:\n${body.data}` }] }],
                    systemInstruction: {
                        parts: [{ text: `Kamu adalah AI Data Strategist. Format balasan HANYA JSON murni (Tanpa markdown).
Schema:
{
  "scorecards": [ {"title": "String", "value": "String", "trend": "String"} (Maks 4 item) ],
  "chart": { "title": "String", "labels": ["A","B"], "data": [1,2], "datasetLabel": "String" },
  "insights": [ "String 1", "String 2", "String 3" ],
  "futurePlan": [ {"focus": "String", "action": "String"} ]
}` }]
                    },
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
            const { message, context } = body;
            
            // 1. Cek Tavily jika user bertanya tentang hal luar (Pencarian bebas)
            let searchContext = "";
            if (message.toLowerCase().match(/(bandingkan|internet|berita|terbaru|harga pasar|saat ini|cari|bagaimana|apa itu|siapa|kenapa)/)) {
                try {
                    const tvlyApiKey = process.env.TAVILY_API_KEY;
                    if (tvlyApiKey) {
                        const tvlyClient = tavily({ apiKey: tvlyApiKey });
                        const tvlyRes = await tvlyClient.search(message, { searchDepth: "basic", maxResults: 2 });
                        if(tvlyRes && tvlyRes.results) {
                            searchContext = `\n[Fakta Internet (Tavily): ${JSON.stringify(tvlyRes.results)}]`;
                        }
                    }
                } catch(e) { console.log("Tavily Fetch Skipped", e); }
            }

            // 2. Hubungi Groq API
            const groqKey = process.env.GROQ_API_KEY ? process.env.GROQ_API_KEY.trim() : null;
            if (!groqKey) {
                return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reply: "[ERROR]: Groq API Key tidak ditemukan di Environment Variables Netlify." }) };
            }

            // Batasi panjang konteks agar tidak melampaui batas memori Groq Llama3
            const safeContext = context.substring(0, 10000); 

            // SYSTEM PROMPT UNIVERSAL: Bebas bahas data ATAUPUN bahas topik umum
            const universalSystemPrompt = `Anda adalah Dazer AI, asisten virtual dan ahli data yang serba bisa. 
Tugas utama Anda:
1. Anda BEBAS menjawab pertanyaan umum, berdiskusi, memberikan saran, dan membahas topik apa pun di luar data (seperti ChatGPT).
2. JIKA pengguna bertanya tentang data yang mereka unggah, gunakan informasi ini (Konteks File: ${safeContext}).
3. JIKA ada hasil pencarian web terbaru (Konteks Internet: ${searchContext}), gabungkan informasi tersebut ke dalam jawaban Anda.

Gunakan bahasa Indonesia yang profesional, ramah, dan sangat natural (tidak kaku).`;

            const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: 'llama-3.1-8b-instant', // Model terbaru Groq yang cepat & didukung penuh
                    messages: [
                        { role: 'system', content: universalSystemPrompt },
                        { role: 'user', content: message }
                    ]
                })
            });

            const groqData = await groqResponse.json();

            // Tangkap dan tampilkan error detail dari Groq jika ada
            if (!groqResponse.ok || groqData.error) {
                console.error("GROQ ERROR DETAILS:", groqData.error);
                const errorMessage = groqData.error?.message || "Terjadi kesalahan pada server Groq.";
                return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reply: `[ERROR GROQ]: ${errorMessage}` }) };
            }

            const reply = groqData.choices?.[0]?.message?.content || "Maaf, sistem AI sedang memproses pembaruan. Silakan coba sebentar lagi.";
            return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reply }) };
        }

        return { statusCode: 400, body: "Bad Request: Action tidak dikenal." };

    } catch (error) {
        console.error("Function Error:", error);
        return { statusCode: 500, body: JSON.stringify({ error: 'Gagal memproses permintaan di server internal.' }) };
    }
};
