// Ini adalah serverless function yang berjalan di sisi Server Netlify.
// Di sinilah API Key akan disembunyikan.

exports.handler = async function(event, context) {
    // 1. Hanya izinkan metode POST
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        // 2. Ambil data mentah yang dikirim dari HTML
        const { data } = JSON.parse(event.body);

        // 3. AMBIL API KEY DARI NETLIFY ENVIRONMENT VARIABLES (Dibersihkan dari spasi ekstra)
        const apiKey = process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY.trim() : null;

        if (!apiKey) {
            return { 
                statusCode: 500, 
                body: JSON.stringify({ error: "Server tidak dikonfigurasi dengan benar (API Key hilang)." })
            };
        }

        // 4. Hubungi Google Gemini API dari sisi Server (Menggunakan model terbaru)
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    parts: [{ text: `Analisa dataset berikut dan berikan insight strategis bisnis. Data: ${data}` }]
                }],
                systemInstruction: {
                    parts: [{ text: `Kamu adalah AI Data Strategist kelas dunia. Tugasmu adalah membaca sampel data yang diberikan, memahami konteksnya (apakah ini data penjualan, HR, operasional, dll), dan memberikan analisa mendalam. 
                    
MANDATORI: Kamu WAJIB merespon HANYA dengan format JSON yang valid mengikuti schema berikut, tanpa markdown, tanpa teks tambahan apapun di luar JSON.

Schema JSON:
{
  "scorecards": [
    {"title": "Nama Metrik 1 (Singkat)", "value": "Angka/Nilai", "trend": "contoh: +5% (Gunakan + untuk positif, - untuk negatif)"},
    {"title": "Nama Metrik 2", "value": "Angka/Nilai", "trend": "contoh: -2%"},
    {"title": "Nama Metrik 3", "value": "Angka/Nilai", "trend": "contoh: Stabil"}
  ],
  "chart": {
    "title": "Judul Grafik (Sesuai konteks data)",
    "labels": ["Label1", "Label2", "Label3", "Label4", "Label5"],
    "data": [10, 20, 15, 30, 25],
    "datasetLabel": "Keterangan Data"
  },
  "insights": [
    "Insight 1 yang sangat tajam dan deskriptif berdasarkan data.",
    "Insight 2 yang menunjukkan korelasi tersembunyi.",
    "Insight 3 mengenai anomali atau peluang emas."
  ],
  "futurePlan": [
    {"focus": "Area Fokus 1", "action": "Tindakan spesifik yang harus dilakukan besok."},
    {"focus": "Area Fokus 2", "action": "Strategi jangka panjang."},
    {"focus": "Area Fokus 3", "action": "Mitigasi risiko yang ditemukan."}
  ]
}

Aturan tambahan: 
- Analisa harus masuk akal berdasarkan data yang dikirim.
- Jika datanya kacau, buat estimasi cerdas.
- Bahasa harus Profesional, Bahasa Indonesia, tanpa basa-basi.` }]
                },
                generationConfig: {
                    responseMimeType: "application/json"
                }
            })
        });

        if (!response.ok) {
            throw new Error(`Google API responded with status ${response.status}`);
        }

        const result = await response.json();
        const textResponse = result.candidates?.[0]?.content?.parts?.[0]?.text;

        // 5. Kembalikan hasil JSON murni ke HTML
        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: textResponse
        };

    } catch (error) {
        console.error("Function Error:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Gagal memproses data di server.' })
        };
    }
};
