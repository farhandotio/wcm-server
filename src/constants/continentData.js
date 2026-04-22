export const continentMapping = {
    asia: [
        "Japanese",
        "Indian",
        "Chinese",
        "Korean",
        "Balinese",
        "Javanese",
        "Uzbek",
        "Thai",
        "Asian",
        "Asian Inspired",
        "Indian (Ayurveda)"
    ],

    "middle-east": [
        "Arab",
        "Arabic",
        "Turkish",
        "Turkish (Anatolian)",
        "Middle Eastern",
        "Middle Eastern Inspired"
    ],

    europe: [
        "Celtic",
        "Nordic",
        "Slavic",
        "Mediterranean",
        "Balkan",
        "Alpine",
        "Baltic",
        "Iberian",
        "European",
        "European Inspired"
    ],

    africa: [
        "Maasai",
        "Yoruba",
        "Zulu",
        "Ashanti",
        "Berber (Amazigh)",
        "Tuareg",
        "Fulani",
        "Igbo",
        "Kente (Ghana)",
        "Bogolan (Mali)",
        "Ethiopian",
        "Moroccan",
        "Dogon",
        "Bamana",
        "African",
        "African Inspired"
    ],

    "north-america": [
        "Native American",
        "Indigenous",
        "Indigenous Inspired"
    ],

    "latin-america": [
        "Andean",
        "Peruvian",
        "Mexican",
        "Aztec",
        "Mayan",
        "Brazilian",
        "Caribbean",
        "Latin American",
        "Latin Inspired"
    ],

    oceania: [
        "Polynesian",
        "Aboriginal",
        "Maori"
    ]
};

export const regions = ["All Regions", ...Object.keys(continentMapping)];