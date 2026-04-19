// dazer-api.js - Backend KDD & AI Strategist (Final Ultimate Version V2)
// Dependencies: npm install nodemailer
// Catatan: Menggabungkan kekuatan analisis data dengan persona Dazer AI murni.

const nodemailer = require('nodemailer');

// In-Memory Store untuk Rate Limiting
const rateLimitMap = new Map();

exports.handler = async function(event, context) {
    // Pastikan hanya menerima request POST
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    // ==========================================
    // 1. IP Rate Limiting (Proteksi Server)
    // ==========================================
    const clientIp = event.headers['x-forwarded-for'] || 'unknown-ip';
    const currentTime = Date.now();
    const limitData = rateLimitMap.get(clientIp) || { count: 0, firstRequest: currentTime };
    
    // Reset limit setiap 1 menit (60000 ms)
    if (currentTime - limitData.firstRequest > 60000) {
        limitData.count = 1; 
        limitData.firstRequest = currentTime;
    } else {
        limitData.count += 1;
        // Limit 20 request per menit untuk mencegah spam
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
                    auth: { 
                        user: 'faqihalrf@gmail.com', 
                        pass: emailPass 
                    }
                });
                
                // Format Email Super Detail & Presisi Sesuai Permintaan
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
Durasi Tahan : ${body.durationSec || '0'} detik (waktu sebelum klik upload)

