// This API endpoint handles all translation requests.
// It is now UPDATED with the paywall logic to check user status and count usage.

import { db, auth } from './firebase-admin.js';
import { FieldValue } from 'firebase-admin/firestore'; // Import FieldValue

// --- Authentication Check Function ---
async function verifyUser(request) {
    // Looks for the 'Authorization: Bearer <token>' header sent from the frontend
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
            // Returns 402 (Payment Required) error code
            return response.status(402).json({ error: 'Upgrade required. You have used all your 5 free credits.' });
        }
        // END PAYWALL CHECK

        // 2. PROCESS AI REQUEST
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
            
            // 3. INCREMENT USAGE (FOR FREE USERS ONLY)
            if (userData.plan === 'free') {
                // Safely increments the counter in Firestore
                await userRef.update({ 
                    usageCount: FieldValue.increment(1)
                });
            }
            
            const translatedText = result.candidates[0].content.parts[0].text;
            return response.status(200).json({ translatedText: translatedText });
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
