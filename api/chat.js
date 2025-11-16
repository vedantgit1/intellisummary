// This API endpoint handles the "Chat with your Document" feature.
// It is now UPDATED with the paywall logic to check user status and count usage.

import { db, auth } from './firebase-admin.js';
import { FieldValue } from 'firebase-admin/firestore'; // Import FieldValue

// --- Authentication Check Function ---
async function verifyUser(request) {
    // Looks for the 'Authorization: Bearer <token>' header
    const token = request.headers.authorization?.split('Bearer ')[1];
    if (!token) {
        throw new Error('401-unauthorized'); // Unauthorized, no token provided
    }
    // Verifies the token using Firebase Admin SDK
    const decodedToken = await auth.verifyIdToken(token);
    return decodedToken.uid; // Returns the user's ID
}

export default async function handler(request, response) {
    if (request.method !== 'POST') {
        return response.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        // 1. AUTHENTICATE AND CHECK PAYWALL
        const userId = await verifyUser(request);
        const userRef = db.collection('users').doc(userId);
        const userDoc = await userRef.get();

        if (!userDoc.exists) {
            return response.status(404).json({ error: 'User not found in database. Please sign out and sign in again.' });
        }
        
        const userData = userDoc.data();
        
        // PAYWALL CHECK: Free user is limited to 5 uses
        if (userData.plan === 'free' && (userData.usageCount || 0) >= 5) {
            return response.status(402).json({ error: 'Upgrade required. You have used all your 5 free credits.' });
        }
        // END PAYWALL CHECK

        // 2. PROCESS AI REQUEST
        const { question, documentText, chatHistory } = request.body;
        if (!question || !documentText) {
            return response.status(400).json({ error: 'Missing question or document text' });
        }
        
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            return response.status(500).json({ error: 'API key not configured' });
        }
        
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;

        // Build the system instruction for the AI (ensuring multilingual response)
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
            
            // 3. INCREMENT USAGE (FOR FREE USERS ONLY)
            if (userData.plan === 'free') {
                // Safely increments the counter in Firestore
                await userRef.update({ 
                    usageCount: FieldValue.increment(1)
                });
            }
            
            const aiResponseText = result.candidates[0].content.parts[0].text;
            return response.status(200).json({ answer: aiResponseText });
        } else {
            return response.status(500).json({ error: 'Invalid response structure from AI' });
        }

    } catch (error) {
        console.error('Server-side error:', error);
        if (error.message.includes('401-unauthorized') || error.code?.startsWith('auth/')) {
            return response.status(401).json({ error: 'Unauthorized. Please sign in.' });
        }
        return response.status(500).json({ error: error.message || 'An unknown error occurred' });
    }
}
