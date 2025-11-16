// This is a Vercel Serverless Function (Node.js backend)
// It listens for messages *from Razorpay* to confirm successful payments.

import { db } from './firebase-admin.js';
import Razorpay from 'razorpay';
import crypto from 'crypto';

// We need to tell Vercel to allow "raw" body data for verification
export const config = {
    api: {
        bodyParser: false,
    },
};

// Helper function to read the raw body
async function readRawBody(req) {
    return new Promise((resolve, reject) => {
        let data = '';
        req.on('data', chunk => {
            data += chunk;
        });
        req.on('end', () => {
            resolve(Buffer.from(data, 'utf-8'));
        });
        req.on('error', reject);
    });
}

export default async function handler(request, response) {
    if (request.method !== 'POST') {
        return response.status(405).json({ error: 'Method Not Allowed' });
    }

    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const signature = request.headers['x-razorpay-signature'];
    
    try {
        const rawBody = await readRawBody(request);

        // 1. Verify the message is *actually* from Razorpay
        const shasum = crypto.createHmac('sha256', secret);
        shasum.update(rawBody);
        const digest = shasum.digest('hex');

        if (digest !== signature) {
            console.warn('Invalid Razorpay webhook signature');
            return response.status(400).json({ error: 'Invalid signature.' });
        }

        // 2. Signature is valid. Parse the data.
        const event = JSON.parse(rawBody.toString());

        // 3. Handle the event
        // We only care if a subscription was successfully activated/charged
        if (event.event === 'subscription.activated' || event.event === 'subscription.charged') {
            const subscription = event.payload.subscription.entity;
            const customerId = subscription.customer_id;
            const subscriptionId = subscription.id;
            const planId = subscription.plan_id;
            
            // Find the user in our database using the Razorpay Customer ID
            const usersQuery = await db.collection('users')
                .where('razorpayCustomerId', '==', customerId)
                .limit(1)
                .get();

            if (usersQuery.empty) {
                console.error(`Webhook Error: No user found with Razorpay Customer ID ${customerId}`);
                // Return 200 so Razorpay stops sending, but log the error
                return response.status(200).json({ message: 'User not found, but webhook acknowledged.' });
            }

            // 4. Update the user's plan to "pro"
            const userDoc = usersQuery.docs[0];
            await userDoc.ref.update({
                plan: 'pro',
                usageCount: 0, // Reset their usage
                razorpaySubscriptionId: subscriptionId,
                razorpayPlanId: planId,
                subscriptionStatus: 'active',
            });

            console.log(`Successfully activated Pro plan for user ${userDoc.id}`);
        }
        
        // 5. Send a 200 OK response to Razorpay
        response.status(200).json({ message: 'Webhook received successfully.' });

    } catch (error) {
        console.error('Error in /api/razorpay-webhook:', error);
        return response.status(500).json({ error: 'Error processing webhook.', details: error.message });
    }
}
