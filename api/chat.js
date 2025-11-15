// This is a Vercel Serverless Function (Node.js backend)
// It handles follow-up questions for the "Chat with your Document" feature.

export default async function handler(request, response) {
    if (request.method !== 'POST') {
        return response.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const { question, documentText, chatHistory } = request.body;
        if (!question || !documentText) {
            return response.status(400).json({ error: 'Missing question or document text' });
        }

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            return response.status(500).json({ error: 'API key not configured' });
        }

        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;

        // Build the system instruction for the AI
        // --- THIS IS THE FIX ---
        const systemInstruction = `You are an expert AI assistant. You have already analyzed the document provided below and are now answering follow-up questions from the user.
- Your goal is to answer the user's questions based *only* on the content of the document.
- **NEW RULE: You MUST respond in the same language as the user's most recent question.**
- If the answer is not in the document, say "I could not find that information in the document." (or the equivalent in the user's language).
- Be concise and helpful.
- The user's chat history is provided for context.

--- DOCUMENT START ---
${documentText}
--- DOCUMENT END ---`;
        
        // Build the chat history for the model
        const modelChatHistory = chatHistory.map(turn => ({
            role: turn.isUser ? "user" : "model",
            parts: [{ text: turn.text }]
        }));

        // Add the new user question
        modelChatHistory.push({
            role: "user",
            parts: [{ text: question }]
        });

        const payload = {
            contents: modelChatHistory,
            systemInstruction: {
                parts: [{ text: systemInstruction }]
            },
            generationConfig: {
                temperature: 0.3
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
            const aiResponseText = result.candidates[0].content.parts[0].text;
            return response.status(200).json({ answer: aiResponseText });
        } else {
            return response.status(500).json({ error: 'Invalid response structure from AI' });
        }

    } catch (error) {
        console.error('Server-side error:', error);
        return response.status(500).json({ error: error.message || 'An unknown error occurred' });
    }
}
