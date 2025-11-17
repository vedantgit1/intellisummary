// This is a Vercel Serverless Function (Node.js backend)
// It creates a Razorpay subscription for a logged-in user.

import { db, auth } from './firebase-admin.js';
import Razorpay from 'razorpay';

// Initialize Razorpay with your keys from Vercel
const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
});

export default async function handler(request, response) {
    if (request.method !== 'POST') {
        return response.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        // 1. Get the user's Auth Token
        const token = request.headers.authorization?.split('Bearer ')[1];
        if (!token) {
            return response.status(401).json({ error: 'Authentication token is required.' });
        }

        // 2. Verify the token to get the user's ID (uid)
        const decodedToken = await auth.verifyIdToken(token);
        const uid = decodedToken.uid;

        // 3. Get the user's data from Firestore
        const userRef = db.collection('users').doc(uid);
        const userDoc = await userRef.get();
        if (!userDoc.exists) {
            return response.status(404).json({ error: 'User not found.' });
        }
        const userData = userDoc.data();

        // 4. Check if user is ALREADY subscribed
        if (userData.plan === 'pro' && userData.razorpaySubscriptionId) {
            return response.status(400).json({ error: 'User is already on the Pro plan.' });
        }

        // 5. Create a "Customer" in Razorpay (if they don't exist)
        let razorpayCustomerId = userData.razorpayCustomerId;
        if (!razorpayCustomerId) {
            const customer = await razorpay.customers.create({
                name: userData.name || 'New User',
                email: userData.email,
                contact: '', // You can add a phone number field later
                notes: {
                    firebase_uid: uid, // This links the Razorpay customer to your Firebase user
                },
            });
            razorpayCustomerId = customer.id;
            // Save this ID to your database for future use
            await userRef.update({ razorpayCustomerId: razorpayCustomerId });
        }

        // 6. Create the Subscription in Razorpay
        const plan_id = process.env.RAZORPAY_PLAN_ID; // Get Plan ID from Vercel
        
        const subscription = await razorpay.subscriptions.create({
            plan_id: plan_id,
            customer_id: razorpayCustomerId,
            total_count: 12, // e.g., for 12 months (can be infinite if plan allows)
            quantity: 1,
            notes: {
                firebase_uid: uid, // Add a note for tracking
            },
        });

        // 7. Send the subscription ID and public key back to the website
        // The website will use this to open the payment popup.
        response.status(200).json({
            subscriptionId: subscription.id,
            key_id: process.env.RAZORPAY_KEY_ID,
        });

    } catch (error) {
        console.error('Error in /api/create-subscription:', error);
        return response.status(500).json({ error: 'Error creating subscription.', details: error.message });
    }
}
