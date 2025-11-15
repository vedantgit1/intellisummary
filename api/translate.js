// This is a Vercel Serverless Function (Node.js backend)
// It translates a given block of text into a target language.

export default async function handler(request, response) {
    if (request.method !== 'POST') {
        return response.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const { text, targetLanguage } = request.body;
        if (!text || !targetLanguage) {
            return response.status(400).json({ error: 'Missing text or target language' });
        }

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            return response.status(500).json({ error: 'API key not configured' });
        }

        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;

        const prompt = `Translate the following text into ${targetLanguage}. Return *only* the translated text, with no additional introduction or commentary.

--- TEXT TO TRANSLATE ---
${text}
--- END OF TEXT ---`;

        const payload = {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
                temperature: 0.1
            }
        };

        const apiResponse = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!apiResponse.ok) {
            const errorBody = await apiResponse.json();
            console.error('Google AI Error:', errorBody);
            return response.status(apiResponse.status).json({ error: errorBody.error?.message || 'Failed to call AI API' });
        }

        const result = await apiResponse.json();

        if (result.candidates && result.candidates[0].content?.parts?.[0]?.text) {
            const translatedText = result.candidates[0].content.parts[0].text;
            return response.status(200).json({ translatedText: translatedText });
        } else {
            return response.status(500).json({ error: 'Invalid response structure from AI' });
        }

    } catch (error) {
        console.error('Server-side error:', error);
        return response.status(500).json({ error: error.message || 'An unknown error occurred' });
    }
}
