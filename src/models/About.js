import mongoose from 'mongoose';

const AboutPageSchema = new mongoose.Schema({

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // ১. ABOUT HEADER SECTION
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    aboutHeader: {
        title: {
            type: String,
            default: "About Our Marketplace"
        },
        subTitle: {
            type: String,
            default: "World Culture Marketplace (WCM) is a global platform dedicated to showcasing cultural creators from every corner of the world."
        },
        styleSettings: {
            backgroundColor: { type: String, default: "#000000" },
            textColor: { type: String, default: "#FFFFFF" }
        }
    },

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // ২. INTRO SECTION
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    introSection: {
        headline: {
            normalTextPart1: { type: String, default: "Discover" },
            coloredTextPart: { type: String, default: "Culture" },
            normalTextPart2: { type: String, default: "Worldwide" }
        },
        description: {
            type: String,
            default: "We connect passionate collectors and curious explorers with independent artisans, craftspeople, and cultural creators from across the globe."
        },
        socialProof: {
            creatorCountText: { type: String, default: "12,000+" },
            fullTextSuffix: { type: String, default: "independent creators" }
        },
        gridImages: {
            type: [String],
            default: [
                "/images/intro/grid-1.jpg",
                "/images/intro/grid-2.jpg",
                "/images/intro/grid-3.jpg",
                "/images/intro/grid-4.jpg"
            ]
        }
    },

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // ৩. STORY SECTION
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    storySection: {
        headline: {
            upperLine: { type: String, default: "Identity in every thread," },
            lowerLine: { type: String, default: "story in every shape." }
        },
        descriptions: {
            type: [String],
            default: [
                "Every piece on WCM carries the weight of generations — traditions passed down through families, communities, and continents.",
                "We believe that when you buy from a cultural creator, you are not just purchasing an object. You are participating in the continuation of a living story."
            ]
        },
        highlightText: {
            type: String,
            default: "Our platform does not own the craft; we amplify it."
        },
        mainImage: {
            type: String,
            default: "/images/story/main-image.jpg"
        },
        testimonialCard: {
            quote: { type: String, default: "Craft is the language my ancestors left me. WCM gave it a global voice." },
            author: { type: String, default: "KENJI A., MASTER CALLIGRAPHER" }
        }
    },

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // ৪. EXPLORER JOURNEY SECTION
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    explorerJourney: {
        topSection: {
            badge: { type: String, default: "HOW WCM WORKS" },
            titleMain: { type: String, default: "The Explorer Journey" },
            subTitle: { type: String, default: "A transparent and respectful way to discover authentic cultural craftsmanship." }
        },
        steps: {
            type: [
                {
                    stepNumber: { type: String },
                    title: { type: String },
                    description: { type: String },
                    iconId: { type: String }
                }
            ],
            default: [
                {
                    stepNumber: "01",
                    title: "Explore Collections",
                    description: "Browse thousands of handpicked cultural artifacts and creations curated from artisans worldwide.",
                    iconId: "search"
                },
                {
                    stepNumber: "02",
                    title: "Connect with Creators",
                    description: "Learn the story behind each piece directly from the artisan who made it.",
                    iconId: "connect"
                },
                {
                    stepNumber: "03",
                    title: "Own with Purpose",
                    description: "Every purchase directly supports the creator and preserves their cultural heritage.",
                    iconId: "heart"
                }
            ]
        },
        footerText: {
            type: String,
            default: "WCM bridges the gap between heritage and global audience."
        }
    },

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // ৫. PRINCIPLES SECTION
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    principlesSection: {
        header: {
            badge: { type: String, default: "OUR FOUNDATION" },
            titlePart1: { type: String, default: "Our" },
            titleColored: { type: String, default: "Principles." },
            description: { type: String, default: "The values that guide every decision we make and every creator we welcome onto our platform." }
        },
        principlesList: {
            type: [
                {
                    title: { type: String, required: true },
                    content: { type: String, required: true }
                }
            ],
            default: [
                {
                    title: "Authenticity First",
                    content: "Every creator on WCM is verified for authenticity. We do not allow mass-produced imitations of cultural work."
                },
                {
                    title: "Fair Compensation",
                    content: "Creators keep the majority of every sale. We believe those who create should be the primary beneficiaries."
                },
                {
                    title: "Cultural Respect",
                    content: "We actively prevent cultural appropriation by ensuring creators represent their own heritage."
                },
                {
                    title: "Radical Transparency",
                    content: "Buyers always know who made their purchase, where it came from, and what tradition it represents."
                }
            ]
        }
    },

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    visionSection: {
        header: {
            badge: {
                type: String,
                default: "OUR VISION & IMPACT"
            },
            titlePart1: {
                type: String,
                default: "Empowering the"
            },
            titleColored: {
                type: String,
                default: "Guardians of Culture."
            },
            mainDescription: {
                type: String,
                default: "What began as an idea to bridge cultures digitally is evolving into a growing network of creators, communities, and audiences who value authenticity over mass production."
            }
        },

        imageCard: {
            imageUrl: {
                type: String,
                default: "/images/vision/heritage-image.jpg"
            },
            topBadge: {
                type: String,
                default: "PRESERVING HERITAGE"
            },
            cardTitle: {
                type: String,
                default: "Honoring Traditions"
            },
            cardQuote: {
                type: String,
                default: "Culture is not only something to observe, but something to understand and celebrate."
            },
            footerText: {
                type: String,
                default: "WCM GLOBAL NETWORK"
            }
        },

        features: {
            type: [
                {
                    iconId: {
                        type: String,
                        default: "globe"
                    },
                    title: {
                        type: String,
                        required: true
                    },
                    description: {
                        type: String,
                        required: true
                    }
                }
            ],
            default: [
                {
                    iconId: "globe",
                    title: "Supporting Cultural Visibility",
                    description: "We honor the people and traditions behind creative expression by providing a global stage for their work."
                },
                {
                    iconId: "shield",
                    title: "Inclusive Cultural Economy",
                    description: "Our platform contributes to a respectful economy that values authenticity and fair representation for all creators."
                },
                {
                    iconId: "heart",
                    title: "Bridge Between Cultures",
                    description: "We digitally connect diverse communities, ensuring that heritage is not only observed but celebrated."
                },
                {
                    iconId: "check",
                    title: "Total Ownership",
                    description: "Creators maintain 100% control over their brand, stories, and the cultural heritage they represent."
                }
            ]
        }
    },
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // ৭. VISIBILITY SECTION
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    visibilitySection: {
        headline: {
            textPart: { type: String, default: "Culture deserves" },
            coloredPart: { type: String, default: "visibility." }
        },
        founderText: {
            prefix: { type: String, default: "World Culture Marketplace was founded by" },
            founderName: { type: String, default: "Annette Cousin" },
            suffix: { type: String, default: "with a simple idea: that the world's most meaningful creations deserve a global stage." }
        },
        description: {
            type: String,
            default: "From hand-woven textiles in West Africa to lacquerware from Kyoto, WCM ensures that authentic cultural work is never lost to obscurity or undervaluation."
        },
        footerInfo: {
            locations: {
                type: [String],
                default: [
                    "50 AVENUE DES CHAMPS ÉLYSÉES, PARIS",
                    "WASHINGTON, USA"
                ]
            },
            serviceText: { type: String, default: "SERVING GLOBAL ARTISANS" }
        }
    }

}, { timestamps: true });

export default mongoose.models.AboutPage || mongoose.model('AboutPage', AboutPageSchema);