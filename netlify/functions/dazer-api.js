// dazer-api.js - Backend KDD (V24 - Expanded Mailer & Dynamic Action Subject)
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
 * Pembersih khusus untuk memastikan string bisa di-parse menjadi JSON.
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
 * Token-Saver Logic: Memotong data jika melebihi batas (Mencegah Error 413/400).
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
        
        // Menangkap Notifikasi Upload dari index.html yang kehilangan key "action"
        if (!action && body.fileName) {
            action = 'notify_upload';
            name = name || 'Sesi Anonim';
            email = email || 'Guest User';
        }

        // Memastikan metadata ada agar tidak undefined
        metadata = metadata || {};
        metadata.ip = metadata.ip || clientIp;

        // Environment Variables
        const groqKey = process.env.GROQ_API_KEY;
        const cerebrasKey = process.env.CEREBRAS_API_KEY;
        const geminiKey = process.env.GEMINI_API_KEY;
        const openRouterKey = process.env.OPENROUTER_API_KEY;
        const emailPass = process.env.NODEMAILER_PASS;
        const tvlyKey = process.env.TAVILY_API_KEY;
        const wolframId = process.env.WOLFRAM_APP_ID;

        // ============================================================
        // ACTION 1: LOG AKTIVITAS (DENGAN DETAIL EKSTENSIF)
        // ============================================================
        if (action === 'notify_register' || action === 'notify_upload' || action === 'notify_login') {
            if (emailPass) {
                try {
                    let transporter = nodemailer.createTransport({ 
                        service: 'gmail',
                        auth: { user: 'dazer.help@gmail.com', pass: emailPass } 
                    });
                    
                    // Menentukan Label Aksi Berdasarkan Request
                    let subjectPrefix = "Dazer-Guest";
                    let colorLabel = "#64748b"; // Slate for Guest/Upload
                    
                    if (action === 'notify_register') {
                        subjectPrefix = "Dazer-Regist";
                        colorLabel = "#10b981"; // Emerald
                    } else if (action === 'notify_login') {
                        subjectPrefix = "Dazer-Login";
                        colorLabel = "#3b82f6"; // Blue
                    }

                    const localTime = metadata.localTime || new Date().toLocaleString('id-ID');
                    
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
                                        <tr><td style="padding: 12px 20px; border-bottom: 1px solid #f1f5f9; width: 40%; color: #64748b;">Nama & Email</td><td style="padding: 12px 20px; border-bottom: 1px solid #f1f5f9; font-weight: 600;">${name || 'Anonim'} (${email || 'Guest'})</td></tr>
                                        <tr><td style="padding: 12px 20px; border-bottom: 1px solid #f1f5f9; color: #64748b;">ID Sesi</td><td style="padding: 12px 20px; border-bottom: 1px solid #f1f5f9;">${metadata.sessionId || '-'}</td></tr>
                                        <tr><td style="padding: 12px 20px; border-bottom: 1px solid #f1f5f9; color: #64748b;">Durasi Tahan</td><td style="padding: 12px 20px; border-bottom: 1px solid #f1f5f9;">${metadata.sessionDuration || '-'}</td></tr>
                                        
                                        <!-- DETAIL FILE & KDD (Muncul jika ada) -->
                                        <tr style="background-color: #f8fafc;"><td colspan="2" style="padding: 10px 20px; font-weight: bold; color: #475569; border-bottom: 2px solid #e2e8f0;">Data & Pemodelan KDD</td></tr>
                                        <tr><td style="padding: 12px 20px; border-bottom: 1px solid #f1f5f9; color: #64748b;">Nama File</td><td style="padding: 12px 20px; border-bottom: 1px solid #f1f5f9;">${body.fileName || metadata.fileName || '-'}</td></tr>
                                        <tr><td style="padding: 12px 20px; border-bottom: 1px solid #f1f5f9; color: #64748b;">Ukuran File</td><td style="padding: 12px 20px; border-bottom: 1px solid #f1f5f9;">${body.fileSize || metadata.fileSize || '-'}</td></tr>
                                        <tr><td style="padding: 12px 20px; border-bottom: 1px solid #f1f5f9; color: #64748b;">File Hash</td><td style="padding: 12px 20px; border-bottom: 1px solid #f1f5f9;">${metadata.fileHash || '-'}</td></tr>
                                        <tr><td style="padding: 12px 20px; border-bottom: 1px solid #f1f5f9; color: #64748b;">Kategori Data</td><td style="padding: 12px 20px; border-bottom: 1px solid #f1f5f9;">${metadata.dataCategory || '-'}</td></tr>
                                        <tr><td style="padding: 12px 20px; border-bottom: 1px solid #f1f5f9; color: #64748b;">Dimensi Data</td><td style="padding: 12px 20px; border-bottom: 1px solid #f1f5f9;">${metadata.dataDimension || '-'}</td></tr>
                                        <tr><td style="padding: 12px 20px; border-bottom: 1px solid #f1f5f9; color: #64748b;">Teknik KDD</td><td style="padding: 12px 20px; border-bottom: 1px solid #f1f5f9;">${metadata.kddTechnique || '-'}</td></tr>
                                        <tr><td style="padding: 12px 20px; border-bottom: 1px solid #f1f5f9; color: #64748b;">Daftar Kolom</td><td style="padding: 12px 20px; border-bottom: 1px solid #f1f5f9; font-size: 12px;">${metadata.columns || '-'}</td></tr>
                                        
                                        <!-- TELEMETRI LINGKUNGAN -->
                                        <tr style="background-color: #f8fafc;"><td colspan="2" style="padding: 10px 20px; font-weight: bold; color: #475569; border-bottom: 2px solid #e2e8f0;">Telemetri Jaringan & Perangkat</td></tr>
                                        <tr><td style="padding: 12px 20px; border-bottom: 1px solid #f1f5f9; color: #64748b;">Perangkat</td><td style="padding: 12px 20px; border-bottom: 1px solid #f1f5f9;">${metadata.device || '-'}</td></tr>
                                        <tr><td style="padding: 12px 20px; border-bottom: 1px solid #f1f5f9; color: #64748b;">Resolusi Layar</td><td style="padding: 12px 20px; border-bottom: 1px solid #f1f5f9;">${metadata.resolution || '-'}</td></tr>
                                        <tr><td style="padding: 12px 20px; border-bottom: 1px solid #f1f5f9; color: #64748b;">Status Baterai</td><td style="padding: 12px 20px; border-bottom: 1px solid #f1f5f9;">${metadata.battery || '-'}</td></tr>
                                        <tr><td style="padding: 12px 20px; border-bottom: 1px solid #f1f5f9; color: #64748b;">Alamat IP</td><td style="padding: 12px 20px; border-bottom: 1px solid #f1f5f9; font-family: monospace;">${metadata.ip}</td></tr>
                                        <tr><td style="padding: 12px 20px; border-bottom: 1px solid #f1f5f9; color: #64748b;">Lokasi / ISP</td><td style="padding: 12px 20px; border-bottom: 1px solid #f1f5f9;">${metadata.location || 'Unknown'} / ${metadata.isp || '-'}</td></tr>
                                        <tr><td style="padding: 12px 20px; border-bottom: 1px solid #f1f5f9; color: #64748b;">Tipe Koneksi</td><td style="padding: 12px 20px; border-bottom: 1px solid #f1f5f9;">${metadata.connectionType || '-'}</td></tr>
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    `;

                    await transporter.sendMail({ 
                        from: '"Dazer Audit" <dazer.help@gmail.com>', 
                        to: "dazer.help@gmail.com", 
                        subject: `[${subjectPrefix}] Info: ${name || email}`, 
                        html: htmlLog 
                    });
                    
                    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ status: 'success' }) };
                } catch (e) {
                    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ status: 'error', error: e.message }) };
                }
            } else {
                return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ status: 'error', error: "Konfigurasi Email Server tidak lengkap." }) };
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
            const systemPrompt = `Role: Senior Data Analyst. Output wajib TEPAT berformat JSON. JANGAN TULIS HAL LAIN SELAIN JSON.
Gaya Bahasa: Eksekutif, lugas, profesional, dan padat.
ATURAN PANJANG TEKS:
1. Setiap poin di dalam array "insights" HARUS terdiri dari TEPAT 2 kalimat.
2. Setiap value di dalam object "cards" HARUS terdiri dari 1 hingga 2 kalimat maksimal.

Format JSON yang Wajib:
{
  "insights": ["Point 1.", "Point 2.", "Point 3.", "Point 4."],
  "cards": {
    "metric": "1-2 kalimat.", 
    "segment": "1-2 kalimat.", 
    "correlation": "1-2 kalimat.", 
    "volatility": "1-2 kalimat."
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
                        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: `Data:\n${safeData}` }], 
                        temperature: 0.2, 
                        max_tokens: 1024 
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
                            messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: `Data:\n${safeData}` }], 
                            temperature: 0.2, 
                            response_format: { type: "json_object" }, 
                            max_tokens: 1024 
                        })
                    });
                    
                    if (!res.ok) throw new Error(`Groq HTTP ${res.status}`);
                    const response = await res.json();
                    rawText = response?.choices?.[0]?.message?.content || "";
                } catch (fallbackErr) {
                    console.error("AI Analysis Semua Endpoint Gagal:", fallbackErr.message);
                }
            }

            let parsed = { 
                insights: ["Sistem sedang memproses beban data yang tinggi.", "Mohon kurangi ukuran sampel data atau pastikan konfigurasi API sudah tepat."], 
                cards: { metric: "Data tidak tersedia.", segment: "Data tidak tersedia.", correlation: "Data tidak tersedia.", volatility: "Data tidak tersedia." } 
            };

            if (rawText) {
                try { 
                    parsed = extractJSON(rawText);
                    if (!parsed.insights) parsed.insights = ["Analisis AI berhasil dijalankan namun format data tidak sesuai."];
                    if (!parsed.cards) parsed.cards = { metric: "-", segment: "-", correlation: "-", volatility: "-" };
                } catch (parseError) {
                    parsed.insights = ["Mesin AI mengembalikan data dalam format yang tidak dikenali sistem.", "Silakan coba ulangi proses analisa."];
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
                            { role: 'system', content: "Kamu adalah Dazer AI Analyst. Berikan jawaban yang komprehensif, logis, dan rapi dalam Bahasa Indonesia." }, 
                            { role: 'user', content: `Context User: ${userContext}\n${webInfo}\nPertanyaan: ${message}` }
                        ], 
                        temperature: 0.6, 
                        max_tokens: 800 
                    })
                });
                
                if (!res.ok) throw new Error("Groq Error");
                const d = await res.json();
                const replyText = d?.choices?.[0]?.message?.content || "Sistem chat tidak merespons.";
                return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ reply: cleanMarkdown(replyText) }) };
            } catch(e) {
                return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ reply: "Layanan chat AI sedang offline atau konfigurasi API belum disetel." }) };
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
Berikan narasi evaluasi model yang profesional (Sebutkan Pola yang ditemukan, Confidence Level, Akurasi/Silhoutte Score bayangan, dan Rekomendasi). Format dalam Bahasa Indonesia yang rapi tanpa markdown rumit.`;

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
                    finalRes = "Evaluasi model terhenti karena gangguan koneksi API atau API Key belum disetel di Netlify. Mohon periksa kembali.";
                }
            }
            return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ result: cleanMarkdown(finalRes) }) };
        }

        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ reply: "Aksi tidak dikenali oleh sistem API." }) };

    } catch (err) {
        console.error("Critical System Error (Dazer API):", err);
        return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ reply: "Interupsi sistem server.", error: err.message }) };
    }
};
