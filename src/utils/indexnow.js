import axios from 'axios';

/**
 * নতুন/আপডেট হওয়া listing URL Bing IndexNow-এ সাবমিট করে
 * যাতে দ্রুত সার্চে ইনডেক্স হয়।
 */
export const submitToIndexNow = async (listingSlug) => {
    try {
        const apiKey = process.env.INDEXNOW_API_KEY;
        const domain = process.env.SITE_DOMAIN;

        if (!apiKey || !domain) {
            console.warn('⚠️ IndexNow skipped: INDEXNOW_API_KEY বা SITE_DOMAIN .env-এ নেই');
            return;
        }

        // Local development-এ Bing key verify করতে পারবে না, তাই শুধু log করে skip
        if (process.env.NODE_ENV !== 'production') {
            console.log(`ℹ️ [DEV] IndexNow skipped (local env). URL হতো: https://${domain}/listings/${listingSlug}`);
            return;
        }

        const listingUrl = `https://${domain}/listings/${listingSlug}`;

        const payload = {
            host: domain,
            key: apiKey,
            keyLocation: `https://${domain}/${apiKey}.txt`,
            urlList: [listingUrl],
        };

        const response = await axios.post('https://api.indexnow.org/IndexNow', payload, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 10000,
        });

        console.log('✅ IndexNow submitted:', response.status, listingUrl);
    } catch (error) {
        // এটা fail হলেও listing creation যেন block না হয়
        console.error('❌ IndexNow submit failed:', error.message);
    }
};