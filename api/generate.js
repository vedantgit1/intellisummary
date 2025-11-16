// This API endpoint handles all document analysis requests (Business Analyst, Student, Summary).
// It now includes the paywall logic.

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
        const { text, persona } = request.body;
        if (!text || !persona) {
            return response.status(400).json({ error: 'Missing document text or persona' });
        }

        const apiKey = process.env.GEMINI_API_KEY;
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;
        const { systemInstruction, userPrompt, schema } = getPromptAndSchema(text, persona);

        const payload = {
            contents: [{ parts: [{ text: userPrompt }] }],
            systemInstruction: { parts: [{ text: systemInstruction }] },
            generationConfig: {
                responseMimeType: "application/json",
                responseSchema: schema,
                temperature: 0.2
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
                await userRef.update({ usageCount: FieldValue.increment(1) });
            }
            
            const jsonText = result.candidates[0].content.parts[0].text;
            return response.status(200).json(JSON.parse(jsonText));
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

// --- Helper Function ---
function getPromptAndSchema(text, persona) {
    const systemInstruction = "You are an expert document analyst. Your task is to process the given text and return a structured JSON response based on the user's persona. Be concise and accurate.";
    let userPrompt = "";
    let schema = {};

    switch (persona) {
        case 'business':
            userPrompt = `Analyze the following document. Extract 1-2 key insights, data for a bar chart (e.g., revenue vs. expenses, or another key trend), and a data table of 3-5 key metrics. Document: ${text}`;
            schema = {
                type: "OBJECT",
                properties: {
                    "keyInsights": { type: "STRING" },
                    "chartData": {
                        type: "OBJECT",
                        properties: {
                            "labels": { type: "ARRAY", items: { type: "STRING" } },
                            "datasets": {
                                type: "ARRAY",
                                items: {
                                    type: "OBJECT",
                                    properties: {
                                        "label": { type: "STRING" },
                                        "data": { type: "ARRAY", items: { type: "NUMBER" } },
                                        "backgroundColor": { type: "STRING" }
                                    }
                                }
                            }
                        }
                    },
                    "tableData": {
                        type: "ARRAY",
                        items: {
                            type: "OBJECT",
                            properties: {
                                "metric": { type: "STRING" },
                                "value": { type: "STRING" },
                                "change": { type: "STRING" }
                            }
                        }
                    }
                }
            };
            break;
        case 'student':
            userPrompt = `Analyze the following document. Simplify the 2-3 most complex concepts with fun analogies (use emojis!), and create one multiple-choice quiz question with 3 options. Document: ${text}`;
            schema = {
                type: "OBJECT",
                properties: {
                    "simplifiedConcepts": {
                        type: "ARRAY",
                        items: {
                            type: "OBJECT",
                            properties: {
                                "concept": { type: "STRING" },
                                "explanation": { type: "STRING" }
                            }
                        }
                    },
                    "quiz": {
                        type: "OBJECT",
                        properties: {
                            "question": { type: "STRING" },
                            "options": { type: "ARRAY", items: { type: "STRING" } },
                            "answerIndex": { type: "INTEGER" }
                        }
                    }
                }
            };
            break;
        case 'summary':
        default:
            userPrompt = `Analyze the following document. Provide 3-5 key bullet points and a concise full summary. Document: ${text}`;
            schema = {
                type: "OBJECT",
                properties: {
                    "keyPoints": { type: "ARRAY", items: { type: "STRING" } },
                    "fullSummary": { type: "STRING" }
                }
            };
            break;
    }
    return { systemInstruction, userPrompt, schema };
}
