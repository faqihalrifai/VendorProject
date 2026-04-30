// dazer-api.js - Backend KDD (V28 Final - Ultra Smart Prompting & Solid Telemetry)
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
 * Token-Saver Logic: Memotong data jika melebihi batas (Mencegah Limit Error).
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

    // 2. Rate Limiting (Mencegah Spam Request DDoS)
    const clientIp = event.headers['x-forwarded-for'] || event.headers['client-ip'] || 'unknown';
    const currentTime = Date.now();
    const limitData = rateLimitMap.get(clientIp) || { count: 0, firstRequest: currentTime };
    
    if (currentTime - limitData.firstRequest > 600000) { // Reset tiap 10 menit
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
        
        // Memastikan metadata merupakan object valid untuk ekstraksi telemetri
        metadata = metadata || {};
        
        // Menangkap Notifikasi Upload jika parameter action tidak dikirim eksplisit
        if (!action && (body.fileName || metadata.fileName)) {
            action = 'notify_upload';
            name = name || body.name || metadata.name || 'Sesi Anonim';
            email = email || body.email || metadata.email || 'Guest User';
        }

        // Environment Variables (Diatur di Dasbor Netlify)
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

                    // Ekstraksi Data Berlapis (Prioritas: Metadata -> Body -> Fallback)
                    const extract = (key) => (metadata[key] !== undefined && metadata[key] !== null && metadata[key] !== "") ? metadata[key] : ((body[key] !== undefined && body[key] !== null && body[key] !== "") ? body[key] : 'Tidak terdeteksi');
                    
                    const localTime = extract('localTime') !== 'Tidak terdeteksi' ? extract('localTime') : new Date().toLocaleString('id-ID');
                    const ipAddress = extract('ip') !== 'Tidak terdeteksi' ? extract('ip') : clientIp;

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
                    console.error("Mailer Error:", e);
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
        // ACTION 3: ANALISA DASHBOARD (PENGGUNAAN QWEN & LLAMA-4)
        // ============================================================
        if (action === 'analyze_data') {
            const systemPrompt = `Role: Senior Data Analyst & Ahli Komunikasi Eksekutif. 
WAJIB OUTPUT DALAM BENTUK JSON MURNI TANPA MARKDOWN APAPUN (tanpa awalan \`\`\`json).

ATURAN GAYA BAHASA (SANGAT PENTING):
- Analisis MURNI berdasarkan nama variabel dan angka di dalam data yang diberikan. JANGAN gunakan frasa template basa-basi.
- Gunakan bahasa yang natural, elegan, namun sangat mudah dipahami (langsung ke intinya).
- Sesuaikan narasi proyeksi/analisis dengan konteks industri dari data.

ATURAN KETAT PANJANG TEKS & STRUKTUR:
1. "insights": WAJIB array berisi TEPAT 5 string. Tidak boleh kurang, tidak boleh lebih.
2. SETIAP string di dalam "insights" WAJIB terdiri dari TEPAT 2 kalimat. (Kalimat pertama fakta data. Kalimat kedua implikasi/solusi). Akhiri tiap kalimat dengan titik.
3. "cards": Object dengan key "metric", "segment", "correlation", "volatility". SETIAP value WAJIB terdiri dari 1 hingga 2 kalimat yang padat (setara 1.5 kalimat).

Format JSON yang Wajib:
{
  "insights": [
    "Fakta spesifik data pertama. Solusi atau implikasinya.",
    "Fakta spesifik data kedua. Solusi atau implikasinya.",
    "Fakta spesifik data ketiga. Solusi atau implikasinya.",
    "Fakta spesifik data keempat. Solusi atau implikasinya.",
    "Fakta spesifik data kelima. Rekomendasi tindakan."
  ],
  "cards": {
    "metric": "Teks 1-2 kalimat natural tentang performa.",
    "segment": "Teks 1-2 kalimat natural tentang kelompok utama.",
    "correlation": "Teks 1-2 kalimat natural tentang hubungan data.",
    "volatility": "Teks 1-2 kalimat natural tentang variansi/risiko."
  }
}`;
            const safeData = smartDataTruncate(data, 4000);
            let rawText = "";

            try {
                if (!groqKey) throw new Error("Groq Key missing");
                
                // --- MODEL UTAMA ANALISA: Qwen-3 32B ---
                const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        model: 'qwen/qwen3-32b', // Model spesifik dari request Anda
                        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: `Tolong analisis secara natural & spesifik data berikut:\n${safeData}` }], 
                        temperature: 0.3, // Optimal untuk analisis logis & bahasa natural
                        response_format: { type: "json_object" }, 
                        max_tokens: 1500 
                    })
                });
                
                if (!res.ok) throw new Error(`Groq Qwen HTTP ${res.status}`);
                const response = await res.json();
                rawText = response?.choices?.[0]?.message?.content || "";
            } catch (err1) {
                try {
                    // --- FALLBACK 1: Llama-4 Scout 17B ---
                    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ 
                            model: 'meta-llama/llama-4-scout-17b-16e-instruct', // Model spesifik dari request Anda
                            messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: `Tolong analisis secara natural & spesifik data berikut:\n${safeData}` }], 
                            temperature: 0.3, 
                            response_format: { type: "json_object" }, 
                            max_tokens: 1500 
                        })
                    });
                    
                    if (!res.ok) throw new Error(`Groq Llama 4 HTTP ${res.status}`);
                    const response = await res.json();
                    rawText = response?.choices?.[0]?.message?.content || "";
                } catch (err2) {
                    try {
                        // --- FALLBACK TERAKHIR: Cerebras (Jaring Pengaman) ---
                        if (!cerebrasKey) throw new Error("Cerebras Key missing");
                        const res = await fetch('https://api.cerebras.ai/v1/chat/completions', {
                            method: 'POST',
                            headers: { 'Authorization': `Bearer ${cerebrasKey}`, 'Content-Type': 'application/json' },
                            body: JSON.stringify({ 
                                model: 'llama3.1-70b', 
                                messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: `Tolong analisis secara natural & spesifik data berikut:\n${safeData}` }], 
                                temperature: 0.3,
                                max_tokens: 1500 
                            })
                        });
                        
                        if (!res.ok) throw new Error(`Cerebras HTTP ${res.status}`);
                        const response = await res.json();
                        rawText = response?.choices?.[0]?.message?.content || "";
                    } catch (err3) {
                        console.error("Semua AI Endpoint Gagal:", err3.message);
                    }
                }
            }

            // Fallback Data (Jika semua API terganggu / limit habis)
            let parsed = { 
                insights: [
                    "Sistem kami mendeteksi bahwa beban komputasi server saat ini sedang tinggi. Proses penarikan logika terhenti secara parsial.", 
                    "Kapasitas atau bentuk baris data mungkin melampaui batasan karakter yang dapat dibaca. Kami merekomendasikan pemangkasan ukuran unggahan.",
                    "Pastikan tidak ada entitas aneh atau kerusakan struktur tabel di dalam dokumen Anda. Konsistensi file amat penting untuk pemodelan.",
                    "Sistem pemulihan otomatis Dazer sedang menstabilkan koneksi AI di belakang layar. Silakan tunggu jeda beberapa menit.",
                    "Apabila interupsi ini tetap bertahan, hubungi dukungan teknis kami dengan menyertakan log sesi Anda. Kami memprioritaskan penyelesaian untuk Anda."
                ], 
                cards: { 
                    metric: "Nilai indikator belum dapat dihitung secara mutlak akibat interupsi di sisi jaringan API.", 
                    segment: "Pemetaan lapisan pengguna tertunda karena sistem gagal mengeksekusi algoritma pemilahan.", 
                    correlation: "Matriks keterkaitan variabel gagal disintesis. Kami menyarankan pemuatan ulang data.", 
                    volatility: "Tingkat persebaran angka tidak terbaca secara ideal. Pengecekan ulang tabel disarankan." 
                } 
            };

            if (rawText) {
                try { 
                    parsed = extractJSON(rawText);
                    
                    // GUARDRAIL: Pastikan insights berbentuk Array dan Tepat 5 buah
                    if (!parsed.insights || !Array.isArray(parsed.insights)) parsed.insights = [];
                    
                    const fallbackInsights = [
                        "Model berhasil memilah data namun output balasan mengalami deviasi standar. Temuan ini didasarkan pada abstraksi parsial.",
                        "Ada beberapa indikator nilai yang gagal diekstrak ke dalam bahasa eksekutif. Efektivitas wawasan ini mungkin tidak sepenuhnya spesifik.",
                        "Mesin analitik tetap mengolah porsi utama dari tabel Anda untuk meminimalisir kegagalan fungsional. Perhatikan tren pada dasbor visual.",
                        "Algoritma secara mandiri merangkum wawasan ini dari data mentah yang tersisa. Lakukan validasi manual untuk memastikan presisi.",
                        "Muat ulang Dasbor atau unggah format CSV standar untuk memulihkan kapasitas baca. Format data yang rapi mempercepat kinerja AI."
                    ];
                    
                    if (parsed.insights.length < 5) {
                        parsed.insights = [...parsed.insights, ...fallbackInsights].slice(0, 5);
                    } else if (parsed.insights.length > 5) {
                        parsed.insights = parsed.insights.slice(0, 5);
                    }

                    // GUARDRAIL: Pastikan cards valid
                    if (!parsed.cards) parsed.cards = { metric: "-", segment: "-", correlation: "-", volatility: "-" };
                } catch (parseError) {
                    parsed.insights[0] = "Mesin kecerdasan buatan memberikan respons dengan format skema yang cacat. Hal ini menghalangi kami merender teks Anda.";
                }
            }
            return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(parsed) };
        }

        // ============================================================
        // ACTION 4: CHATBOT (EKSKLUSIF LLAMA 3.3 70B + TAVILY GROUNDING)
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
                        // Dazer AI Assistant EKSKLUSIF menggunakan Llama 70B sesuai pesanan
                        model: 'llama-3.3-70b-versatile', 
                        messages: [
                            { role: 'system', content: "Kamu adalah Dazer AI Assistant, pakar analitik data profesional. Jawablah secara MURNI, berbobot, dan natural layaknya manusia yang ahli membaca angka. Jelaskan dalam Bahasa Indonesia yang mudah dipahami namun berkelas." }, 
                            { role: 'user', content: `Konteks File User saat ini: ${userContext}\n${webInfo}\n\nPertanyaan User: ${message}` }
                        ], 
                        temperature: 0.6, 
                        max_tokens: 1024 
                    })
                });
                
                if (!res.ok) throw new Error("Groq Error");
                const d = await res.json();
                const replyText = d?.choices?.[0]?.message?.content || "Mohon maaf, sistem asisten kami sedang terhambat oleh beban memori.";
                return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ reply: cleanMarkdown(replyText) }) };
            } catch(e) {
                return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ reply: "Layanan asisten cerdas sedang terputus (API offline/limit)." }) };
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

Tugas: Berikan narasi evaluasi algoritma yang MURNI, NATURAL, dan BUKAN TEMPLATE KAKU. Gunakan bahasa yang mudah dicerna oleh kalangan eksekutif non-IT namun tetap akurat secara statistika.
Wajib sertakan: 
1. Pola utama yang benar-benar Anda temukan dari sampel data di atas.
2. Tingkat keyakinan (Confidence Level / Akurasi bayangan algoritma).
3. Rekomendasi tindak lanjut strategis yang relevan.

Format jawaban dalam Bahasa Indonesia (1 hingga 3 paragraf padat) tanpa menggunakan markdown berlebihan.`;

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
                    finalRes = "Proses evaluasi model terhenti karena gangguan pada mesin pemrosesan Gemini. Silakan coba jalankan proses kembali dalam beberapa saat.";
                }
            }
            return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ result: cleanMarkdown(finalRes) }) };
        }

        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ reply: "Sistem menerima perintah aksi yang tidak terdaftar." }) };

    } catch (err) {
        console.error("Critical System Error (Dazer API):", err);
        return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ reply: "Terjadi interupsi internal pada server pemrosesan kami.", error: err.message }) };
    }
};
