import AboutPage from '../models/About.js';
import { v2 as cloudinary } from 'cloudinary';

// ─── Cloudinary Config ───────────────────────────────────────
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});

// ─── Helper: Cloudinary থেকে public_id বের করে delete করা ───
const deleteFromCloudinary = async (imageUrl) => {
    try {
        if (!imageUrl || !imageUrl.includes('cloudinary.com')) return;
        // URL থেকে public_id বের করা
        const parts = imageUrl.split('/');
        const fileName = parts[parts.length - 1].split('.')[0];
        const folder = parts[parts.length - 2];
        const publicId = `${folder}/${fileName}`;
        await cloudinary.uploader.destroy(publicId);
    } catch (err) {
        console.error('Cloudinary delete error:', err.message);
    }
};

// ─── Helper: About Page document get or create ───────────────
const getOrCreateAboutPage = async () => {
    let page = await AboutPage.findOne();
    if (!page) page = await AboutPage.create({});
    return page;
};


// ════════════════════════════════════════════════════════════
//  1. FULL PAGE — GET & RESET
// ════════════════════════════════════════════════════════════

/**
 * GET /api/about
 * পুরো About Page এর সব ডেটা একসাথে
 */
export const getAboutPage = async (req, res) => {
    try {
        const page = await getOrCreateAboutPage();
        res.status(200).json({ success: true, data: page });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

/**
 * DELETE /api/about/reset
 * পুরো About Page ডিফল্ট ডেটায় রিসেট
 */
export const resetAboutPage = async (req, res) => {
    try {
        await AboutPage.deleteMany();
        const freshPage = await AboutPage.create({});
        res.status(200).json({ success: true, message: 'About page reset to defaults.', data: freshPage });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};


// ════════════════════════════════════════════════════════════
//  2. ABOUT HEADER SECTION
// ════════════════════════════════════════════════════════════

/**
 * PATCH /api/about/header
 * body: { title, subTitle, styleSettings: { backgroundColor, textColor } }
 */
export const updateAboutHeader = async (req, res) => {
    try {
        const { title, subTitle, styleSettings } = req.body;
        const page = await getOrCreateAboutPage();

        if (title) page.aboutHeader.title = title;
        if (subTitle) page.aboutHeader.subTitle = subTitle;
        if (styleSettings?.backgroundColor)
            page.aboutHeader.styleSettings.backgroundColor = styleSettings.backgroundColor;
        if (styleSettings?.textColor)
            page.aboutHeader.styleSettings.textColor = styleSettings.textColor;

        await page.save();
        res.status(200).json({ success: true, data: page.aboutHeader });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};


// ════════════════════════════════════════════════════════════
//  3. INTRO SECTION
// ════════════════════════════════════════════════════════════

/**
 * PATCH /api/about/intro
 */
export const updateIntroSection = async (req, res) => {
    try {
        const page = await getOrCreateAboutPage();
        const {
            normalTextPart1, coloredTextPart, normalTextPart2,
            description, creatorCountText, fullTextSuffix
        } = req.body;

        if (normalTextPart1) page.introSection.headline.normalTextPart1 = normalTextPart1;
        if (coloredTextPart) page.introSection.headline.coloredTextPart = coloredTextPart;
        if (normalTextPart2) page.introSection.headline.normalTextPart2 = normalTextPart2;
        if (description) page.introSection.description = description;
        if (creatorCountText) page.introSection.socialProof.creatorCountText = creatorCountText;
        if (fullTextSuffix) page.introSection.socialProof.fullTextSuffix = fullTextSuffix;

        // Grid Images — Multer-storage-cloudinary path ব্যবহার করা হয়েছে
        if (req.files && req.files.length > 0) {
            const newUrls = req.files.map(file => file.path);
            const oldUrls = page.introSection.gridImages || [];
            for (const url of oldUrls) await deleteFromCloudinary(url);
            page.introSection.gridImages = newUrls;
        }

        await page.save();
        res.status(200).json({ success: true, data: page.introSection });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

export const updateIntroSingleImage = async (req, res) => {
    try {
        const index = parseInt(req.params.index);
        if (isNaN(index) || index < 0 || index > 3)
            return res.status(400).json({ success: false, message: 'Index must be 0 to 3.' });

        if (!req.file)
            return res.status(400).json({ success: false, message: 'No image file provided.' });

        const page = await getOrCreateAboutPage();

        // পুরনো ইমেজ ডিলিট করা
        const oldUrl = page.introSection.gridImages[index];
        if (oldUrl && oldUrl.includes('cloudinary')) {
            await deleteFromCloudinary(oldUrl);
        }

        // নতুন পাথ বসানো (req.file.path Multer-Cloudinary থেকে আসে)
        page.introSection.gridImages[index] = req.file.path;

        // মঙ্গুজকে জানানো যে অ্যারে চেঞ্জ হয়েছে
        page.markModified('introSection.gridImages');

        await page.save();
        res.status(200).json({ success: true, imageUrl: req.file.path });
    } catch (err) {
        console.error("Single Image Update Error:", err);
        res.status(500).json({ success: false, message: err.message });
    }
};


// ════════════════════════════════════════════════════════════
//  4. STORY SECTION
// ════════════════════════════════════════════════════════════

export const updateStorySection = async (req, res) => {
    try {
        const page = await getOrCreateAboutPage();
        const {
            upperLine, lowerLine, descriptions,
            highlightText, testimonialQuote, testimonialAuthor
        } = req.body;

        if (upperLine) page.storySection.headline.upperLine = upperLine;
        if (lowerLine) page.storySection.headline.lowerLine = lowerLine;
        if (descriptions) {
            const parsed = typeof descriptions === 'string' ? JSON.parse(descriptions) : descriptions;
            page.storySection.descriptions = parsed;
        }
        if (highlightText) page.storySection.highlightText = highlightText;
        if (testimonialQuote) page.storySection.testimonialCard.quote = testimonialQuote;
        if (testimonialAuthor) page.storySection.testimonialCard.author = testimonialAuthor;

        if (req.file) {
            const oldUrl = page.storySection.mainImage;
            if (oldUrl) await deleteFromCloudinary(oldUrl);
            page.storySection.mainImage = req.file.path;
        }

        await page.save();
        res.status(200).json({ success: true, data: page.storySection });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};


// ════════════════════════════════════════════════════════════
// 5. EXPLORER JOURNEY SECTION
// ════════════════════════════════════════════════════════════

// ১. পুরো Journey সেকশন এবং টপ সেকশন আপডেট
export const updateExplorerJourney = async (req, res) => {
    try {
        const page = await getOrCreateAboutPage();
        const { badge, titleMain, subTitle, footerText, steps } = req.body;

        // Top Section updates
        if (badge !== undefined) page.explorerJourney.topSection.badge = badge;
        if (titleMain !== undefined) page.explorerJourney.topSection.titleMain = titleMain;
        if (subTitle !== undefined) page.explorerJourney.topSection.subTitle = subTitle;

        // Footer update
        if (footerText !== undefined) page.explorerJourney.footerText = footerText;

        // Steps update (পুরো অ্যারে একসাথে আপডেট করতে চাইলে)
        if (steps) {
            const parsed = typeof steps === 'string' ? JSON.parse(steps) : steps;
            page.explorerJourney.steps = parsed;
        }

        await page.save();
        res.status(200).json({ success: true, data: page.explorerJourney });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// ২. নির্দিষ্ট একটি স্টেপ আপডেট (Index অনুযায়ী)
export const updateExplorerStep = async (req, res) => {
    try {
        const index = parseInt(req.params.index);
        const page = await getOrCreateAboutPage();

        if (index < 0 || index >= page.explorerJourney.steps.length) {
            return res.status(400).json({ success: false, message: 'Invalid step index.' });
        }

        const { stepNumber, title, description, iconId } = req.body;
        const step = page.explorerJourney.steps[index];

        // স্কিমা অনুযায়ী ফিল্ডগুলো আপডেট
        if (stepNumber !== undefined) step.stepNumber = stepNumber;
        if (title !== undefined) step.title = title;
        if (description !== undefined) step.description = description;
        if (iconId !== undefined) step.iconId = iconId;

        await page.save();
        res.status(200).json({ success: true, data: page.explorerJourney.steps });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// ৩. নতুন একটি স্টেপ যোগ করা
export const addExplorerStep = async (req, res) => {
    try {
        const page = await getOrCreateAboutPage();
        const { stepNumber, title, description, iconId } = req.body;

        // নতুন স্টেপ অবজেক্ট তৈরি
        const newStep = {
            stepNumber: stepNumber || `0${page.explorerJourney.steps.length + 1}`,
            title: title || "New Step",
            description: description || "",
            iconId: iconId || "default"
        };

        page.explorerJourney.steps.push(newStep);
        await page.save();
        res.status(201).json({ success: true, data: page.explorerJourney.steps });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// ৪. স্টেপ ডিলিট করা
export const deleteExplorerStep = async (req, res) => {
    try {
        const index = parseInt(req.params.index);
        const page = await getOrCreateAboutPage();

        if (index < 0 || index >= page.explorerJourney.steps.length) {
            return res.status(400).json({ success: false, message: 'Invalid step index.' });
        }

        // ডিলিট করার পর মঙ্গুজকে জানাতে হবে যে অ্যারেটি পরিবর্তিত হয়েছে
        page.explorerJourney.steps.splice(index, 1);

        await page.save();
        res.status(200).json({ success: true, data: page.explorerJourney.steps });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};


// ════════════════════════════════════════════════════════════
//  6. PRINCIPLES SECTION
// ════════════════════════════════════════════════════════════

export const updatePrinciplesSection = async (req, res) => {
    try {
        const page = await getOrCreateAboutPage();
        const { badge, titlePart1, titleColored, description, principlesList } = req.body;

        if (badge) page.principlesSection.header.badge = badge;
        if (titlePart1) page.principlesSection.header.titlePart1 = titlePart1;
        if (titleColored) page.principlesSection.header.titleColored = titleColored;
        if (description) page.principlesSection.header.description = description;
        if (principlesList) {
            const parsed = typeof principlesList === 'string' ? JSON.parse(principlesList) : principlesList;
            page.principlesSection.principlesList = parsed;
        }

        await page.save();
        res.status(200).json({ success: true, data: page.principlesSection });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

export const addPrincipleCard = async (req, res) => {
    try {
        const { title, content } = req.body;
        if (!title || !content)
            return res.status(400).json({ success: false, message: 'title and content are required.' });

        const page = await getOrCreateAboutPage();
        page.principlesSection.principlesList.push({ title, content });
        await page.save();
        res.status(201).json({ success: true, data: page.principlesSection.principlesList });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

export const updatePrincipleCard = async (req, res) => {
    try {
        const index = parseInt(req.params.index);
        const page = await getOrCreateAboutPage();

        if (index < 0 || index >= page.principlesSection.principlesList.length)
            return res.status(400).json({ success: false, message: 'Invalid card index.' });

        const { title, content } = req.body;
        if (title) page.principlesSection.principlesList[index].title = title;
        if (content) page.principlesSection.principlesList[index].content = content;

        await page.save();
        res.status(200).json({ success: true, data: page.principlesSection.principlesList });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

export const deletePrincipleCard = async (req, res) => {
    try {
        const index = parseInt(req.params.index);
        const page = await getOrCreateAboutPage();

        if (index < 0 || index >= page.principlesSection.principlesList.length)
            return res.status(400).json({ success: false, message: 'Invalid card index.' });

        page.principlesSection.principlesList.splice(index, 1);
        await page.save();
        res.status(200).json({ success: true, data: page.principlesSection.principlesList });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};


// ════════════════════════════════════════════════════════════
//  7. VISION SECTION CONTROLLERS
// ════════════════════════════════════════════════════════════

// ১. মেইন ভিশন সেকশন এবং ইমেজ আপডেট
export const updateVisionSection = async (req, res) => {
    try {
        const page = await getOrCreateAboutPage();
        const {
            badge, titlePart1, titleColored, mainDescription,
            topBadge, cardTitle, cardQuote, cardFooterText
        } = req.body;

        // Header ডাটা আপডেট (Null/Undefined check সহ)
        if (badge !== undefined) page.visionSection.header.badge = badge;
        if (titlePart1 !== undefined) page.visionSection.header.titlePart1 = titlePart1;
        if (titleColored !== undefined) page.visionSection.header.titleColored = titleColored;
        if (mainDescription !== undefined) page.visionSection.header.mainDescription = mainDescription;

        // Image Card টেক্সট ডাটা আপডেট
        if (topBadge !== undefined) page.visionSection.imageCard.topBadge = topBadge;
        if (cardTitle !== undefined) page.visionSection.imageCard.cardTitle = cardTitle;
        if (cardQuote !== undefined) page.visionSection.imageCard.cardQuote = cardQuote;
        if (cardFooterText !== undefined) page.visionSection.imageCard.footerText = cardFooterText;

        // ইমেজ হ্যান্ডলিং
        if (req.file) {
            const oldUrl = page.visionSection.imageCard.imageUrl;

            // আপনার হেল্পার ফাংশনটি সরাসরি ব্যবহার করুন
            if (oldUrl) {
                await deleteFromCloudinary(oldUrl);
            }
            page.visionSection.imageCard.imageUrl = req.file.path;
        }

        await page.save();
        res.status(200).json({ success: true, data: page.visionSection });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// ২. নতুন ভিশন ফিচার অ্যাড করা
export const addVisionFeature = async (req, res) => {
    try {
        const { iconId, title, description } = req.body;
        const page = await getOrCreateAboutPage();

        page.visionSection.features.push({
            iconId: iconId || "globe",
            title,
            description
        });

        await page.save();
        res.status(201).json({ success: true, data: page.visionSection.features });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// ৩. নির্দিষ্ট ফিচার আপডেট করা
export const updateVisionFeature = async (req, res) => {
    try {
        const { index } = req.params;
        const { iconId, title, description } = req.body;
        const page = await getOrCreateAboutPage();

        const i = parseInt(index);

        // বাউন্ডারি চেক যোগ করা হয়েছে
        if (isNaN(i) || i < 0 || i >= page.visionSection.features.length) {
            return res.status(404).json({ success: false, message: "Feature index out of bounds" });
        }

        const feature = page.visionSection.features[i];
        if (iconId) feature.iconId = iconId;
        if (title) feature.title = title;
        if (description) feature.description = description;

        // মঙ্গুজকে জানানো যে নেস্টেড অ্যারে চেঞ্জ হয়েছে
        page.markModified('visionSection.features');

        await page.save();
        res.status(200).json({ success: true, data: page.visionSection.features[i] });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// ৪. নির্দিষ্ট ফিচার ডিলিট করা
export const deleteVisionFeature = async (req, res) => {
    try {
        const { index } = req.params;
        const page = await getOrCreateAboutPage();

        const i = parseInt(index);
        page.visionSection.features.splice(i, 1);

        await page.save();
        res.status(200).json({ success: true, message: "Feature deleted" });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// ════════════════════════════════════════════════════════════
//  8. VISIBILITY SECTION
// ════════════════════════════════════════════════════════════

export const updateVisibilitySection = async (req, res) => {
    try {
        const page = await getOrCreateAboutPage();
        const {
            textPart, coloredPart,
            prefix, founderName, suffix,
            description,
            locations, serviceText
        } = req.body;

        if (textPart) page.visibilitySection.headline.textPart = textPart;
        if (coloredPart) page.visibilitySection.headline.coloredPart = coloredPart;
        if (prefix) page.visibilitySection.founderText.prefix = prefix;
        if (founderName) page.visibilitySection.founderText.founderName = founderName;
        if (suffix) page.visibilitySection.founderText.suffix = suffix;
        if (description) page.visibilitySection.description = description;
        if (serviceText) page.visibilitySection.footerInfo.serviceText = serviceText;
        if (locations) {
            const parsed = typeof locations === 'string' ? JSON.parse(locations) : locations;
            page.visibilitySection.footerInfo.locations = parsed;
        }

        await page.save();
        res.status(200).json({ success: true, data: page.visibilitySection });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};