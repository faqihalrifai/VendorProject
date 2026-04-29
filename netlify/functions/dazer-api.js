// dazer-api.js - Backend KDD (V27 - Natural Human-Like AI & Ultra-Accurate Telemetry)
const nodemailer = require('nodemailer');
const rateLimitMap = new Map();

/**
 * Membersihkan output markdown dari AI agar rapi saat ditampilkan di UI.
 */
function cleanMarkdown(text) {
    if (!text || typeof text !== 'string') return text;
    return text.replace(/[\*`]/g, '').replace(/(^|\n)#+\s/g, '$1').trim();
}

/**
 * Pembersih khusus untuk memastikan string bisa di-parse menjadi JSON secara paksa.
 */
function extractJSON(text) {
    try {
        const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
        const match = cleaned.match(/\{[\s\S]*\}/);
        return match ? JSON.parse(match[0]) : JSON.parse(cleaned);
    } catch (e) {
        throw new Error("Gagal mem-parsing output AI menjadi JSON.");
    }
}

/**
 * Token-Saver Logic: Memotong data jika melebihi batas.
 */
function smartDataTruncate(dataStr, limit = 4000) {
    if (!dataStr) return "";
    let str = typeof dataStr === 'string' ? dataStr : JSON.stringify(dataStr);
    if (str.length <= limit) return str;
    const half = Math.floor(limit / 2);
    return str.slice(0, half) + "\n\n...[DATA DIPANGKAS DEMI EFISIENSI TOKEN]...\n\n" + str.slice(-half);
}

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-forwarded-for, client-ip",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json"
};

exports.handler = async (event, context) => {
    // 1. Handle CORS Preflight
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ message: "CORS OK" }) };
    }

    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }

    // 2. Rate Limiting (Mencegah Spam Request)
    const clientIp = event.headers['x-forwarded-for'] || event.headers['client-ip'] || 'unknown';
    const currentTime = Date.now();
    const limitData = rateLimitMap.get(clientIp) || { count: 0, firstRequest: currentTime };
    
    if (currentTime - limitData.firstRequest > 600000) {
        limitData.count = 1; limitData.firstRequest = currentTime; 
    } else {
        limitData.count += 1;
        if (limitData.count > 100) {
            return { statusCode: 429, headers: corsHeaders, body: JSON.stringify({ reply: "Sistem sibuk. Mohon tunggu beberapa saat." }) };
        }
    }
    rateLimitMap.set(clientIp, limitData);

    try {
        const body = JSON.parse(event.body);
        let { action, message, context: userContext, data, modelType, algorithm, email, name, metadata } = body;
        
        // Memastikan metadata merupakan object valid
        metadata = metadata || {};
        
        // Menangkap Notifikasi Upload jika parameter action tidak dikirim dari index.html
        if (!action && (body.fileName || metadata.fileName)) {
            action = 'notify_upload';
            name = name || body.name || metadata.name || 'Sesi Anonim';
            email = email || body.email || metadata.email || 'Guest User';
        }

        // Environment Variables
        const groqKey = process.env.GROQ_API_KEY;
        const cerebrasKey = process.env.CEREBRAS_API_KEY;
        const geminiKey = process.env.GEMINI_API_KEY;
        const openRouterKey = process.env.OPENROUTER_API_KEY;
        const emailPass = process.env.NODEMAILER_PASS;
        const tvlyKey = process.env.TAVILY_API_KEY;
        const wolframId = process.env.WOLFRAM_APP_ID;

        // ============================================================
        // ACTION 1: LOG AKTIVITAS (DENGAN DETAIL EKSTENSIF & AKURAT)
        // ============================================================
        if (action === 'notify_register' || action === 'notify_upload' || action === 'notify_login') {
            if (emailPass) {
                try {
                    let transporter = nodemailer.createTransport({ 
                        service: 'gmail',
                        auth: { user: 'dazer.help@gmail.com', pass: emailPass } 
                    });
                    
                    // Label Aksi Berdasarkan Request
                    let subjectPrefix = "Dazer-Guest";
                    let colorLabel = "#64748b"; // Slate for Guest/Upload
                    
                    if (action === 'notify_register') {
                        subjectPrefix = "Dazer-Regist";
                        colorLabel = "#10b981"; // Emerald
                    } else if (action === 'notify_login') {
                        subjectPrefix = "Dazer-Login";
                        colorLabel = "#3b82f6"; // Blue
                    }

                    // Ekstraksi Data Berlapis (Prioritas: Body Langsung -> Metadata -> Fallback)
                    const extract = (key) => body[key] || metadata[key] || 'Tidak terdeteksi';
                    
                    const localTime = extract('localTime') !== 'Tidak terdeteksi' ? extract('localTime') : new Date().toLocaleString('id-ID');
                    const ipAddress = metadata.ip || body.ip || clientIp || 'Tidak terdeteksi';

                    const htmlLog = `
                        <div style="font-family: Arial, sans-serif; max-width: 650px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
                            <div style="background-color: ${colorLabel}; padding: 25px 20px; color: white;">
                                <h2 style="margin: 0; font-size: 20px;">Dazer Audit Log: ${subjectPrefix}</h2>
                                <p style="margin: 5px 0 0 0; opacity: 0.9; font-size: 13px;">Waktu Akses: ${localTime}</p>
                            </div>
                            <div style="padding: 0; background-color: #ffffff;">
                                <table style="width: 100%; border-collapse: collapse; font-size: 14px; text-align: left;">
                                    <tbody>
                                        <!-- IDENTITAS & SESI -->
                                        <tr style="background-color: #f8fafc;"><td colspan="2" style="padding: 10px 20px; font-weight: bold; color: #475569; border-bottom: 2px solid #e2e8f0;">Informasi Pengguna & Sesi</td></tr>
                                        <tr><td style="padding: 12px 20px; border-bottom: 1px solid #f1f5f9; width: 40%; color: #64748b;">Nama & Email</td><td style="padding: 12px 20px; border-bottom: 1px solid #f1f5f9; font-weight: 600;">${name || extract('name')} (${email || extract('email')})</td></tr>
                                        <tr><td style="padding: 12px 20px; border-bottom: 1px solid #f1f5f9; color: #64748b;">ID Sesi</td><td style="padding: 12px 20px; border-bottom: 1px solid #f1f5f9; font-family: monospace;">${extract('sessionId')}</td></tr>
                                        <tr><td style="padding: 12px 20px; border-bottom: 1px solid #f1f5f9; color: #64748b;">Durasi Tahan</td><td style="padding: 12px 20px; border-bottom: 1px solid #f1f5f9;">${extract('sessionDuration')}</td></tr>
                                        <tr><td style="padding: 12px 20px; border-bottom: 1px solid #f1f5f9; color: #64748b;">Waktu Lokal</td><td style="padding: 12px 20px; border-bottom: 1px solid #f1f5f9;">${localTime}</td></tr>
                                        
                                        <!-- DETAIL FILE & KDD -->
                                        <tr style="background-color: #f8fafc;"><td colspan="2" style="padding: 10px 20px; font-weight: bold; color: #475569; border-bottom: 2px solid #e2e8f0;">Data & Pemodelan KDD</td></tr>
                                        <tr><td style="padding: 12px 20px; border-bottom: 1px solid #f1f5f9; color: #64748b;">Nama File</td><td style="padding: 12px 20px; border-bottom: 1px solid #f1f5f9; font-weight: 600; color: #3b82f6;">${extract('fileName')}</td></tr>
                                        <tr><td style="padding: 12px 20px; border-bottom: 1px solid #f1f5f9; color: #64748b;">Ukuran File</td><td style="padding: 12px 20px; border-bottom: 1px solid #f1f5f9;">${extract('fileSize')}</td></tr>
                                        <tr><td style="padding: 12px 20px; border-bottom: 1px solid #f1f5f9; color: #64748b;">File Hash</td><td style="padding: 12px 20px; border-bottom: 1px solid #f1f5f9; font-family: monospace; font-size: 12px;">${extract('fileHash')}</td></tr>
                                        <tr><td style="padding: 12px 20px; border-bottom: 1px solid #f1f5f9; color: #64748b;">Kategori Data</td><td style="padding: 12px 20px; border-bottom: 1px solid #f1f5f9;">${extract('dataCategory')}</td></tr>
                                        <tr><td style="padding: 12px 20px; border-bottom: 1px solid #f1f5f9; color: #64748b;">Dimensi Data</td><td style="padding: 12px 20px; border-bottom: 1px solid #f1f5f9;">${extract('dataDimension')}</td></tr>
                                        <tr><td style="padding: 12px 20px; border-bottom: 1px solid #f1f5f9; color: #64748b;">Teknik KDD</td><td style="padding: 12px 20px; border-bottom: 1px solid #f1f5f9;">${extract('kddTechnique')}</td></tr>
                                        <tr><td style="padding: 12px 20px; border-bottom: 1px solid #f1f5f9; color: #64748b;">Daftar Kolom</td><td style="padding: 12px 20px; border-bottom: 1px solid #f1f5f9; font-size: 12px; line-height: 1.5;">${extract('columns')}</td></tr>
                                        
                                        <!-- TELEMETRI LINGKUNGAN -->
                                        <tr style="background-color: #f8fafc;"><td colspan="2" style="padding: 10px 20px; font-weight: bold; color: #475569; border-bottom: 2px solid #e2e8f0;">Telemetri Jaringan & Perangkat</td></tr>
                                        <tr><td style="padding: 12px 20px; border-bottom: 1px solid #f1f5f9; color: #64748b;">Perangkat</td><td style="padding: 12px 20px; border-bottom: 1px solid #f1f5f9;">${extract('device')}</td></tr>
                                        <tr><td style="padding: 12px 20px; border-bottom: 1px solid #f1f5f9; color: #64748b;">Resolusi Layar</td><td style="padding: 12px 20px; border-bottom: 1px solid #f1f5f9;">${extract('resolution')}</td></tr>
                                        <tr><td style="padding: 12px 20px; border-bottom: 1px solid #f1f5f9; color: #64748b;">Status Baterai</td><td style="padding: 12px 20px; border-bottom: 1px solid #f1f5f9;">${extract('battery')}</td></tr>
                                        <tr><td style="padding: 12px 20px; border-bottom: 1px solid #f1f5f9; color: #64748b;">Alamat IP</td><td style="padding: 12px 20px; border-bottom: 1px solid #f1f5f9; font-family: monospace;">${ipAddress}</td></tr>
                                        <tr><td style="padding: 12px 20px; border-bottom: 1px solid #f1f5f9; color: #64748b;">Lokasi / Geo</td><td style="padding: 12px 20px; border-bottom: 1px solid #f1f5f9;">${extract('location')}</td></tr>
                                        <tr><td style="padding: 12px 20px; border-bottom: 1px solid #f1f5f9; color: #64748b;">ISP / Provider</td><td style="padding: 12px 20px; border-bottom: 1px solid #f1f5f9;">${extract('isp')}</td></tr>
                                        <tr><td style="padding: 12px 20px; border-bottom: 1px solid #f1f5f9; color: #64748b;">Tipe Koneksi</td><td style="padding: 12px 20px; border-bottom: 1px solid #f1f5f9;">${extract('connectionType')}</td></tr>
                                    </tbody>
                                </table>
                            </div>
                            <div style="background-color: #f1f5f9; padding: 15px 20px; text-align: center; font-size: 12px; color: #64748b;">
                                Dihasilkan secara otomatis oleh Dazer Intelligence Engine
                            </div>
                        </div>
                    `;

                    await transporter.sendMail({ 
                        from: '"Dazer Audit" <dazer.help@gmail.com>', 
                        to: "dazer.help@gmail.com", 
                        subject: `[${subjectPrefix}] Telemetri: ${name || email}`, 
                        html: htmlLog 
                    });
                    
                    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ status: 'success' }) };
                } catch (e) {
                    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ status: 'error', error: e.message }) };
                }
            } else {
                return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ status: 'error', error: "Konfigurasi SMTP hilang." }) };
            }
        }

        // ============================================================
        // ACTION 2: RESET PASSWORD
        // ============================================================
        if (action === 'forgot_password') {
            if (emailPass && email) {
                try {
                    let transporter = nodemailer.createTransport({ 
                        service: 'gmail',
                        auth: { user: 'dazer.help@gmail.com', pass: emailPass } 
                    });
                    
                    const host = event.headers.host || "dazer-premium.netlify.app";
                    const protocol = (host.includes("localhost") || host.includes("127.0.0.1")) ? "http" : "https";
                    const link = `${protocol}://${host}/auth.html?reset=true&email=${encodeURIComponent(email)}`;
                    
                    await transporter.sendMail({ 
                        from: '"Dazer" <dazer.help@gmail.com>', 
                        to: email, 
                        subject: `Pulihkan Akun Dazer Anda`, 
                        html: `
                            <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; max-width:480px; margin:0 auto; padding:40px 20px; color:#334155;">
                                <h1 style="font-size:24px; font-weight:800; color:#0f172a; margin-bottom:16px;">Pulihkan Akun</h1>
                                <p style="font-size:15px; line-height:1.6; color:#64748b; margin-bottom:32px;">Klik tombol di bawah untuk mengatur ulang kata sandi Anda. Tautan ini akan segera membawa Anda ke halaman pemulihan aman.</p>
                                <a href="${link}" style="display:inline-block; background-color:#0ea5e9; color:#ffffff; padding:14px 28px; border-radius:12px; font-weight:700; text-decoration:none; font-size:14px;">Atur Ulang Kata Sandi</a>
                            </div>
                        `
                    });
                    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ message: "Tautan pemulihan telah dikirim ke email." }) };
                } catch (e) { 
                    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: "Gagal mengirim email pemulihan." }) }; 
                }
            }
            return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: "Email tidak valid atau konfigurasi SMTP hilang." }) };
        }

        // ============================================================
        // ACTION 3: ANALISA DASHBOARD (EXECUTIVE INTELLIGENCE)
        // ============================================================
        if (action === 'analyze_data') {
            const systemPrompt = `Role: Senior Data Analyst & Ahli Komunikasi Eksekutif. Wajib output dalam JSON murni tanpa markdown apapun.
ATURAN GAYA BAHASA (SANGAT PENTING):
- JANGAN gunakan format kalimat template yang kaku atau seperti robot.
- Gunakan bahasa manusia yang natural, luwes, elegan, namun SANGAT MUDAH dipahami oleh berbagai peran (dari staf hingga CEO).
- Analisis harus MURNI berdasarkan data yang diberikan, bukan tebakan atau basa-basi kosong.

ATURAN KETAT PANJANG TEKS:
1. "insights": WAJIB terdiri dari TEPAT 5 elemen dalam array.
2. SETIAP elemen di dalam "insights" WAJIB terdiri dari TEPAT 2 kalimat singkat. Gunakan 1 titik di akhir kalimat pertama, dan 1 titik di akhir kalimat kedua. Tidak boleh kurang atau lebih.
3. SETIAP elemen di dalam "cards" WAJIB terdiri dari 1 hingga 2 kalimat yang natural dan padat.

Format JSON yang Wajib:
{
  "insights": [
    "Fakta menarik pertama dari data. Penjelasan mengapa ini penting atau solusinya.",
    "Fakta menarik kedua dari data. Penjelasan mengapa ini penting atau solusinya.",
    "Fakta menarik ketiga dari data. Penjelasan mengapa ini penting atau solusinya.",
    "Fakta menarik keempat dari data. Penjelasan mengapa ini penting atau solusinya.",
    "Fakta menarik kelima dari data. Rekomendasi strategis dari penemuan tersebut."
  ],
  "cards": {
    "metric": "Satu atau dua kalimat natural yang menjelaskan metrik utama secara jelas.",
    "segment": "Satu atau dua kalimat natural tentang kelompok data yang paling menonjol.",
    "correlation": "Satu atau dua kalimat natural tentang hubungan antar faktor yang paling kuat.",
    "volatility": "Satu atau dua kalimat natural tentang stabilitas atau pergerakan data."
  }
}`;
            const safeData = smartDataTruncate(data, 4000);
            let rawText = "";

            try {
                if (!cerebrasKey) throw new Error("Cerebras Key missing");
                const res = await fetch('https://api.cerebras.ai/v1/chat/completions', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${cerebrasKey}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        model: 'llama3.1-70b', 
                        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: `Tolong analisis secara natural data berikut:\n${safeData}` }], 
                        temperature: 0.2, // Sedikit dinaikkan untuk bahasa natural, tapi tetap stabil
                        max_tokens: 1500 
                    })
                });
                
                if (!res.ok) throw new Error(`Cerebras HTTP ${res.status}`);
                const response = await res.json();
                rawText = response?.choices?.[0]?.message?.content || "";
            } catch (err) {
                try {
                    if (!groqKey) throw new Error("Groq Key missing");
                    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ 
                            model: 'llama-3.3-70b-versatile', 
                            messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: `Tolong analisis secara natural data berikut:\n${safeData}` }], 
                            temperature: 0.2, 
                            response_format: { type: "json_object" }, 
                            max_tokens: 1500 
                        })
                    });
                    
                    if (!res.ok) throw new Error(`Groq HTTP ${res.status}`);
                    const response = await res.json();
                    rawText = response?.choices?.[0]?.message?.content || "";
                } catch (fallbackErr) {
                    console.error("AI Analysis Gagal:", fallbackErr.message);
                }
            }

            // Fallback Data (Dibuat lebih natural seperti pesan manusia)
            let parsed = { 
                insights: [
                    "Sistem kami saat ini sedang memproses antrean data yang cukup padat. Hal ini membuat analisis penuh belum dapat ditampilkan secara langsung.", 
                    "Pembatasan ukuran data dari server mungkin menyebabkan pembacaan terpotong. Cobalah untuk menyederhanakan ukuran sampel yang Anda unggah.",
                    "Pastikan tidak ada karakter khusus atau baris yang rusak di dalam file Anda. Data yang rapi dan bersih akan sangat mempercepat proses pemodelan.",
                    "Koneksi ke mesin analisis cerdas kami sedang dipulihkan secara otomatis. Silakan tunggu beberapa saat lagi untuk memuat ulang data.",
                    "Jika kendala ini terus berlanjut, jangan ragu untuk menghubungi tim dukungan. Kami selalu siap membantu memastikan pekerjaan Anda tetap lancar."
                ], 
                cards: { 
                    metric: "Nilai metrik utama saat ini belum dapat dikalkulasi secara penuh. Kami sedang mencoba menyusun ulang data Anda.", 
                    segment: "Pemetaan profil data tertunda sementara karena tingginya lalu lintas pemrosesan di server.", 
                    correlation: "Analisis kecenderungan hubungan antar variabel sedang dalam antrean. Silakan periksa kembali beberapa saat lagi.", 
                    volatility: "Tingkat persebaran data akan segera kami tampilkan begitu jalur koneksi kembali stabil." 
                } 
            };

            if (rawText) {
                try { 
                    parsed = extractJSON(rawText);
                    // Pastikan array insight memiliki tepat 5 buah
                    if (!parsed.insights || !Array.isArray(parsed.insights)) parsed.insights = [];
                    
                    const defaultInsights = [
                        "Kami berhasil membaca data Anda namun menemukan format yang sedikit di luar standar. Pemrosesan dilakukan berdasarkan garis besarnya saja.",
                        "Ada beberapa nilai yang sulit diterjemahkan secara langsung oleh sistem. Hal ini dapat membuat hasil analisis menjadi kurang komprehensif.",
                        "Mesin kami tetap menyaring informasi utama yang bisa diekstrak dari tabel Anda. Silakan lihat metrik yang tersedia untuk gambaran awal.",
                        "Daya analisis disesuaikan agar tetap bisa memberikan wawasan meskipun sebagian data diabaikan. Keakuratan mungkin tidak maksimal.",
                        "Coba lakukan refresh atau unggah ulang file dengan format yang lebih konsisten. Kami sangat menyarankan penggunaan file CSV standar."
                    ];
                    
                    if (parsed.insights.length < 5) {
                        parsed.insights = [...parsed.insights, ...defaultInsights].slice(0, 5);
                    } else if (parsed.insights.length > 5) {
                        parsed.insights = parsed.insights.slice(0, 5);
                    }

                    if (!parsed.cards) parsed.cards = { metric: "-", segment: "-", correlation: "-", volatility: "-" };
                } catch (parseError) {
                    parsed.insights[0] = "Kami mengalami kesulitan menerjemahkan struktur balasan dari server AI. Silakan coba kembali dalam beberapa menit.";
                }
            }
            return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(parsed) };
        }

        // ============================================================
        // ACTION 4: CHATBOT (TAVILY GROUNDING)
        // ============================================================
        if (action === 'chat') {
            let webInfo = "";
            if (message.toLowerCase().match(/(berita|pasar|tren|terbaru|harga|2026|sekarang)/) && tvlyKey) {
                try {
                    const tvRes = await fetch('https://api.tavily.com/search', { 
                        method: 'POST', 
                        headers: { 'Content-Type': 'application/json' }, 
                        body: JSON.stringify({ api_key: tvlyKey, query: message, max_results: 1 }) 
                    });
                    if (tvRes.ok) {
                        const tvData = await tvRes.json();
                        if (tvData.results && tvData.results.length > 0) webInfo = `[Referensi Web Realtime: ${tvData.results[0].content.slice(0, 500)}]`;
                    }
                } catch(e) { console.warn("Tavily search skipped."); }
            }

            try {
                if (!groqKey) throw new Error("Groq API Key tidak ditemukan.");
                const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        model: 'llama-3.3-70b-versatile', 
                        messages: [
                            { role: 'system', content: "Kamu adalah Dazer AI Analyst. Jawablah dengan MURNI, natural, seolah kamu manusia yang mengerti data. Jelaskan secara profesional namun mudah dipahami dalam Bahasa Indonesia." }, 
                            { role: 'user', content: `Konteks User saat ini: ${userContext}\n${webInfo}\n\nUser bertanya: ${message}` }
                        ], 
                        temperature: 0.6, 
                        max_tokens: 800 
                    })
                });
                
                if (!res.ok) throw new Error("Groq Error");
                const d = await res.json();
                const replyText = d?.choices?.[0]?.message?.content || "Mohon maaf, sistem chat kami sedang lambat merespons.";
                return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ reply: cleanMarkdown(replyText) }) };
            } catch(e) {
                return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ reply: "Layanan asisten cerdas sedang offline atau belum diatur sepenuhnya." }) };
            }
        }

        // ============================================================
        // ACTION 5: MODELING LAB (GEMINI FLASH)
        // ============================================================
        if (action === 'run_model') {
            let wInfo = "";
            if (wolframId && modelType === 'Clustering') {
                try {
                    const wRes = await fetch(`http://api.wolframalpha.com/v1/result?appid=${wolframId}&i=kmeans+algorithm`);
                    if (wRes.ok) wInfo = await wRes.text();
                } catch(e) {}
            }

            const promptModel = `Task: Data Mining & KDD Evaluation. Method: ${modelType} | Algo: ${algorithm} | MathRef: ${wInfo}
Data Sample: ${smartDataTruncate(data, 5000)}
Tugas: Berikan narasi evaluasi model yang MURNI, NATURAL, dan BUKAN TEMPLATE KAKU. Gunakan bahasa yang sangat mudah dipahami oleh semua kalangan namun tetap elegan dan profesional.
Wajib sebutkan: Pola utama yang Anda temukan, tingkat keyakinan (Confidence Level / Akurasi bayangan), dan rekomendasi tindak lanjut strategis. 
Format jawaban dalam Bahasa Indonesia (1-3 paragraf padat) tanpa menggunakan markdown yang berlebihan.`;

            let finalRes = "";
            try {
                if (!geminiKey) throw new Error("Gemini API Key hilang.");
                const gRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`, { 
                    method: 'POST', 
                    headers: { 'Content-Type': 'application/json' }, 
                    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: promptModel }] }] }) 
                });
                
                if (!gRes.ok) throw new Error(`Gemini Native fail: HTTP ${gRes.status}`);
                const gData = await gRes.json();
                finalRes = gData.candidates[0].content.parts[0].text;
            } catch (e) {
                try {
                    if (!openRouterKey) throw new Error("OpenRouter Key hilang.");
                    const oRes = await fetch('https://openrouter.ai/api/v1/chat/completions', { 
                        method: 'POST', 
                        headers: { 'Authorization': `Bearer ${openRouterKey}`, 'Content-Type': 'application/json' }, 
                        body: JSON.stringify({ model: 'google/gemini-1.5-flash', messages: [{ role: 'user', content: promptModel }] }) 
                    });
                    
                    if (!oRes.ok) throw new Error(`OpenRouter fail: HTTP ${oRes.status}`);
                    const oData = await oRes.json();
                    finalRes = oData.choices[0].message.content;
                } catch(fallbackE) {
                    finalRes = "Proses evaluasi model terhenti karena gangguan pada sistem inti kami. Silakan coba jalankan proses kembali dalam beberapa saat.";
                }
            }
            return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ result: cleanMarkdown(finalRes) }) };
        }

        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ reply: "Sistem menerima perintah yang tidak terdaftar." }) };

    } catch (err) {
        console.error("Critical System Error (Dazer API):", err);
        return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ reply: "Terjadi interupsi pada server pemrosesan kami.", error: err.message }) };
    }
};
