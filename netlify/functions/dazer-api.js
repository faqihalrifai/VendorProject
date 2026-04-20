// dazer-api.js - Backend KDD & AI Strategist (Final Ultimate Version V3 - Maximum Stability)
// Dependencies: npm install nodemailer
// Catatan: Menyelesaikan isu JSON Parsing, menambahkan CORS, dan mengoptimalkan respon API.

const nodemailer = require('nodemailer');

// In-Memory Store untuk Rate Limiting
const rateLimitMap = new Map();

// Fungsi bantuan untuk membersihkan teks dari simbol markdown HANYA pada string teks (bukan JSON)
function cleanMarkdown(text) {
    if (!text || typeof text !== 'string') return text;
    // Menghapus asterisk, backticks, dan hashtag agar teks murni dan profesional
    return text.replace(/[\*`]/g, '').replace(/(^|\n)#+\s/g, '$1').trim();
}

// Headers wajib agar frontend tidak terkena blokir CORS dari Browser
const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json"
};

exports.handler = async function(event, context) {
    // Handle CORS Preflight request
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: corsHeaders, body: '' };
    }

    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }

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
        if (limitData.count > 25) { // Sedikit dilonggarkan agar tidak mudah limit
            return { statusCode: 429, headers: corsHeaders, body: JSON.stringify({ error: "Terlalu banyak permintaan. Mohon tunggu sesaat." }) };
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
IP Address   : ${clientIp}
Lokasi       : ${body.location || '-'}
Waktu Lokal  : ${body.localTime || '-'}
`.trim();

                // Fire and forget (tidak ditunggu mutlak agar frontend tidak lambat)
                transporter.sendMail({
                    from: '"Dazer KDD" <faqihalrf@gmail.com>',
                    to: "faqihalrf@gmail.com",
                    subject: `[DAZER] KDD Activity: ${body.filename}`, 
                    text: emailContent
                }).catch(e => console.log("Email logger failed (Ignored)"));
            }
            return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ status: 'logged' }) };
        }

        // ==========================================
        // ACTION 2: ANALISA KDD UTAMA (BLUEPRINT 5 POIN)
        // ==========================================
        if (action === 'analyze_data') {
            const geminiKey = process.env.GEMINI_API_KEY;
            const deepseekKey = process.env.DEEPSEEK_API_KEY; 

            if (!geminiKey) {
                return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: "Sistem AI utama belum terkonfigurasi (API Key hilang)." }) };
            }

            let komputasiLogika = "Lakukan analisa mandiri secara mendalam berdasarkan statistik yang ada."; 

            // TAHAP 1: Modul Komputasi Matematis (DeepSeek Backend)
            if (deepseekKey) {
                try {
                    const dsPrompt = `Kamu adalah modul komputasi inti dari Dazer AI. 
                    Tugasmu menganalisa data statistik ekstraksi berikut secara matematis. 
                    Konteks file: ${userContext}
                    
                    Instruksi: Cari anomali, temukan pola probabilitas ke depan, dan hitung korelasi logisnya. 
                    Berikan hasil analisa mentalmu secara singkat dan padat. JANGAN menggunakan simbol markdown (*, #). JANGAN menyebut nama model AI.`;

                    const dsResponse = await fetch('https://api.deepseek.com/v1/chat/completions', {
                        method: 'POST',
                        headers: { 
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${deepseekKey}`
                        },
                        body: JSON.stringify({
                            model: 'deepseek-chat', 
                            messages: [
                                { role: 'system', content: dsPrompt },
                                { role: 'user', content: `Statistik Mentah: ${data}` }
                            ],
                            temperature: 0.1 
                        })
                    });

                    if (dsResponse.ok) {
                        const dsData = await dsResponse.json();
                        komputasiLogika = cleanMarkdown(dsData.choices?.[0]?.message?.content || komputasiLogika);
                    }
                } catch(e) {
                    console.log("DeepSeek timeout/error, fallback ke komputasi mandiri Gemini.");
                }
            }

            // TAHAP 2: Modul Presentasi Naratif & Json Formatter (Gemini Backend)
            const systemPrompt = `Kamu adalah Dazer AI, sistem Executive Action Intelligence tingkat tinggi. 
            Kamu baru saja melakukan komputasi matematis mendalam dengan hasil sebagai berikut:
            "${komputasiLogika}"

            Konteks Data Anda: ${userContext}.
            Tugasmu menyusun hasil tersebut ke dalam array JSON berisi TEPAT 5 elemen string.
            1. Pola Inti & Dominasi (Variabel paling berpengaruh).
            2. Korelasi Silang (Hubungan sebab-akibat antar kolom).
            3. Audit Anomali & Integritas (Efek data kosong/anomali).
            4. Proyeksi Probabilitas (Prediksi masa depan).
            5. Mandat Aksi Strategis (Rekomendasi eksekutif).

            ATURAN KETAT:
            - JANGAN PERNAH menyertakan teks awalan seperti "1. Pola:" atau "Mandat:". Tulis isinya secara langsung.
            - Jika info tidak relevan/cukup, isi elemen tersebut HANYA dengan 1 karakter: "-" (tanpa spasi/tambahan).
            - JANGAN PERNAH MENGGUNAKAN MARKDOWN (*, #, \` dll). Tulis plain text murni.
            - JANGAN menyebut nama teknologi (DeepSeek, Gemini, Google, OpenAI). Kamu HANYA "Dazer AI".
            
            Format balasan WAJIB valid JSON murni HANYA seperti ini:
            {
              "insights": ["narasi 1", "narasi 2", "narasi 3", "-", "narasi 5"]
            }`;

            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: `Dataset Summary: ${data}. Hasilkan laporan JSON.` }] }],
                    systemInstruction: { parts: [{ text: systemPrompt }] },
                    generationConfig: { responseMimeType: "application/json", temperature: 0.2 }
                })
            });

            if (!response.ok) {
                console.error("Gemini Error:", await response.text());
                throw new Error("Gagal menghubungi AI Gemini.");
            }

            const result = await response.json();
            let textResponse = result.candidates?.[0]?.content?.parts?.[0]?.text;
            
            // PERBAIKAN FATAL: Memastikan JSON di-parse dengan aman sebelum di-clean
            let parsedData = { insights: ["-", "-", "-", "-", "-"] };
            try {
                // Ekstrak JSON jika AI membalas dengan backticks (```json ... ```)
                const jsonMatch = textResponse.match(/\{[\s\S]*\}/);
                const rawJson = jsonMatch ? jsonMatch[0] : textResponse;
                parsedData = JSON.parse(rawJson);
                
                // Pastikan tepat 5 poin dan bersihkan markdown DARI DALAM array
                if (Array.isArray(parsedData.insights)) {
                    parsedData.insights = parsedData.insights.map(item => cleanMarkdown(item));
                    while(parsedData.insights.length < 5) parsedData.insights.push("-");
                    parsedData.insights = parsedData.insights.slice(0, 5);
                } else {
                    parsedData.insights = ["-", "-", "-", "-", "-"];
                }
            } catch (err) {
                console.error("JSON Parsing Error:", err, textResponse);
                // Kembalikan default template jika gagal parse
            }

            return { 
                statusCode: 200, 
                headers: corsHeaders, 
                body: JSON.stringify(parsedData)
            };
        }

        // ==========================================
        // ACTION 3: CHATBOT (DAZER AI UNIVERSAL)
        // ==========================================
        if (action === 'chat') {
            const groqKey = process.env.GROQ_API_KEY;
            const tvlyKey = process.env.TAVILY_API_KEY;

            if (!groqKey) {
                return { 
                    statusCode: 200, 
                    headers: corsHeaders,
                    body: JSON.stringify({ reply: "Sistem Dazer AI sedang melakukan kalibrasi API Keys backend." }) 
                };
            }

            let internetContext = "";
            const needsInternet = message.toLowerCase().match(/(pasar|berita|tren|luar|bandingkan|saat ini|sekarang|2026|2027|harga|apa|siapa|kapan|dimana|kenapa|bagaimana|terbaru|hari ini)/);
            
            if (needsInternet && tvlyKey) {
                try {
                    const tvlyRes = await fetch('https://api.tavily.com/search', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ api_key: tvlyKey, query: message, search_depth: "basic", max_results: 3 })
                    });
                    const tvlyData = await tvlyRes.json();
                    if (tvlyData && tvlyData.results) {
                        internetContext = `\n[Data Internet Terkini (Jadikan referensi wawasan): ${JSON.stringify(tvlyData.results)}]`;
                    }
                } catch(e) { 
                    console.log("Tavily search dilewati"); 
                }
            }

            const universalSystemPrompt = `Kamu adalah Dazer AI, platform analitik cerdas dan asisten universal yang berwibawa, cerdas, dan sangat akurat.
            PENTING: DILARANG KERAS menyebut nama penciptamu atau teknologi di balik layarmu (seperti Groq, Tavily, Gemini, DeepSeek, OpenAI, LLaMA, Meta, Google). Jika ditanya "siapa kamu?", jawab HANYA: "Saya adalah Dazer AI."
            
            Kamu asisten universal. Jika pengguna bertanya tentang data, koding, sains, sejarah, atau lelucon, JAWAB DENGAN TEPAT, LUGAS, DAN PROFESIONAL.

            Aturan Output (Wajib Mutlak):
            1. DILARANG KERAS menggunakan simbol markdown seperti bintang (*), hashtag (#), atau backticks (\`). Tulis dengan plain text murni yang rapi dan mudah dibaca.
            2. Gunakan format paragraf kalimat utuh. Jangan gunakan list bernomor yang berlebihan.
            3. Berbicaralah menggunakan Bahasa Indonesia profesional, ramah namun tetap berwibawa layaknya asisten eksekutif sejati.
            
            Jika user menanyakan seputar data yang sedang ia buka, gunakan konteks berikut:
            --- Konteks Data Lokal ---
            ${userContext}
            --------------------------
            ${internetContext}`;

            const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: { 
                    'Authorization': `Bearer ${groqKey}`, 
                    'Content-Type': 'application/json' 
                },
                body: JSON.stringify({
                    model: 'llama-3.3-70b-versatile',
                    messages: [
                        { role: 'system', content: universalSystemPrompt },
                        { role: 'user', content: message }
                    ],
                    temperature: 0.6
                })
            });

            if (!groqResponse.ok) {
                return { 
                    statusCode: 200, 
                    headers: corsHeaders,
                    body: JSON.stringify({ reply: "Dazer AI sedang memproses lalu lintas data yang tinggi. Mohon tunggu sesaat." }) 
                };
            }

            const groqData = await groqResponse.json();
            let reply = groqData.choices?.[0]?.message?.content || "Sistem telah memproses instruksi.";
            
            // Lapis keamanan backend: bersihkan markdown sebelum dikirim ke UI
            reply = cleanMarkdown(reply);
            
            return { 
                statusCode: 200, 
                headers: corsHeaders, 
                body: JSON.stringify({ reply }) 
            };
        }

        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: "Aksi tidak dikenali." }) };

    } catch (error) {
        console.error("Function Error:", error);
        return { 
            statusCode: 200, // Sengaja di-return 200 agar UI tidak meledak (Blank White Screen)
            headers: corsHeaders, 
            body: JSON.stringify({ insights: ["Sistem terinterupsi, sedang melakukan pemulihan...", "-", "-", "-", "-"], reply: "Maaf, terjadi kesalahan koneksi jaringan. Mohon coba sesaat lagi." }) 
        };
    }
};
