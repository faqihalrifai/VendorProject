// dazer-api.js - Backend KDD & AI Strategist (V5 Netlify Functions Optimized)
// Catatan: Dioptimalkan khusus untuk lingkungan serverless Netlify Functions.
// Menjamin tidak ada crash (Graceful Degradation) agar UI frontend tetap stabil.

const nodemailer = require('nodemailer');

// In-Memory Store untuk Rate Limiting (Peringatan: Di serverless/Netlify, memori 
// bisa ter-reset antar instance, tapi cukup untuk menahan spam dasar per-instance).
const rateLimitMap = new Map();

// Fungsi bantuan untuk membersihkan teks dari simbol markdown (*, `, #)
function cleanMarkdown(text) {
    if (!text || typeof text !== 'string') return text;
    return text.replace(/[\*`]/g, '').replace(/(^|\n)#+\s/g, '$1').trim();
}

// Header CORS Mutlak (Wajib untuk integrasi Frontend - Backend)
const corsHeaders = {
    "Access-Control-Allow-Origin": "*", // Bisa diganti domain spesifik saat production
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-forwarded-for, client-ip",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json"
};

exports.handler = async (event, context) => {
    // 1. Tangani CORS Preflight Request (Sangat Penting untuk Netlify)
    if (event.httpMethod === 'OPTIONS') {
        return { 
            statusCode: 200, 
            headers: corsHeaders, 
            body: JSON.stringify({ message: "CORS Preflight OK" }) 
        };
    }

    if (event.httpMethod !== 'POST') {
        return { 
            statusCode: 405, 
            headers: corsHeaders, 
            body: JSON.stringify({ error: 'Method Not Allowed' }) 
        };
    }

    // 2. IP Rate Limiting (Proteksi Endpoint)
    const clientIp = event.headers['x-forwarded-for'] || event.headers['client-ip'] || 'unknown-ip';
    const currentTime = Date.now();
    const limitData = rateLimitMap.get(clientIp) || { count: 0, firstRequest: currentTime };
    
    if (currentTime - limitData.firstRequest > 60000) {
        limitData.count = 1; 
        limitData.firstRequest = currentTime;
    } else {
        limitData.count += 1;
        if (limitData.count > 30) {
            // Netlify: Return 200 agar JS fetch di UI tidak melempar Network Error, tapi isi pesannya peringatan
            return { 
                statusCode: 200, 
                headers: corsHeaders, 
                body: JSON.stringify({ 
                    reply: "Sistem mendeteksi lalu lintas tinggi dari koneksi Anda. Mohon jeda sesaat.",
                    insights: ["-", "-", "-", "-", "-"]
                }) 
            };
        }
    }
    rateLimitMap.set(clientIp, limitData);

    try {
        // 3. Parse Body Sangat Aman
        let body;
        try {
            body = JSON.parse(event.body);
        } catch (err) {
            return { 
                statusCode: 200, 
                headers: corsHeaders, 
                body: JSON.stringify({ reply: "Sistem menolak format request. Pastikan data terkirim dengan valid." }) 
            };
        }

        const { action, message, context: userContext, data } = body;

        // ==========================================
        // ACTION 1: SILENT LOGGER (Email Notif [DAZER])
        // SINKRONISASI: Menangkap payload yang tidak memiliki action (dari sendSilentNotification di frontend)
        // ==========================================
        if (action === 'notify_upload' || (!action && body.sessionId && body.fileName)) {
            const emailPass = process.env.NODEMAILER_PASS; 
            if(emailPass) {
                let transporter = nodemailer.createTransport({
                    service: 'gmail',
                    auth: { user: 'faqihalrf@gmail.com', pass: emailPass }
                });
                
                // Menyesuaikan exact keys dari payload index.html
                const emailContent = `
=== DETAIL SESI & FILE ===
Nama File    : ${body.fileName || '-'}
Ukuran       : ${body.size || '-'}
File Hash    : ${body.fileHash || '-'}
Kategori     : ${body.category || '-'}
Dimensi Data : ${body.dataDimension || '-'}
Daftar Kolom : ${body.columns || '-'}
Teknik KDD   : ${body.miningTechnique || '-'}

=== INFO PERANGKAT & LOKASI ===
ID Sesi      : ${body.sessionId || '-'}
Perangkat    : ${body.device || '-'}
Resolusi     : ${body.resolution || '-'}
Baterai      : ${body.battery || '-'}
IP Address   : ${body.ipAddress || '-'}
ISP/Provider : ${body.isp || '-'}
Lokasi       : ${body.location || '-'}
Tipe Koneksi : ${body.connection || '-'}
Waktu Lokal  : ${body.localTime || '-'}
Durasi Tahan : ${body.holdDuration || '-'}
`.trim();

                // Fire and forget, jangan ditunggu agar fungsi lambda cepat selesai
                transporter.sendMail({
                    from: '"Dazer KDD" <faqihalrf@gmail.com>',
                    to: "faqihalrf@gmail.com",
                    subject: `[DAZER] Aktivitas Baru: ${body.fileName || 'Data Upload'}`, 
                    text: emailContent
                }).catch((e) => {
                    console.error("Mail Error (Ignored):", e.message);
                }); // Abaikan error email agar tidak mengganggu sistem utama
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
                return { 
                    statusCode: 200, 
                    headers: corsHeaders, 
                    body: JSON.stringify({ 
                        insights: ["-","-","-","-","-"], 
                        reply: "Sistem AI utama (Gemini) belum terkonfigurasi di server Netlify Anda." 
                    }) 
                };
            }

            let komputasiLogika = "Lakukan analisa mandiri secara mendalam berdasarkan statistik yang ada."; 

            // Tahap 1: Deepseek (Opsional - Jika Gagal tidak akan crash)
            if (deepseekKey) {
                try {
                    const dsPrompt = `Kamu adalah modul komputasi inti Dazer AI. Analisa data statistik berikut. Konteks file: ${userContext}. Cari anomali, pola masa depan, dan korelasi logis. JANGAN pakai markdown.`;
                    
                    // Fetch native di Node.js 18+ (Standar Netlify saat ini)
                    const dsResponse = await fetch('https://api.deepseek.com/v1/chat/completions', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${deepseekKey}` },
                        body: JSON.stringify({
                            model: 'deepseek-chat', 
                            messages: [{ role: 'system', content: dsPrompt }, { role: 'user', content: `Statistik: ${data}` }],
                            temperature: 0.1 
                        })
                    });

                    if (dsResponse.ok) {
                        const dsData = await dsResponse.json();
                        komputasiLogika = cleanMarkdown(dsData.choices?.[0]?.message?.content || komputasiLogika);
                    }
                } catch(e) {
                    console.log("DeepSeek fetch error (diabaikan)");
                }
            }

            // Tahap 2: Gemini (Krusial untuk output 5 Poin)
            const systemPrompt = `Kamu adalah Dazer AI, sistem Executive Action Intelligence. 
            Hasil komputasi mentah: "${komputasiLogika}". Konteks Data: ${userContext}.
            
            Tugasmu menyusun hasil tersebut ke dalam array JSON berisi TEPAT 5 elemen string:
            1. Pola Inti & Dominasi
            2. Korelasi Silang
            3. Audit Anomali & Integritas
            4. Proyeksi Probabilitas
            5. Mandat Aksi Strategis

            ATURAN KETAT:
            - Tulis HANYA ISI NARASINYA SAJA (Tanpa judul nomor seperti "1. Pola:").
            - Jika info tidak cukup/kosong, isi elemen tersebut HANYA dengan tanda strip: "-"
            - JANGAN MENGGUNAKAN MARKDOWN (*, #, \` dll). Tulis teks rapi lurus.
            - Format WAJIB valid JSON murni HANYA seperti ini (TANPA BACKTICKS):
            {
              "insights": ["narasi 1", "narasi 2", "narasi 3", "-", "narasi 5"]
            }`;

            try {
                const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: `Dataset: ${data}. Buatkan format laporan JSON.` }] }],
                        systemInstruction: { parts: [{ text: systemPrompt }] },
                        generationConfig: { responseMimeType: "application/json", temperature: 0.2 }
                    })
                });

                if (!response.ok) throw new Error("API AI gagal merespon");

                const result = await response.json();
                let textResponse = result.candidates?.[0]?.content?.parts?.[0]?.text || '{"insights":["-","-","-","-","-"]}';
                
                let parsedData = { insights: ["-", "-", "-", "-", "-"] };
                try {
                    const jsonMatch = textResponse.match(/\{[\s\S]*\}/);
                    const rawJson = jsonMatch ? jsonMatch[0] : textResponse;
                    parsedData = JSON.parse(rawJson);
                    
                    if (Array.isArray(parsedData.insights)) {
                        parsedData.insights = parsedData.insights.map(item => cleanMarkdown(item));
                        while(parsedData.insights.length < 5) parsedData.insights.push("-");
                        parsedData.insights = parsedData.insights.slice(0, 5); // Paksa tepat 5 elemen
                    } else {
                        parsedData.insights = ["-", "-", "-", "-", "-"];
                    }
                } catch (err) {
                    console.error("JSON Parsing Error");
                }

                return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(parsedData) };

            } catch (apiErr) {
                // Return gracefully jika API nyangkut
                return { 
                    statusCode: 200, 
                    headers: corsHeaders, 
                    body: JSON.stringify({ insights: ["-", "-", "-", "-", "Sistem AI sedang sibuk. Mohon ulangi analisis Anda."] }) 
                };
            }
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
                    body: JSON.stringify({ reply: "Sistem Dazer AI sedang melakukan kalibrasi. Pastikan API Key backend terhubung (Groq)." }) 
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
                    if (tvlyRes.ok) {
                        const tvlyData = await tvlyRes.json();
                        if (tvlyData && tvlyData.results) {
                            internetContext = `\n[Data Referensi Internet Realtime: ${JSON.stringify(tvlyData.results)}]`;
                        }
                    }
                } catch(e) { }
            }

            const universalSystemPrompt = `Kamu adalah Dazer AI, platform analitik cerdas dan asisten universal yang berwibawa, cerdas, dan akurat.
            PENTING: DILARANG KERAS menyebut teknologi di balik layarmu (Groq, Gemini, DeepSeek, OpenAI, LLaMA). Jika ditanya siapa kamu, jawab: "Saya Dazer AI."
            
            Jawab semua pertanyaan dengan logis, baik seputar coding, sains, sejarah, atau candaan.

            Aturan Output (Wajib):
            1. DILARANG menggunakan markdown (*, #, \`). Tulis plain text murni yang rapi dan elegan.
            2. Gunakan format paragraf kalimat utuh berbahasa Indonesia yang baik.
            
            --- Konteks Data Lokal File Pengguna ---
            ${userContext || 'Tidak ada data file saat ini.'}
            --------------------------
            ${internetContext}`;

            try {
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

                if (!groqResponse.ok) throw new Error("Groq API Timeout");

                const groqData = await groqResponse.json();
                let reply = groqData.choices?.[0]?.message?.content || "Sistem telah memproses instruksi Anda.";
                
                reply = cleanMarkdown(reply); // Pastikan bersih dari bintang/hashtag
                
                return { 
                    statusCode: 200, 
                    headers: corsHeaders, 
                    body: JSON.stringify({ reply }) 
                };
            } catch (chatErr) {
                // Tangkap agar tidak muncul layar merah di UI
                return { 
                    statusCode: 200, 
                    headers: corsHeaders,
                    body: JSON.stringify({ reply: "Sistem AI sedang memproses lonjakan request. Mohon tunggu beberapa detik dan coba lagi." }) 
                };
            }
        }

        // Jika aksi tidak dikenal
        return { 
            statusCode: 200, 
            headers: corsHeaders, 
            body: JSON.stringify({ reply: "Instruksi/Action tidak dikenali sistem backend." }) 
        };

    } catch (error) {
        console.error("Global Server Error (Netlify Function Crash Prevented):", error);
        // Tangkapan error global level atas. Status 200 menyelamatkan UI dari Error "Network response was not ok".
        return { 
            statusCode: 200, 
            headers: corsHeaders, 
            body: JSON.stringify({ 
                reply: 'Maaf, terjadi interupsi tak terduga pada server. Mohon coba sesaat lagi.',
                insights: ["-", "-", "-", "-", "-"] // Cegah error destructuring di frontend
            }) 
        };
    }
};