*Catatan: Sistem diproses anonim. Nama/Email akun Google tidak dapat direkam otomatis tanpa fitur Login (OAuth) demi privasi pengguna.
`.trim();

                await transporter.sendMail({
                    from: '"Dazer KDD" <faqihalrf@gmail.com>',
                    to: "faqihalrf@gmail.com",
                    subject: `[DAZER] KDD Activity: ${body.filename}`, // Filter [DAZER] agar masuk ke label otomatis
                    text: emailContent
                });
            }
            // Tetap return sukses walau email offline agar UI tidak terganggu
            return { statusCode: 200, body: JSON.stringify({ status: 'logged' }) };
        }

        // ==========================================
        // ACTION 2: ANALISA KDD UTAMA (BLUEPRINT 5 POIN EXECUTIVE ACTION)
        // ==========================================
        if (action === 'analyze_data') {
            const geminiKey = process.env.GEMINI_API_KEY;
            const deepseekKey = process.env.DEEPSEEK_API_KEY; 

            if (!geminiKey) {
                return { statusCode: 500, body: JSON.stringify({ error: "API Key Utama Hilang" }) };
            }

            let komputasiLogika = "Lakukan analisa mandiri secara mendalam berdasarkan statistik yang ada."; // Fallback

            // TAHAP 1: Modul Komputasi Matematis (Backend Model 1)
            if (deepseekKey) {
                try {
                    const dsPrompt = `Kamu adalah modul komputasi inti dari Dazer AI. 
                    Tugasmu menganalisa data statistik ekstraksi berikut secara matematis. 
                    Konteks file: ${userContext} (Perhatikan kategori datanya).
                    
                    Instruksi: Cari anomali yang paling tidak masuk akal, temukan pola probabilitas ke depannya, dan hitung korelasi logisnya. 
                    Berikan hasil analisa mentalmu secara singkat, akurat, dan padat. JANGAN menyebut nama model AI buatan manusia apapun.`;

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
                                { role: 'user', content: `Statistik Data Mentah: ${data}` }
                            ],
                            temperature: 0.2 // Dibuat rendah agar logikanya ketat & matematis
                        })
                    });

                    if (dsResponse.ok) {
                        const dsData = await dsResponse.json();
                        komputasiLogika = dsData.choices?.[0]?.message?.content || komputasiLogika;
                    }
                } catch(e) {
                    console.log("Komputasi tahap 1 dilewati, fallback ke integrasi tunggal.");
                }
            }

            // TAHAP 2: Modul Presentasi Naratif & Json Formatter (Backend Model 2)
            // INI ADALAH LOGIKA BLUEPRINT YANG DI-UPGRADE SESUAI PERMINTAAN ANDA
            const systemPrompt = `Kamu adalah Dazer AI, sistem Executive Action Intelligence tingkat tinggi. 
            Kamu baru saja melakukan komputasi matematis mendalam dengan hasil sebagai berikut:
            "${komputasiLogika}"

            Tugasmu adalah menyusun hasil komputasi dan statistik data tersebut ke dalam 5 wawasan strategis yang memukau, presisi, dan siap dieksekusi.
            Konteks Data (Termasuk kategori dan jenis tindakan file): ${userContext}.
            
            Kamu WAJIB mengembalikan sebuah JSON dengan array "insights" yang berisi tepat 5 elemen string.
            Ke-5 elemen tersebut HARUS mewakili informasi berikut secara berurutan:
            1. Pola Inti & Dominasi (Menjelaskan variabel mana yang paling berpengaruh di dataset).
            2. Korelasi Silang (Hubungan sebab-akibat matematis antar dua kolom/variabel yang tersembunyi).
            3. Audit Anomali & Integritas (Efek bisnis/teknis dari data kosong atau anomali yang ditemukan).
            4. Proyeksi Probabilitas (Prediksi masa depan berdasarkan siklus/tren yang ada).
            5. Mandat Aksi Strategis (Rekomendasi spesifik: "Segera lakukan [X] pada [Y] karena [Z]").

            ATURAN COPYWRITING SANGAT KETAT:
            - Tulis HANYA ISI NARASINYA SAJA. JANGAN PERNAH menyertakan teks awalan, judul, atau penomoran (Contoh: DILARANG KERAS menulis "1. Pola Inti & Dominasi:" atau "Mandat Aksi Strategis:").
            - JIKA data untuk salah satu poin tidak ada korelasi yang jelas, tidak cukup, atau tidak relevan, isi elemen array tersebut murni dengan HANYA 1 KARAKTER TANDA HUBUNG: "-" (tanpa tambahan apapun).
            - JANGAN PERNAH menyebut nama teknologi seperti DeepSeek, Gemini, OpenAI, Llama, Google, dll. Sebut dirimu HANYA sebagai "Dazer AI" atau "Sistem".
            - Gunakan Bahasa Indonesia yang sangat elegan dan berwibawa layaknya konsultan eksekutif. DILARANG menggunakan markdown (*, #) di dalam teks.
            
            Format balasan HANYA struktur JSON murni tanpa backticks:
            {
              "insights": ["narasi poin 1", "narasi poin 2", "narasi poin 3", "narasi poin 4", "narasi poin 5"]
            }`;

            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: `Dataset Summary Mentah: ${data}. Buatkan laporan KDD final (JSON).` }] }],
                    systemInstruction: { parts: [{ text: systemPrompt }] },
                    generationConfig: { responseMimeType: "application/json" }
                })
            });

            const result = await response.json();
            const textResponse = result.candidates?.[0]?.content?.parts?.[0]?.text;
            return { 
                statusCode: 200, 
                headers: { "Content-Type": "application/json" }, 
                body: textResponse 
            };
        }

        // ==========================================
        // ACTION 3: CHATBOT (DAZER AI WORLD BRAIN)
        // ==========================================
        if (action === 'chat') {
            const groqKey = process.env.GROQ_API_KEY;
            const tvlyKey = process.env.TAVILY_API_KEY;

            if (!groqKey) {
                return { 
                    statusCode: 200, 
                    body: JSON.stringify({ reply: "Sistem Dazer AI sedang melakukan kalibrasi. Pastikan pengaturan backend telah terhubung sepenuhnya." }) 
                };
            }

            let internetContext = "";
            
            // Regex cerdas untuk mendeteksi kapan AI butuh mencari info di internet
            const needsInternet = message.toLowerCase().match(/(pasar|berita|tren|luar|bandingkan|saat ini|sekarang|2026|2027|harga|apa|siapa|kapan|dimana|kenapa|bagaimana|terbaru|hari ini)/);
            
            // Eksekusi riset Tavily secara native fetch (sangat hemat resource)
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
                        internetContext = `\n[Data Real-time: ${JSON.stringify(tvlyData.results)}]`;
                    }
                } catch(e) { 
                    console.log("Penelusuran eksternal dilewati"); 
                }
            }

            // System Prompt ChatBot agar sangat presisi dan sepenuhnya "White-Label"
            const universalSystemPrompt = `Kamu adalah Dazer AI, platform analitik canggih dan asisten data strategis yang berwibawa, presisi, dan akurat.
            Kamu adalah satu-satunya entitas kecerdasan di sini. PENTING: DILARANG KERAS menyebut atau mengakui nama teknologi di balik layarmu (seperti Groq, Tavily, Gemini, DeepSeek, OpenAI, LLaMA, Google, dll). Jika ditanya siapa kamu, kamu HANYA Dazer AI yang dibuat untuk memberikan eksekusi KDD.
            
            Kamu menguasai 19 kategori data (HR, Finance, Operasional, Ritel, dll).

            Aturan Output (Wajib):
            1. DILARANG menggunakan simbol markdown jelek seperti #, ##, atau asterisk berlebihan (**). Gunakan kalimat naratif.
            2. Gunakan format paragraf yang rapi dan elegan.
            3. Jawab pertanyaan APAPUN dari user (seputar data, analisis spesifik, sejarah, sains, coding, atau obrolan santai).
            
            PENTING TERKAIT DATA PENGGUNA:
            Jika user bertanya "ini file apa?", "apa isi datanya?", atau meminta analisis detail, BACA DAN JELASKAN berdasarkan blok "Konteks Data Lokal" di bawah ini. 
            Sebutkan nama file, jumlah baris, sampel isinya, dan hasil wawasan agar pengguna merasa terbantu.

            --- Konteks Data Lokal Ekstraksi Saat Ini ---
            ${userContext}
            --------------------------
            
            --- Konteks Web & Real-Time Terkini ---
            ${internetContext}
            ---------------------`;

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
                    temperature: 0.7
                })
            });

            // Proteksi jika antrian padat
            if (!groqResponse.ok) {
                console.error("API Error:", await groqResponse.text());
                return { 
                    statusCode: 200, 
                    body: JSON.stringify({ reply: "Dazer AI sedang memproses lonjakan lalu lintas data yang tinggi. Mohon tunggu beberapa saat untuk menganalisis kembali." }) 
                };
            }

            const groqData = await groqResponse.json();
            const reply = groqData.choices?.[0]?.message?.content || "Sistem telah memproses namun balasan teks belum terbentuk sempurna.";
            
            return { 
                statusCode: 200, 
                headers: { "Content-Type": "application/json" }, 
                body: JSON.stringify({ reply }) 
            };
        }

        return { statusCode: 400, body: "Bad Request" };

    } catch (error) {
        console.error("Function Error:", error);
        // Tangkapan error global, di-return sebagai 200 agar UI tidak melihat layar putih/crash
        return { 
            statusCode: 200, 
            headers: { "Content-Type": "application/json" }, 
            body: JSON.stringify({ reply: 'Maaf, terjadi interupsi sementara di dalam subsistem memori Dazer.' }) 
        };
    }
};
