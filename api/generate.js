// This is a Vercel Serverless Function (Node.js backend)
// It will run on Vercel's servers, not in the user's browser.

export default async function handler(request, response) {
    // 1. Only allow POST requests
    if (request.method !== 'POST') {
        return response.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        // 2. Get the text and persona from the user's request
        const { text, persona } = request.body;
        if (!text || !persona) {
            return response.status(400).json({ error: 'Missing text or persona' });
        }

        // 3. Get the *secret* API key from Vercel's Environment Variables
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            return response.status(500).json({ error: 'API key not configured' });
        }

        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;

        // 4. Get the correct prompt and schema for the AI
        const { systemInstruction, userPrompt, schema } = getPromptAndSchema(text, persona);

        const payload = {
            contents: [{ parts: [{ text: userPrompt }] }],
            systemInstruction: {
                parts: [{ text: systemInstruction }]
            },
            generationConfig: {
                responseMimeType: "application/json",
                responseSchema: schema,
                temperature: 0.2
            }
        };

        // 5. Call the Google AI API *from the backend*
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

        // 6. Send the successful JSON response back to the user's browser
        if (result.candidates && result.candidates[0].content?.parts?.[0]?.text) {
            const jsonText = result.candidates[0].content.parts[0].text;
            // We parse it just to send the clean JSON object back
            return response.status(200).json(JSON.parse(jsonText));
        } else {
            return response.status(500).json({ error: 'Invalid response structure from AI' });
        }

    } catch (error) {
        console.error('Server-side error:', error);
        return response.status(500).json({ error: error.message || 'An unknown error occurred' });
    }
}


// --- Helper Function ---
// This builds the prompt and schema, just like in the old index.html
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
