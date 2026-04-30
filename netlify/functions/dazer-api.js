// dazer-api.js - Backend KDD (V31 Ultimate - Actionable Storytelling & Consultant Mode)
const nodemailer = require('nodemailer');
const rateLimitMap = new Map();

/**
 * Fetch dengan Timeout (Super Canggih):
 * Mencegah layar user loading selamanya jika server AI sedang down/lambat.
 */
const fetchWithTimeout = async (url, options, timeout = 8000) => {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(id);
        return response;
    } catch (error) {
        clearTimeout(id);
        throw new Error(`Request Timeout atau Terputus: ${error.message}`);
    }
};

/**
 * Membersihkan output markdown dari AI agar rapi saat ditampilkan di UI.
 */
function cleanMarkdown(text) {
    if (!text || typeof text !== 'string') return text;
    return text.replace(/[\*`]/g, '').replace(/(^|\n)#+\s/g, '$1').trim();
}

/**
 * Pembersih khusus untuk memastikan string bisa di-parse menjadi JSON secara paksa.
 * Diperkuat regex untuk menyelamatkan JSON yang cacat/terpotong.
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
            return { statusCode: 429, headers: corsHeaders, body: JSON.stringify({ reply: "Sistem sibuk. Mohon tunggu beberapa saat untuk melindungi kestabilan server." }) };
        }
    }
    rateLimitMap.set(clientIp, limitData);

    try {
        const body = JSON.parse(event.body);
        let { action, message, context: userContext, data, modelType, algorithm, email, name, metadata } = body;
        
        metadata = metadata || {};
        
        // Menangkap Notifikasi Upload jika parameter action tidak dikirim eksplisit
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
                    
                    let subjectPrefix = "Dazer-Guest";
                    let colorLabel = "#64748b"; 
                    
                    if (action === 'notify_register') {
                        subjectPrefix = "Dazer-Regist";
                        colorLabel = "#10b981"; 
                    } else if (action === 'notify_login') {
                        subjectPrefix = "Dazer-Login";
                        colorLabel = "#3b82f6"; 
                    }

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
                                        <tr style="background-color: #f8fafc;"><td colspan="2" style="padding: 10px 20px; font-weight: bold; color: #475569; border-bottom: 2px solid #e2e8f0;">Informasi Pengguna & Sesi</td></tr>
                                        <tr><td style="padding: 12px 20px; border-bottom: 1px solid #f1f5f9; width: 40%; color: #64748b;">Nama & Email</td><td style="padding: 12px 20px; border-bottom: 1px solid #f1f5f9; font-weight: 600;">${name || extract('name')} (${email || extract('email')})</td></tr>
                                        <tr><td style="padding: 12px 20px; border-bottom: 1px solid #f1f5f9; color: #64748b;">ID Sesi</td><td style="padding: 12px 20px; border-bottom: 1px solid #f1f5f9; font-family: monospace;">${extract('sessionId')}</td></tr>
                                        <tr><td style="padding: 12px 20px; border-bottom: 1px solid #f1f5f9; color: #64748b;">Durasi Tahan</td><td style="padding: 12px 20px; border-bottom: 1px solid #f1f5f9;">${extract('sessionDuration')}</td></tr>
                                        <tr><td style="padding: 12px 20px; border-bottom: 1px solid #f1f5f9; color: #64748b;">Waktu Lokal</td><td style="padding: 12px 20px; border-bottom: 1px solid #f1f5f9;">${localTime}</td></tr>
                                        
                                        <tr style="background-color: #f8fafc;"><td colspan="2" style="padding: 10px 20px; font-weight: bold; color: #475569; border-bottom: 2px solid #e2e8f0;">Data & Pemodelan KDD</td></tr>
                                        <tr><td style="padding: 12px 20px; border-bottom: 1px solid #f1f5f9; color: #64748b;">Nama File</td><td style="padding: 12px 20px; border-bottom: 1px solid #f1f5f9; font-weight: 600; color: #3b82f6;">${extract('fileName')}</td></tr>
                                        <tr><td style="padding: 12px 20px; border-bottom: 1px solid #f1f5f9; color: #64748b;">Ukuran File</td><td style="padding: 12px 20px; border-bottom: 1px solid #f1f5f9;">${extract('fileSize')}</td></tr>
                                        <tr><td style="padding: 12px 20px; border-bottom: 1px solid #f1f5f9; color: #64748b;">File Hash</td><td style="padding: 12px 20px; border-bottom: 1px solid #f1f5f9; font-family: monospace; font-size: 12px;">${extract('fileHash')}</td></tr>
                                        <tr><td style="padding: 12px 20px; border-bottom: 1px solid #f1f5f9; color: #64748b;">Kategori Data</td><td style="padding: 12px 20px; border-bottom: 1px solid #f1f5f9;">${extract('dataCategory')}</td></tr>
                                        <tr><td style="padding: 12px 20px; border-bottom: 1px solid #f1f5f9; color: #64748b;">Dimensi Data</td><td style="padding: 12px 20px; border-bottom: 1px solid #f1f5f9;">${extract('dataDimension')}</td></tr>
                                        <tr><td style="padding: 12px 20px; border-bottom: 1px solid #f1f5f9; color: #64748b;">Teknik KDD</td><td style="padding: 12px 20px; border-bottom: 1px solid #f1f5f9;">${extract('kddTechnique')}</td></tr>
                                        <tr><td style="padding: 12px 20px; border-bottom: 1px solid #f1f5f9; color: #64748b;">Daftar Kolom</td><td style="padding: 12px 20px; border-bottom: 1px solid #f1f5f9; font-size: 12px; line-height: 1.5;">${extract('columns')}</td></tr>
                                        
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
        // ACTION 3: ANALISA DASHBOARD (MULTI-FALLBACK & STORYTELLING)
        // ============================================================
        if (action === 'analyze_data') {
            const systemPrompt = `Role: Senior Business Consultant & Ahli Strategi Eksekutif. 
WAJIB OUTPUT DALAM BENTUK JSON MURNI TANPA MARKDOWN APAPUN (tanpa awalan \`\`\`json).

ATURAN GAYA BAHASA & ACTIONABLE STORYTELLING (SANGAT PENTING):
- DILARANG KERAS menggunakan istilah teknis IT/Statistik seperti "baris data", "kolom", "dataset", "outlier", "korelasi", "p-value", "anomali".
- Gunakan bahasa manajemen/bisnis yang murni, elegan, natural, dan langsung ke inti masalah (Executive Summary).
- Terapkan pendekatan "The Why" (Mengapa tren ini terjadi berdasarkan data) dan "The What-Next" (Apa solusi taktis bisnisnya).
- Fokus utama Anda adalah merumuskan saran yang relevan dengan "Tujuan Utama Analisis" yang diminta oleh pengguna di dalam konteks.
- DILARANG KERAS MENGULANG INFORMASI. Setiap insight dan card harus membahas skenario atau temuan spesifik yang 100% UNIK dan BERBEDA.

ATURAN KETAT PANJANG TEKS & STRUKTUR:
1. "insights": WAJIB array berisi TEPAT 5 string.
2. SETIAP string di dalam "insights" WAJIB terdiri dari TEPAT 2 kalimat. (Kalimat pertama: Akar masalah/Pola tersembunyi. Kalimat kedua: Saran taktis strategis). Akhiri tiap kalimat dengan titik.
3. "cards": Object dengan key "metric", "segment", "correlation", "volatility". SETIAP value WAJIB terdiri dari 1-2 kalimat padat yang menjabarkan poin spesifik tanpa mengulang isi "insights".

Format JSON yang Wajib (Patuhi struktur keys ini):
{
  "insights": [
    "Akar masalah unik pertama dari data. Solusi bisnis taktis untuk ini.",
    "Pola tersembunyi unik kedua. Tindakan spesifik yang harus dilakukan.",
    "Fakta operasional unik ketiga. Penyesuaian sumber daya yang diperlukan.",
    "Kendala/peluang unik keempat. Strategi mitigasi atau eskalasi.",
    "Temuan penting unik kelima. Rekomendasi arah bisnis ke depan."
  ],
  "cards": {
    "metric": "1-2 kalimat natural tentang kinerja utama atau pencapaian angka dominan.",
    "segment": "1-2 kalimat natural tentang target audiens atau peluang kategori yang paling menonjol.",
    "correlation": "1-2 kalimat natural tentang hubungan sebab-akibat (Misal: Jika A naik, B turun).",
    "volatility": "1-2 kalimat natural tentang deteksi risiko bisnis atau saran penghematan."
  }
}`;
            const safeData = smartDataTruncate(data, 4000);
            let rawText = "";

            try {
                if (!groqKey) throw new Error("Groq Key missing");
                
                // --- MODEL UTAMA ANALISA DASBOR: Qwen-3 32B (Via Groq) ---
                const res = await fetchWithTimeout('https://api.groq.com/openai/v1/chat/completions', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        model: 'qwen-2.5-32b', 
                        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: `Konteks User: ${userContext}\n\nTolong analisis secara natural, jadilah konsultan cerdas dan jawab tujuan utama saya berdasarkan data ini:\n${safeData}` }], 
                        temperature: 0.2, // Rendah agar logis & stabil
                        response_format: { type: "json_object" }, 
                        max_tokens: 1500 
                    })
                }, 8500);
                
                if (!res.ok) throw new Error(`Groq Qwen HTTP ${res.status}`);
                const response = await res.json();
                rawText = response?.choices?.[0]?.message?.content || "";
            } catch (err1) {
                try {
                    // --- FALLBACK 1: Llama-4 Scout 17B (Via Groq) ---
                    const res = await fetchWithTimeout('https://api.groq.com/openai/v1/chat/completions', {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ 
                            model: 'meta-llama/llama-4-scout-17b-16e-instruct',
                            messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: `Konteks User: ${userContext}\n\nTolong analisis secara natural, jadilah konsultan cerdas dan jawab tujuan utama saya berdasarkan data ini:\n${safeData}` }], 
                            temperature: 0.2, 
                            response_format: { type: "json_object" }, 
                            max_tokens: 1500 
                        })
                    }, 8500);
                    
                    if (!res.ok) throw new Error(`Groq Llama 4 HTTP ${res.status}`);
                    const response = await res.json();
                    rawText = response?.choices?.[0]?.message?.content || "";
                } catch (err2) {
                    try {
                        // --- FALLBACK TERAKHIR: Cerebras Llama 3.1 70B (Jaring Pengaman) ---
                        if (!cerebrasKey) throw new Error("Cerebras Key missing");
                        const res = await fetchWithTimeout('https://api.cerebras.ai/v1/chat/completions', {
                            method: 'POST',
                            headers: { 'Authorization': `Bearer ${cerebrasKey}`, 'Content-Type': 'application/json' },
                            body: JSON.stringify({ 
                                model: 'llama3.1-70b', 
                                messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: `Konteks User: ${userContext}\n\nTolong analisis secara natural, jadilah konsultan cerdas dan jawab tujuan utama saya berdasarkan data ini:\n${safeData}` }], 
                                temperature: 0.2,
                                max_tokens: 1500 
                            })
                        }, 10000); 
                        
                        if (!res.ok) throw new Error(`Cerebras HTTP ${res.status}`);
                        const response = await res.json();
                        rawText = response?.choices?.[0]?.message?.content || "";
                    } catch (err3) {
                        console.error("Semua AI Endpoint (Qwen, Llama4, Cerebras) Gagal/Timeout:", err3.message);
                    }
                }
            }

            // Fallback Data (Jika semua API terganggu) dibuat natural layaknya Konsultan Bisnis
            let parsed = { 
                insights: [
                    "Kami sedang meninjau strategi data Anda secara mendalam, namun antrean server saat ini menyebabkan sedikit penundaan. Proses perumusan kebijakan bisnis Anda akan segera dilanjutkan.", 
                    "Kepadatan matriks informasi yang Anda unggah mungkin sedang melampaui toleransi pemrosesan kami. Kami merekomendasikan peninjauan ulang pada volume laporan.",
                    "Pastikan elemen operasional di dalam dokumen Anda telah terstruktur dengan konsisten. Konsistensi informasi sangat esensial untuk memetakan arah perusahaan.",
                    "Sistem penasihat virtual Dazer sedang menstabilkan koneksinya. Tim konsultan AI kami akan kembali memberikan rekomendasi operasional dalam beberapa menit.",
                    "Apabila interupsi ini menghambat proses pengambilan keputusan Anda, silakan hubungi tim dukungan kami. Kami memprioritaskan pemulihan wawasan eksekutif Anda."
                ], 
                cards: { 
                    metric: "Angka kinerja utama sedang dikalkulasi ulang untuk memastikan keakuratan strategi bisnis Anda di sektor ini.", 
                    segment: "Pemetaan peluang profil pelanggan atau operasional tertunda sementara karena sistem sedang menyinkronkan data.", 
                    correlation: "Sebab-akibat atas kondisi bisnis Anda gagal disintesis dengan optimal. Kami menyarankan pemuatan ulang dasbor.", 
                    volatility: "Indikasi risiko bisnis saat ini belum bisa divalidasi. Peninjauan ulang laporan sangat kami sarankan demi kehati-hatian." 
                } 
            };

            if (rawText) {
                try { 
                    parsed = extractJSON(rawText);
                    
                    if (!parsed.insights || !Array.isArray(parsed.insights)) parsed.insights = [];
                    
                    const fallbackInsights = [
                        "Model berhasil mengekstrak esensi bisnis Anda, namun respons struktural sedikit mengalami deviasi. Wawasan berikut ditarik secara parsial.",
                        "Sebagian indikator angka gagal kami konversi menjadi strategi eksekutif penuh. Rekomendasi di bawah mungkin membutuhkan peninjauan manual.",
                        "Fokus utama kami saat ini adalah menyajikan gambaran dasar performa agar arah operasional Anda tetap berjalan. Perhatikan tren visual di atas.",
                        "Lakukan konfirmasi ulang terhadap elemen strategis sebelum mengeksekusinya di lapangan. Beberapa saran dihasilkan dari mitigasi otomatis.",
                        "Untuk memastikan ketajaman analisis konsultan kami, kami menyarankan Anda menggunakan struktur laporan standar (CSV) di sesi berikutnya."
                    ];
                    
                    if (parsed.insights.length < 5) {
                        parsed.insights = [...parsed.insights, ...fallbackInsights].slice(0, 5);
                    } else if (parsed.insights.length > 5) {
                        parsed.insights = parsed.insights.slice(0, 5);
                    }

                    if (!parsed.cards) parsed.cards = { metric: "-", segment: "-", correlation: "-", volatility: "-" };
                } catch (parseError) {
                    parsed.insights[0] = "Sistem konsultan kami memberikan format jawaban yang cacat secara teknis. Hal ini mencegah kami menjabarkan saran strategis untuk Anda.";
                }
            }
            return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(parsed) };
        }

        // ============================================================
        // ACTION 4: CHATBOT (EKSKLUSIF LLAMA 3.3 70B + TAVILY GROUNDING)
        // ============================================================
        if (action === 'chat') {
            let webInfo = "";
            if (message.toLowerCase().match(/(berita|pasar|tren|terbaru|harga|2026|sekarang|hari ini|saat ini)/) && tvlyKey) {
                try {
                    const tvRes = await fetchWithTimeout('https://api.tavily.com/search', { 
                        method: 'POST', 
                        headers: { 'Content-Type': 'application/json' }, 
                        body: JSON.stringify({ api_key: tvlyKey, query: message, max_results: 1 }) 
                    }, 4000);
                    if (tvRes.ok) {
                        const tvData = await tvRes.json();
                        if (tvData.results && tvData.results.length > 0) webInfo = `[Referensi Web Realtime (Faktual): ${tvData.results[0].content.slice(0, 600)}]`;
                    }
                } catch(e) { console.warn("Tavily search timeout/skipped."); }
            }

            try {
                if (!groqKey) throw new Error("Groq API Key tidak ditemukan.");
                const res = await fetchWithTimeout('https://api.groq.com/openai/v1/chat/completions', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        model: 'llama-3.3-70b-versatile', 
                        messages: [
                            { role: 'system', content: "Kamu adalah Dazer AI Assistant, konsultan strategi bisnis senior. Jawab dengan sangat rasional, fokus pada solusi (actionable), DILARANG bahas hal teknis IT (seperti array, row, kolom, JSON). Gunakan Bahasa Indonesia tingkat profesional yang elegan." }, 
                            { role: 'user', content: `Konteks Bisnis: ${userContext}\n${webInfo}\n\nPermintaan Klien: ${message}` }
                        ], 
                        temperature: 0.5, 
                        max_tokens: 1024 
                    })
                }, 12000); 
                
                if (!res.ok) throw new Error("Groq Error / Timeout");
                const d = await res.json();
                const replyText = d?.choices?.[0]?.message?.content || "Sistem kami mendeteksi perlambatan jaringan. Mohon kirim ulang pesan Anda.";
                return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ reply: cleanMarkdown(replyText) }) };
            } catch(e) {
                return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ reply: "Layanan konsultan cerdas sedang terputus (Timeout / Limit)." }) };
            }
        }

        // ============================================================
        // ACTION 5: MODELING LAB (GEMINI FLASH -> OPENROUTER)
        // ============================================================
        if (action === 'run_model') {
            let wInfo = "";
            if (wolframId && modelType === 'Clustering') {
                try {
                    const wRes = await fetchWithTimeout(`http://api.wolframalpha.com/v1/result?appid=${wolframId}&i=kmeans+algorithm`, {}, 3000);
                    if (wRes.ok) wInfo = await wRes.text();
                } catch(e) {}
            }

            const promptModel = `Task: Data Mining & KDD Evaluation. Method: ${modelType} | Algo: ${algorithm} | MathRef: ${wInfo}
Data Sample: ${smartDataTruncate(data, 5000)}

Tugas: Anda adalah Konsultan Bisnis. Berikan narasi hasil evaluasi algoritma di atas secara MURNI, NATURAL, dan BUKAN TEMPLATE KAKU. Gunakan bahasa manajemen yang mudah dicerna oleh kalangan eksekutif non-IT (jangan sebut node, array, atau variabel teknis rumit). 
Wajib sertakan: 
1. Pola perilaku bisnis yang paling menonjol dari data.
2. Tingkat keyakinan (Seberapa akurat penemuan ini jika diterapkan di dunia nyata).
3. Rekomendasi tindak lanjut strategis riil untuk meningkatkan efisiensi atau profit.

Format jawaban dalam Bahasa Indonesia (1 hingga 3 paragraf padat) tanpa menggunakan markdown berlebihan.`;

            let finalRes = "";
            try {
                if (!geminiKey) throw new Error("Gemini API Key hilang.");
                const gRes = await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`, { 
                    method: 'POST', 
                    headers: { 'Content-Type': 'application/json' }, 
                    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: promptModel }] }] }) 
                }, 12000);
                
                if (!gRes.ok) throw new Error(`Gemini Native fail: HTTP ${gRes.status}`);
                const gData = await gRes.json();
                finalRes = gData.candidates[0].content.parts[0].text;
            } catch (e) {
                try {
                    if (!openRouterKey) throw new Error("OpenRouter Key hilang.");
                    const oRes = await fetchWithTimeout('https://openrouter.ai/api/v1/chat/completions', { 
                        method: 'POST', 
                        headers: { 'Authorization': `Bearer ${openRouterKey}`, 'Content-Type': 'application/json' }, 
                        body: JSON.stringify({ model: 'google/gemini-1.5-flash', messages: [{ role: 'user', content: promptModel }] }) 
                    }, 12000);
                    
                    if (!oRes.ok) throw new Error(`OpenRouter fail: HTTP ${oRes.status}`);
                    const oData = await oRes.json();
                    finalRes = oData.choices[0].message.content;
                } catch(fallbackE) {
                    finalRes = "Evaluasi pemodelan bisnis dibatalkan oleh server. Ini terjadi karena jaringan API analisis tidak merespons (Timeout). Silakan jalankan eksekusi ulang untuk menarik data pola tersebut.";
                }
            }
            return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ result: cleanMarkdown(finalRes) }) };
        }

        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ reply: "Perintah aksi (Action Parameter) tidak dikenali oleh sistem." }) };

    } catch (err) {
        console.error("Critical System Error (Dazer API):", err);
        return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ reply: "Terjadi interupsi fatal pada memori server pemrosesan kami.", error: err.message }) };
    }
};
