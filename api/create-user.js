// This is a Vercel Serverless Function (Node.js backend)
// This function is called *after* a user successfully signs up
// on the frontend using Firebase. Its job is to create their
// user document in our Firestore database.

import { db, auth } from './firebase-admin.js';

export default async function handler(request, response) {
    if (request.method !== 'POST') {
        return response.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        // 1. Get the Auth Token from the user's browser
        const { token } = request.body;
        if (!token) {
            return response.status(401).json({ error: 'Authentication token is required.' });
        }

        // 2. Verify the token to get the user's real ID (uid)
        const decodedToken = await auth.verifyIdToken(token);
        const uid = decodedToken.uid;
        const email = decodedToken.email;
        const name = decodedToken.name || 'New User'; // Get name, or use a default

        // 3. Check if a user document *already* exists
        const userRef = db.collection('users').doc(uid);
        const userDoc = await userRef.get();

        if (userDoc.exists) {
            // This user already exists. Just return success.
            console.log(`User ${uid} already exists in Firestore.`);
            return response.status(200).json({ message: 'User already exists.' });
        }

        // 4. Create the new user document in Firestore
        const newUser = {
            email: email,
            name: name,
            plan: 'free',       // Set their default plan
            usageCount: 0,    // Start their usage at 0
            createdAt: new Date().toISOString()
        };

        await userRef.set(newUser);
        
        console.log(`Successfully created new user ${uid} in Firestore.`);
        return response.status(201).json({ message: 'User created successfully.', user: newUser });

    } catch (error) {
        console.error('Error in /api/create-user:', error);
        return response.status(500).json({ error: 'Error creating user.', details: error.message });
    }
}
