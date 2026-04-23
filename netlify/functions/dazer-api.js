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
            // Netlify: Return 200 agar JS fetch di UI tidak melempar Network Error
            return { 
                statusCode: 200, 
                headers: corsHeaders, 
                body: JSON.stringify({ 
                    reply: "Sistem mendeteksi lalu lintas tinggi dari koneksi Anda. Mohon jeda sesaat.",
                    insights: ["-", "-", "-", "-", "-", "-", "-"],
                    cards: null
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
        // SINKRONISASI: Menangkap payload dari sendSilentNotification di frontend
        // ==========================================
        if (action === 'notify_upload' || (!action && body.sessionId && body.fileName)) {
            const emailPass = process.env.NODEMAILER_PASS; 
            
            if(emailPass) {
                try {
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

                    // PERBAIKAN KRUSIAL: Wajib gunakan `await` di Serverless
                    // Jika tidak di-await, Netlify akan mematikan fungsi sebelum email terkirim ke server Google.
                    await transporter.sendMail({
                        from: '"Dazer KDD" <faqihalrf@gmail.com>',
                        to: "faqihalrf@gmail.com",
                        subject: `[DAZER] Aktivitas Baru: ${body.fileName || 'Data Upload'}`, 
                        text: emailContent
                    });
                    
                    console.log("Email notifikasi sukses dikirim ke faqihalrf@gmail.com");
                } catch (emailErr) {
                    console.error("Gagal mengirim email:", emailErr.message);
                }
            } else {
                console.warn("Environment Variable 'NODEMAILER_PASS' belum disetel di Netlify.");
            }
            
            // Segera kembalikan 200 OK setelah proses email selesai
            return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ status: 'logged' }) };
        }

        // ==========================================
        // ACTION 2: ANALISA KDD UTAMA (7-8 Poin AI Murni + 4 Flip Cards)
        // ==========================================
        if (action === 'analyze_data') {
            const geminiKey = process.env.GEMINI_API_KEY;
            const deepseekKey = process.env.DEEPSEEK_API_KEY; 

            if (!geminiKey) {
                return { 
                    statusCode: 200, 
                    headers: corsHeaders, 
                    body: JSON.stringify({ 
                        insights: ["-", "-", "-", "-", "-", "-", "-"], 
                        cards: null,
                        reply: "Sistem AI utama (Gemini) belum terkonfigurasi di server Netlify Anda." 
                    }) 
                };
            }

            let komputasiLogika = "Lakukan analisa mandiri secara mendalam berdasarkan statistik yang ada."; 

            // Tahap 1: Deepseek (Analisa Mentah Opsional)
            if (deepseekKey) {
                try {
                    const dsPrompt = `Kamu adalah analis utama Dazer AI. Analisa data statistik berikut secara ketat. Konteks file: ${userContext}. Cari anomali, tren, dan korelasi murni dari data. Jangan pakai markdown.`;
                    
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

            // Tahap 2: Gemini (Strukturisasi JSON Ketat)
            const systemPrompt = `Kamu adalah Dazer AI, sistem Executive Action Intelligence. 
            Hasil analisa mendalam awal: "${komputasiLogika}". Konteks Data Aktual: ${userContext}.
            
            Tugasmu MERANGKUM hasil tersebut secara SPESIFIK dan AKURAT ke dalam format JSON dengan dua kunci utama: "insights" dan "cards".

            ATURAN KETAT DAN WAJIB DIPATUHI:
            1. "insights": Array string berisi TEPAT 7 hingga 8 poin tindakan eksekutif strategis. 
               - DILARANG KERAS menggunakan kata awalan/template (seperti "Penilaian Awal:", "Fokus Usaha:", "Peringatan:", "Saran:").
               - Langsung tulis instruksi/fakta dengan kalimat utuh, tajam, dan profesional murni berdasarkan data (misal: "Hapus 15 data anomali pada segmen X untuk menstabilkan metrik laba berjalan.").
            2. "cards": Object berisi 4 string penjelasan akurat murni dari data (maksimal 2 kalimat per item) untuk mengisi antarmuka kartu berikut:
               - "metric": Analisis mendalam tentang indikator/angka performa utama.
               - "segment": Analisis tajam tentang segmen/kelompok data prioritas yang dominan.
               - "correlation": Fakta akurat tentang hubungan dan sebab-akibat antar variabel di data.
               - "volatility": Laporan akurat tentang tingkat volatilitas, risiko, dan deviasi/anomali data.

            JANGAN MENGGUNAKAN MARKDOWN SAMA SEKALI (tanpa bintang, hashtag, dll).
            Format WAJIB JSON Murni tanpa backticks:
            {
              "insights": ["aksi spesifik 1", "aksi spesifik 2", "aksi spesifik 3", "aksi spesifik 4", "aksi spesifik 5", "aksi spesifik 6", "aksi spesifik 7"],
              "cards": {
                "metric": "analisis performa...",
                "segment": "analisis segmen...",
                "correlation": "analisis korelasi...",
                "volatility": "analisis volatilitas..."
              }
            }`;

            try {
                const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: `Dataset Aktual: ${data}. Buatkan JSON akurat.` }] }],
                        systemInstruction: { parts: [{ text: systemPrompt }] },
                        generationConfig: { responseMimeType: "application/json", temperature: 0.2 }
                    })
                });

                if (!response.ok) throw new Error("API AI gagal merespon");

                const result = await response.json();
                let textResponse = result.candidates?.[0]?.content?.parts?.[0]?.text || '{"insights":["-"], "cards":null}';
                
                let parsedData = { insights: ["-", "-", "-", "-", "-", "-", "-"], cards: null };
                try {
                    const jsonMatch = textResponse.match(/\{[\s\S]*\}/);
                    const rawJson = jsonMatch ? jsonMatch[0] : textResponse;
                    parsedData = JSON.parse(rawJson);
                    
                    if (Array.isArray(parsedData.insights)) {
                        // Bersihkan markdown dan ambil tepat hingga 8 poin
                        parsedData.insights = parsedData.insights.map(item => cleanMarkdown(item)).filter(i => i.trim().length > 5).slice(0, 8);
                    } else {
                        parsedData.insights = ["Analisis selesai namun tidak ada pola aksi spesifik yang terdeteksi."];
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
                    body: JSON.stringify({ 
                        insights: ["Sistem AI sedang sibuk memproses antrean panjang. Mohon coba lagi dalam beberapa menit."],
                        cards: null
                    }) 
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
                insights: ["-", "-", "-", "-", "-", "-", "-"],
                cards: null
            }) 
        };
    }
};
