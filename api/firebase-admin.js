// This is a helper file, not an API route.
// It initializes the Firebase Admin SDK to connect to your database securely.
// All your *other* backend API functions will import this.

import admin from 'firebase-admin';

// Check if the app is already initialized to prevent errors
if (!admin.apps.length) {
  try {
    // Get the secret key from Vercel Environment Variables
    const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_CONFIG);
    
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
  } catch (error) {
    console.error('Firebase Admin Initialization Error:', error.message);
  }
}

// Export the initialized database and auth services
const db = admin.firestore();
const auth = admin.auth();

export { db, auth };
