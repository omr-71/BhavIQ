export type AppLanguage = 'en' | 'hi' | 'mr';

export const TRANSLATIONS: Record<AppLanguage, Record<string, string>> = {
  en: {
    tagline: 'Know the market. Master your business.',
    overview: 'Overview',
    billing: 'Billing',
    inventory: 'Products & Inventory',
    stockShort: 'Stock',
    khata: 'Khata',
    purchases: 'Purchases',
    suppliers: 'Suppliers',
    market: 'Market Intelligence',
    marketShort: 'Market',
    reports: 'Reports',
    expenses: 'Expenses',
    settings: 'Settings',
    more: 'More',
    notEnoughData: 'Not enough recorded data.',
  },
  hi: {
    tagline: 'बाज़ार को जानें। अपने व्यापार में माहिर बनें।',
    overview: 'अवलोकन',
    billing: 'बिलिंग',
    inventory: 'उत्पाद और स्टॉक',
    stockShort: 'स्टॉक',
    khata: 'खाता',
    purchases: 'खरीद',
    suppliers: 'आपूर्तिकर्ता',
    market: 'बाज़ार भाव विश्लेषण',
    marketShort: 'बाज़ार',
    reports: 'रिपोर्ट्स',
    expenses: 'खर्च',
    settings: 'सेटिंग्स',
    more: 'अधिक',
    notEnoughData: 'पर्याप्त दर्ज डेटा उपलब्ध नहीं है।',
  },
  mr: {
    tagline: 'बाजार ओळखा. व्यवसायावर पकड मिळवा.',
    overview: 'आढावा',
    billing: 'बिलिंग',
    inventory: 'उत्पादने व साठा',
    stockShort: 'साठा',
    khata: 'खातेवही',
    purchases: 'खरेदी',
    suppliers: 'पुरवठादार',
    market: 'बाजारभाव विश्लेषण',
    marketShort: 'बाजार',
    reports: 'अहवाल',
    expenses: 'खर्च',
    settings: 'सेटिंग्ज',
    more: 'इतर',
    notEnoughData: 'पुरेशी नोंदवलेली माहिती उपलब्ध नाही.',
  },
};

export function t(lang: AppLanguage, key: string): string {
  return TRANSLATIONS[lang]?.[key] || TRANSLATIONS.en[key] || key;
}
